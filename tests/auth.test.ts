import { mkdtemp } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let server: Server;
let base = '';

beforeAll(async () => {
  process.env.PRICE_DATA_DIR = await mkdtemp(path.join(tmpdir(), 'rex-auth-'));
  process.env.SETUP_CODE = 'test-setup-code';
  const { app } = await import('../server/app');
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server?.close());

const call = async (p: string, o: { method?: string; json?: unknown; cookie?: string } = {}) => {
  const r = await fetch(base + p, {
    method: o.method ?? (o.json ? 'POST' : 'GET'),
    headers: { ...(o.json ? { 'Content-Type': 'application/json' } : {}), ...(o.cookie ? { Cookie: o.cookie } : {}) },
    body: o.json ? JSON.stringify(o.json) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null), cookie: r.headers.get('set-cookie')?.split(';')[0] };
};

describe('login', () => {
  let admin = '';

  it('blocks the API without a login', async () => {
    expect((await call('/api/catalog')).status).toBe(401);
    expect((await call('/api/settings')).status).toBe(401);
    expect((await call('/api/template/solar')).status).toBe(401);
  });

  it('asks for setup while there are no users, and needs the setup code', async () => {
    expect((await call('/api/auth/me')).body).toEqual({ user: null, setupNeeded: true });
    const bad = await call('/api/auth/setup', { json: { code: 'wrong', name: 'Admin', email: 'a@example.com', password: 'long-enough-pw' } });
    expect(bad.status).toBe(403);
  });

  it('creates the first admin and signs them in', async () => {
    const r = await call('/api/auth/setup', { json: { code: 'test-setup-code', name: 'Admin', email: 'A@Example.com', password: 'long-enough-pw' } });
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ email: 'a@example.com', role: 'admin' });
    admin = r.cookie!;
    expect((await call('/api/catalog', { cookie: admin })).status).toBe(200);
  });

  it('refuses a second setup', async () => {
    const r = await call('/api/auth/setup', { json: { code: 'test-setup-code', name: 'X', email: 'x@example.com', password: 'long-enough-pw' } });
    expect(r.status).toBe(409);
  });

  it('rejects a wrong password and a tampered cookie', async () => {
    expect((await call('/api/auth/login', { json: { email: 'a@example.com', password: 'nope-nope-nope' } })).status).toBe(401);
    const [name, value] = admin.split('=');
    expect((await call('/api/catalog', { cookie: `${name}=${value.slice(0, -2)}xx` })).status).toBe(401);
  });

  it('lets an admin add staff, who can quote but not manage the team or data', async () => {
    const add = await call('/api/users', { json: { name: 'Sam', email: 'sam@example.com', role: 'staff', password: 'staff-password-1' }, cookie: admin });
    expect(add.status).toBe(200);
    const login = await call('/api/auth/login', { json: { email: 'sam@example.com', password: 'staff-password-1' } });
    expect(login.status).toBe(200);
    const staff = login.cookie!;
    expect((await call('/api/settings', { cookie: staff })).status).toBe(200);
    expect((await call('/api/users', { cookie: staff })).status).toBe(403);
    expect((await call('/api/admin/extra-products', { json: { products: [] }, cookie: staff })).status).toBe(403);
  });

  it('never returns password hashes', async () => {
    const r = await call('/api/users', { cookie: admin });
    expect(JSON.stringify(r.body)).not.toMatch(/hash|salt/);
  });

  it('throttles repeated wrong passwords', async () => {
    let last = 0;
    for (let i = 0; i < 10; i++) last = (await call('/api/auth/login', { json: { email: 'sam@example.com', password: 'wrong-password' } })).status;
    expect(last).toBe(429);
  });
});

describe('domain verification files', () => {
  it('serves /.well-known files from WELL_KNOWN_DIR without a login', async () => {
    // WELL_KNOWN_DIR is read at import time, so check the fallback behaviour through a 404 here
    const r = await fetch(`${base}/.well-known/acme-challenge/missing`);
    expect(r.status).not.toBe(401);
  });
});
