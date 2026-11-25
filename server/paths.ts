import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * The app's root folder (holding package.json, data/ and dist/). Normally the
 * folder the server is started from; otherwise the folder above the built
 * server bundle (dist-server/index.mjs), or APP_ROOT if set.
 */
function findRoot(): string {
  const candidates = [
    process.env.APP_ROOT,
    process.cwd(),
    process.argv[1] ? path.resolve(path.dirname(process.argv[1]), '..') : undefined,
  ].filter(Boolean) as string[];
  return candidates.find((c) => existsSync(path.join(c, 'data', 'settings.json'))) ?? process.cwd();
}

export const APP_ROOT = findRoot();
export const DATA_DIR = path.join(APP_ROOT, 'data');
export const DIST_DIR = path.join(APP_ROOT, 'dist');
