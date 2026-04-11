#!/usr/bin/env node
// enrich-group-all.mjs — Run the full post-discovery enrichment pipeline:
//   geocode → details → photos → compute-target-area
// Usage: node tools/enrich-group-all.mjs <group-id>
import { spawn } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const groupId = process.argv[2];
if (!groupId) { console.error('Usage: enrich-group-all.mjs <group-id>'); process.exit(1); }

const steps = [
  'enrich-group-geocode.mjs',
  'enrich-group-details.mjs',
  'enrich-group-photos.mjs',
  'compute-target-area.mjs',
];

for (const step of steps) {
  console.log(`\n── ${step} ──`);
  await new Promise((resolveStep, reject) => {
    const child = spawn('node', [resolve(__dirname, step), groupId], { stdio: 'inherit' });
    child.on('exit', (code) => code === 0 ? resolveStep() : reject(new Error(`${step} exited ${code}`)));
  });
}

console.log(`\n✓ Full enrichment complete for ${groupId}`);
console.log(`  Share link: https://webapp-rust-phi.vercel.app/?g=${groupId}`);
