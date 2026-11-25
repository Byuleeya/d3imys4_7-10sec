// Build-time sanity check: every relative ES-module import must point to a shipped file.
// No network requests or credentials required.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = dirname(fileURLToPath(import.meta.url));
let imports = 0;
for (const file of readdirSync(base).filter(name => name.endsWith('.mjs'))) {
  const source = readFileSync(resolve(base, file), 'utf8');
  const pattern = /(?:\bfrom\s*|\bimport\s*\(?)\s*['"](\.[^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    const dep = resolve(base, dirname(file), match[1]);
    if (!existsSync(dep)) {
      throw new Error(`Missing relative import: ${file} -> ${match[1]}`);
    }
    imports++;
  }
}
console.log(`[Build check] ${imports} relative imports resolved; module packaging OK.`);
