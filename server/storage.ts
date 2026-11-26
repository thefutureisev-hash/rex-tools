import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './paths';

/**
 * Private data (supplier trade prices) lives outside git. Set PRICE_DATA_DIR
 * on the server to a folder that survives redeploys.
 */
export const PRIVATE_DIR = process.env.PRICE_DATA_DIR ?? path.join(DATA_DIR, 'private');

export async function readPrivateJson<T>(name: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path.join(PRIVATE_DIR, name), 'utf8'));
  } catch {
    return null;
  }
}

export async function writePrivateJson(name: string, data: unknown) {
  await mkdir(PRIVATE_DIR, { recursive: true });
  await writeFile(path.join(PRIVATE_DIR, name), JSON.stringify(data, null, 1));
}

export async function readPrivateFile(name: string): Promise<Buffer | null> {
  try {
    return await readFile(path.join(PRIVATE_DIR, name));
  } catch {
    return null;
  }
}

export async function writePrivateFile(name: string, data: Uint8Array) {
  const file = path.join(PRIVATE_DIR, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
}

/** Size and last-modified time of a private file, or null if it isn't there. */
export async function statPrivateFile(name: string): Promise<{ bytes: number; updatedAt: string } | null> {
  try {
    const s = await stat(path.join(PRIVATE_DIR, name));
    return { bytes: s.size, updatedAt: s.mtime.toISOString() };
  } catch {
    return null;
  }
}
