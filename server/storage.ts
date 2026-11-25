import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Private data (supplier trade prices) lives outside git. Set PRICE_DATA_DIR
 * on the server to a folder that survives redeploys.
 */
export const PRIVATE_DIR =
  process.env.PRICE_DATA_DIR ?? fileURLToPath(new URL('../data/private', import.meta.url));

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
