// After `vite build`: write a Brotli (.br) and a gzip (.gz) copy of every text file in dist, at the highest
// settings, so the server never compresses anything while a player waits (server/staticFiles.js picks the copy).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const TEXT = /\.(js|mjs|css|html|svg|json|txt|map|wasm)$/;

let before = 0, br = 0, gz = 0, n = 0;
const walk = (dir) => {
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    if (fs.statSync(file).isDirectory()) { walk(file); continue; }
    if (!TEXT.test(name)) continue;
    const data = fs.readFileSync(file);
    const b = zlib.brotliCompressSync(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length } });
    const g = zlib.gzipSync(data, { level: 9 });
    fs.writeFileSync(`${file}.br`, b);
    fs.writeFileSync(`${file}.gz`, g);
    before += data.length; br += b.length; gz += g.length; n++;
  }
};
walk(DIST);
const kb = (v) => `${Math.round(v / 1024)} KB`;
console.log(`precompress: ${n} files, ${kb(before)} -> ${kb(br)} Brotli, ${kb(gz)} gzip`);
