import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Settings } from '../shared/types';
import { DATA_DIR } from './paths';
import { readPrivateJson } from './storage';

/** Repo defaults, overridden key by key by PRICE_DATA_DIR/settings.json when present. */
export async function getSettings(): Promise<Settings> {
  const base = JSON.parse(await readFile(path.join(DATA_DIR, 'settings.json'), 'utf8')) as Settings;
  const local = await readPrivateJson<Partial<Settings>>('settings.json');
  return local ? { ...base, ...local } : base;
}
