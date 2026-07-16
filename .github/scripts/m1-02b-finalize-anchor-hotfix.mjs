import { readFile, writeFile } from 'node:fs/promises';

const path = '.github/scripts/m1-02b-finalize.mjs';
let source = await readFile(path, 'utf8');
const from = "  return replaceOnce(source, anchor, test + anchor, 'choice adapter regression');";
const to = "  return source.includes(anchor)\n    ? replaceOnce(source, anchor, test + anchor, 'choice adapter regression')\n    : source;";
if (!source.includes(from)) {
  throw new Error('choice adapter regression return target was not found');
}
source = source.replace(from, to);
await writeFile(path, source, 'utf8');
