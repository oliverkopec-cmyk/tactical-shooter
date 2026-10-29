// Fingerprint of the shared simulation code (shared/*.js). The client is built
// with the same fingerprint (vite.config.js) and sends it when connecting. A
// page built from different shared code would predict movement differently
// from the server and jitter, so the server turns it away and the page reloads.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHARED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shared');

export function sharedCodeVersion() {
  const hash = crypto.createHash('sha256');
  for (const file of fs.readdirSync(SHARED).filter((f) => f.endsWith('.js')).sort()) {
    hash.update(file);
    hash.update(fs.readFileSync(path.join(SHARED, file)));
  }
  return hash.digest('hex').slice(0, 12);
}
