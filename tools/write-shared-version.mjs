// Writes worker/generated/sharedVersion.js: the fingerprint of shared/*.js (server/sharedVersion.js), which a Worker
// can't work out itself because it has no files to read. wrangler runs this before every build (wrangler.jsonc).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sharedCodeVersion } from '../server/sharedVersion.js';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../worker/generated/sharedVersion.js');
fs.mkdirSync(path.dirname(out), { recursive: true });
const text = `// Written by tools/write-shared-version.mjs. Don't edit.\nexport const SHARED_VERSION = '${sharedCodeVersion()}';\n`;
// Only when it changed: wrangler watches worker/, and rewriting it every time would rebuild for ever
if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== text) fs.writeFileSync(out, text);
