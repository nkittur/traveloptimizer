#!/usr/bin/env node
// Test different thumbnail sizes for grid-based photo classification accuracy.
// Uses a test set of photos with known ground truth (verified outdoor vs not).
// Downloads each photo at multiple sizes, builds grids, sends to Opus, compares.
//
// Usage: node tools/eval-thumb-sizes.mjs [test-set.json]

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(execCb);

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

let API_KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!API_KEY) {
  try {
    const envFile = readFileSync(resolve(REPO_ROOT, '.env'), 'utf-8');
    const match = envFile.match(/GOOGLE_MAPS_API_KEY=(.+)/);
    if (match) API_KEY = match[1].trim();
  } catch {}
}

const testSetFile = process.argv[2] || '/tmp/photo-test-set.json';
const testPhotos = JSON.parse(readFileSync(testSetFile, 'utf-8'));

// Test these thumbnail sizes (width x height)
const SIZES = [
  { w: 150, h: 110, label: '150x110 (current)' },
  { w: 200, h: 150, label: '200x150' },
  { w: 300, h: 225, label: '300x225' },
  { w: 400, h: 300, label: '400x300' },
];

// Use a subset of ~16 photos for the test (mix of outdoor and not)
const outdoor = testPhotos.filter(p => p.truth === 'outdoor');
const notOutdoor = testPhotos.filter(p => p.truth === 'NOT outdoor');
// Take all outdoor (2) + 14 random not-outdoor for a 16-photo grid
const sample = [...outdoor, ...notOutdoor.slice(0, 14)];
// Shuffle
for (let i = sample.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [sample[i], sample[j]] = [sample[j], sample[i]];
}

console.error(`Test set: ${sample.length} photos (${outdoor.length} outdoor, ${sample.length - outdoor.length} not-outdoor)`);

const COLS = 4;
const PADDING = 4;

async function main() {
  const sharp = (await import('sharp')).default;
  const outDir = resolve(REPO_ROOT, 'eval-grids');
  mkdirSync(outDir, { recursive: true });

  const results = {};

  for (const size of SIZES) {
    console.error(`\n=== Testing ${size.label} ===`);
    const LABEL_H = size.h > 200 ? 20 : 16;
    const cellW = size.w + PADDING;
    const cellH = size.h + LABEL_H + PADDING;
    const rows = Math.ceil(sample.length / COLS);
    const gridW = COLS * cellW + PADDING;
    const gridH = rows * cellH + PADDING;

    // Download and resize
    const composites = [];
    for (let i = 0; i < sample.length; i++) {
      const photo = sample[i];
      try {
        const url = `https://places.googleapis.com/v1/${photo.ref}/media?maxHeightPx=${size.h}&maxWidthPx=${size.w}&key=${API_KEY}`;
        const res = await fetch(url);
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        const thumb = await sharp(buf)
          .resize(size.w, size.h, { fit: 'cover' })
          .jpeg({ quality: 75 })
          .toBuffer();

        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const x = PADDING + col * cellW;
        const y = PADDING + LABEL_H + row * cellH;

        composites.push({ input: thumb, left: x, top: y });

        const label = `${i + 1}. ${photo.place.substring(0, 20)}`;
        const escaped = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const fontSize = size.h > 200 ? 12 : 10;
        const labelSvg = Buffer.from(
          `<svg width="${size.w}" height="${LABEL_H}">
            <rect width="${size.w}" height="${LABEL_H}" fill="#1a3a5c"/>
            <text x="3" y="${LABEL_H - 4}" font-family="Arial" font-size="${fontSize}" fill="white" font-weight="bold">${escaped}</text>
          </svg>`
        );
        composites.push({ input: labelSvg, left: x, top: y - LABEL_H });
      } catch (err) {
        console.error(`  Photo ${i + 1} download failed: ${err.message.substring(0, 40)}`);
      }
    }

    const gridPath = resolve(outDir, `thumb-test-${size.w}x${size.h}.jpg`);
    await sharp({
      create: { width: gridW, height: gridH, channels: 3, background: { r: 240, g: 244, b: 248 } }
    }).composite(composites).jpeg({ quality: 85 }).toFile(gridPath);

    console.error(`  Grid saved: ${gridPath} (${gridW}x${gridH})`);

    // Send to Opus
    const promptText = `This is a grid of ${sample.length} numbered photos from various breweries/restaurants. I'm searching for: outdoor seating area, patio, beer garden, outdoor space.

For EACH photo, determine if it shows ACTUAL outdoor seating/patio/beer garden. Look carefully for: open sky, natural light from above, outdoor furniture, trees/plants in the setting, no ceiling.

Return ONLY a JSON array: [{"n":1,"outdoor":true,"desc":"brief description"},{"n":2,"outdoor":false,"desc":"brief description"},...] for ALL photos.`;

    console.error(`  Sending to Opus...`);
    const start = Date.now();
    try {
      const { stdout: result } = await execAsync(
        `claude -p ${JSON.stringify(promptText)} --model opus --allowedTools Read <<< "Read the image at ${gridPath}"`,
        { timeout: 180000, maxBuffer: 4 * 1024 * 1024, shell: '/bin/bash' }
      );
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);

      const jsonMatch = result.trim().match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        const scores = JSON.parse(jsonMatch[0]);
        console.error(`  Opus scored ${scores.length} photos in ${elapsed}s`);

        // Compare with ground truth
        let tp = 0, fp = 0, tn = 0, fn = 0;
        const details = [];
        for (const s of scores) {
          const idx = (s.n || s.num || 1) - 1;
          if (idx < 0 || idx >= sample.length) continue;
          const truth = sample[idx].truth === 'outdoor';
          const predicted = s.outdoor === true;

          if (truth && predicted) tp++;
          else if (!truth && predicted) fp++;
          else if (!truth && !predicted) tn++;
          else if (truth && !predicted) fn++;

          if (predicted !== truth) {
            details.push({
              n: s.n,
              place: sample[idx].place,
              truth: sample[idx].truth,
              predicted: predicted ? 'outdoor' : 'NOT outdoor',
              desc: s.desc,
            });
          }
        }

        const precision = tp + fp > 0 ? (tp / (tp + fp) * 100).toFixed(0) : 'N/A';
        const recall = tp + fn > 0 ? (tp / (tp + fn) * 100).toFixed(0) : 'N/A';
        const accuracy = ((tp + tn) / (tp + fp + tn + fn) * 100).toFixed(0);
        const fpr = (fp / (fp + tn) * 100).toFixed(0);

        results[size.label] = { tp, fp, tn, fn, precision, recall, accuracy, fpr, elapsed, errors: details };

        console.error(`  Results: TP=${tp} FP=${fp} TN=${tn} FN=${fn}`);
        console.error(`  Accuracy=${accuracy}% Precision=${precision}% FPR=${fpr}% (${elapsed}s)`);
        if (details.length) {
          console.error(`  Errors:`);
          details.forEach(d => console.error(`    #${d.n} ${d.place}: ${d.truth} → predicted ${d.predicted} (${d.desc?.substring(0, 50)})`));
        }
      } else {
        console.error(`  Could not parse response (${elapsed}s)`);
      }
    } catch (err) {
      console.error(`  Opus failed: ${err.message.substring(0, 80)}`);
    }
  }

  // Summary table
  console.log('\n' + '='.repeat(80));
  console.log('THUMBNAIL SIZE ACCURACY COMPARISON');
  console.log('='.repeat(80));
  console.log(String('Size').padEnd(22) + String('Acc').padEnd(8) + String('Prec').padEnd(8) +
    String('FPR').padEnd(8) + String('TP').padEnd(5) + String('FP').padEnd(5) +
    String('TN').padEnd(5) + String('FN').padEnd(5) + 'Time');
  console.log('-'.repeat(72));
  for (const [label, r] of Object.entries(results)) {
    console.log(label.padEnd(22) + String(r.accuracy + '%').padEnd(8) +
      String(r.precision + '%').padEnd(8) + String(r.fpr + '%').padEnd(8) +
      String(r.tp).padEnd(5) + String(r.fp).padEnd(5) +
      String(r.tn).padEnd(5) + String(r.fn).padEnd(5) + r.elapsed + 's');
  }

  writeFileSync(resolve(outDir, 'thumb-size-results.json'), JSON.stringify({ sample: sample.map((s, i) => ({ idx: i + 1, place: s.place, truth: s.truth })), results }, null, 2));
  console.log(`\nFull results: ${resolve(outDir, 'thumb-size-results.json')}`);
  console.log(`Grid images: ${outDir}/thumb-test-*.jpg`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
