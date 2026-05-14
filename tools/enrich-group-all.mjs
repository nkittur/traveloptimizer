#!/usr/bin/env node
// enrich-group-all.mjs — Run the full post-discovery enrichment pipeline.
//
// As of Phase 3, this is now just:
//   enrich-group-combined.mjs → compute-target-area.mjs
// The combined script handles what used to be geocode + details + photos +
// outdoor-seating in a single Places API call per row (Atmosphere tier).
//
// Pass --force through to make it re-fetch every row (with a confirmation).
// Usage:
//   node tools/enrich-group-all.mjs <group-id> [--force]
import { spawn } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const groupId = args.find(a => !a.startsWith('--'));
const passthrough = args.filter(a => a.startsWith('--'));
if (!groupId) { console.error('Usage: enrich-group-all.mjs <group-id> [--force]'); process.exit(1); }

const steps = [
  { script: 'enrich-group-combined.mjs', args: [groupId, ...passthrough] },
  { script: 'compute-target-area.mjs',   args: [groupId] },
];

for (const { script, args } of steps) {
  console.log(`\n── ${script} ──`);
  await new Promise((done, reject) => {
    const child = spawn('node', [resolve(__dirname, script), ...args], { stdio: 'inherit' });
    child.on('exit', (code) => code === 0 ? done() : reject(new Error(`${script} exited ${code}`)));
  });
}

console.log(`\n✓ Full enrichment complete for ${groupId}`);
console.log(`  Share link: https://webapp-rust-phi.vercel.app/?g=${groupId}`);
