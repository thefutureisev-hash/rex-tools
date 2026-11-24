import { readFile } from 'node:fs/promises';
import type { Settings } from '../shared/types';

export async function getSettings(): Promise<Settings> {
  return JSON.parse(await readFile(new URL('../data/settings.json', import.meta.url), 'utf8'));
}
