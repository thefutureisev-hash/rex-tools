import { createHmac, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import { readPrivateJson, writePrivateJson } from './storage';

/**
 * Team logins. Users live in PRICE_DATA_DIR/users.json with scrypt password
 * hashes. Sessions are stateless signed cookies (SESSION_SECRET). The first
 * admin is created on the setup screen with the one-time SETUP_CODE.
 */

const scrypt = promisify(scryptCb) as (pw: string, salt: string, len: number) => Promise<Buffer>;

export type Role = 'admin' | 'staff';
interface StoredUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  salt: string;
  hash: string;
  createdAt: string;
}
export type PublicUser = Pick<StoredUser, 'id' | 'email' | 'name' | 'role' | 'createdAt'>;

const FILE = 'users.json';
const COOKIE = 'rex_session';
const SESSION_DAYS = 7;
const IS_PROD = process.env.NODE_ENV === 'production';

const SECRET = process.env.SESSION_SECRET || (IS_PROD ? '' : randomBytes(32).toString('hex'));
if (!SECRET) throw new Error('SESSION_SECRET must be set in production');

const toPublic = ({ id, email, name, role, createdAt }: StoredUser): PublicUser => ({ id, email, name, role, createdAt });
const normEmail = (e: string) => String(e ?? '').trim().toLowerCase();

async function loadUsers(): Promise<StoredUser[]> {
  return (await readPrivateJson<StoredUser[]>(FILE)) ?? [];
}
async function saveUsers(users: StoredUser[]) {
  await writePrivateJson(FILE, users);
}

export function checkPassword(pw: unknown): string | null {
  if (typeof pw !== 'string' || pw.length < 10) return 'Use a password of at least 10 characters.';
  return null;
}

async function hashPassword(pw: string) {
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: (await scrypt(pw, salt, 64)).toString('hex') };
}

async function verify(user: StoredUser, pw: string) {
  const got = await scrypt(pw, user.salt, 64);
  const want = Buffer.from(user.hash, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

// ---------- sessions ----------

const sign = (data: string) => createHmac('sha256', SECRET).update(data).digest('base64url');

function issue(res: Response, user: StoredUser) {
  const payload = Buffer.from(JSON.stringify({ uid: user.id, exp: Date.now() + SESSION_DAYS * 86_400_000 })).toString('base64url');
  res.cookie(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true, sameSite: 'lax', secure: IS_PROD, path: '/', maxAge: SESSION_DAYS * 86_400_000,
  });
}

function readSession(req: Request): { uid: string } | null {
  const raw = (req.headers.cookie ?? '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  const [payload, sig] = decodeURIComponent(raw.slice(COOKIE.length + 1)).split('.');
  if (!payload || !sig) return null;
  const want = Buffer.from(sign(payload));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof s.uid === 'string' && s.exp > Date.now() ? { uid: s.uid } : null;
  } catch {
    return null;
  }
}

export async function currentUser(req: Request): Promise<StoredUser | null> {
  const s = readSession(req);
  if (!s) return null;
  return (await loadUsers()).find((u) => u.id === s.uid) ?? null;
}

// ---------- login throttling ----------

const attempts = new Map<string, { n: number; until: number }>();
const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 8;
function throttled(key: string) {
  const a = attempts.get(key);
  return !!a && a.n >= MAX_ATTEMPTS && a.until > Date.now();
}
function failed(key: string) {
  const a = attempts.get(key);
  if (!a || a.until < Date.now()) attempts.set(key, { n: 1, until: Date.now() + WINDOW_MS });
  else a.n += 1;
}

// ---------- middleware ----------

declare module 'express-serve-static-core' {
  interface Request { user?: PublicUser }
}

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const u = await currentUser(req);
  if (!u) {
    res.status(401).json({ error: 'Please sign in.' });
    return;
  }
  req.user = toPublic(u);
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Only an admin can do this.' });
    return;
  }
  next();
}

// ---------- route handlers ----------

export async function me(req: Request, res: Response) {
  const users = await loadUsers();
  const u = await currentUser(req);
  res.json({ user: u ? toPublic(u) : null, setupNeeded: users.length === 0 });
}

export async function login(req: Request, res: Response) {
  const email = normEmail(req.body?.email);
  const password = String(req.body?.password ?? '');
  const key = `${req.ip}|${email}`;
  if (throttled(key)) {
    res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    return;
  }
  const user = (await loadUsers()).find((u) => u.email === email);
  if (!user || !(await verify(user, password))) {
    failed(key);
    res.status(401).json({ error: 'Email or password is incorrect.' });
    return;
  }
  attempts.delete(key);
  issue(res, user);
  res.json({ user: toPublic(user) });
}

export function logout(_req: Request, res: Response) {
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
}

/** Creates the first admin. Only works while there are no users, with SETUP_CODE. */
export async function setup(req: Request, res: Response) {
  const users = await loadUsers();
  const code = process.env.SETUP_CODE;
  const key = `${req.ip}|setup`;
  if (users.length) {
    res.status(409).json({ error: 'Setup is already done. Please sign in.' });
    return;
  }
  if (throttled(key)) {
    res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    return;
  }
  const given = Buffer.from(String(req.body?.code ?? ''));
  const want = Buffer.from(code ?? '');
  if (!code || given.length !== want.length || !timingSafeEqual(given, want)) {
    failed(key);
    res.status(403).json({ error: 'The setup code is not right.' });
    return;
  }
  const email = normEmail(req.body?.email);
  const name = String(req.body?.name ?? '').trim();
  const problem = !email.includes('@') ? 'Enter a valid email.' : !name ? 'Enter your name.' : checkPassword(req.body?.password);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  const user: StoredUser = { id: randomUUID(), email, name, role: 'admin', createdAt: new Date().toISOString(), ...(await hashPassword(req.body.password)) };
  await saveUsers([user]);
  issue(res, user);
  res.json({ user: toPublic(user) });
}

export async function listUsers(_req: Request, res: Response) {
  res.json((await loadUsers()).map(toPublic));
}

export async function addUser(req: Request, res: Response) {
  const users = await loadUsers();
  const email = normEmail(req.body?.email);
  const name = String(req.body?.name ?? '').trim();
  const role: Role = req.body?.role === 'admin' ? 'admin' : 'staff';
  const problem = !email.includes('@') ? 'Enter a valid email.' : !name ? 'Enter a name.'
    : users.some((u) => u.email === email) ? 'That email already has a login.' : checkPassword(req.body?.password);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  const user: StoredUser = { id: randomUUID(), email, name, role, createdAt: new Date().toISOString(), ...(await hashPassword(req.body.password)) };
  await saveUsers([...users, user]);
  res.json(toPublic(user));
}

export async function removeUser(req: Request, res: Response) {
  const users = await loadUsers();
  const target = users.find((u) => u.id === req.params.id);
  if (!target) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }
  if (target.id === req.user!.id) {
    res.status(400).json({ error: "You can't remove your own login." });
    return;
  }
  if (target.role === 'admin' && users.filter((u) => u.role === 'admin').length === 1) {
    res.status(400).json({ error: 'Keep at least one admin.' });
    return;
  }
  await saveUsers(users.filter((u) => u.id !== target.id));
  res.json({ ok: true });
}

/** Admin sets a new password for someone, or a user changes their own (needs the current one). */
export async function setPassword(req: Request, res: Response) {
  const users = await loadUsers();
  const targetId = req.params.id ?? req.user!.id;
  const self = targetId === req.user!.id;
  if (!self && req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Only an admin can do this.' });
    return;
  }
  const target = users.find((u) => u.id === targetId);
  if (!target) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }
  if (self && !(await verify(target, String(req.body?.current ?? '')))) {
    res.status(400).json({ error: 'Your current password is not right.' });
    return;
  }
  const problem = checkPassword(req.body?.password);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  Object.assign(target, await hashPassword(req.body.password));
  await saveUsers(users);
  res.json({ ok: true });
}
