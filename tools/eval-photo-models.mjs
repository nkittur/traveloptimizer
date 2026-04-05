#!/usr/bin/env node
// eval-photo-models: Compare Haiku, Sonnet, and Opus on photo grid evaluation
// Downloads thumbnails, builds labeled grids, saves them to eval-grids/,
// sends each grid to all 3 models, and compares results.
//
// Usage: node tools/eval-photo-models.mjs [places-json-file]
// Default: trips/places/squirrel-hill-pittsburgh-pa-breweries-outdoor-seating-food.json

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// Load API key
let API_KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!API_KEY) {
  try {
    const envFile = readFileSync(resolve(REPO_ROOT, '.env'), 'utf-8');
    const match = envFile.match(/GOOGLE_MAPS_API_KEY=(.+)/);
    if (match) API_KEY = match[1].trim();
  } catch {}
}
if (!API_KEY) { console.error('No GOOGLE_MAPS_API_KEY'); process.exit(1); }

const placesFile = process.argv[2] || resolve(REPO_ROOT,
  'trips/places/squirrel-hill-pittsburgh-pa-breweries-outdoor-seating-food.json');

const data = JSON.parse(readFileSync(placesFile, 'utf-8'));
const places = data.places;
const criteriaStr = 'outdoor seating area, patio, beer garden, outdoor space; food, food truck, kitchen';

// Output directory for grids
const GRID_DIR = resolve(REPO_ROOT, 'eval-grids');
mkdirSync(GRID_DIR, { recursive: true });

const THUMB_W = 150, THUMB_H = 110;
const COLS = 6, PADDING = 4, LABEL_H = 16;

async function main() {
  const sharp = (await import('sharp')).default;

  // Collect all photos with place info
  const allPhotos = [];
  places.forEach((place, pi) => {
    if (!place.photos) return;
    place.photos.forEach((ph, phi) => {
      allPhotos.push({ placeIdx: pi, photoIdx: phi, ref: ph.ref, place_name: place.name });
    });
  });

  console.error(`Total photos: ${allPhotos.length} from ${places.length} places`);

  // Download thumbnails (check cache first)
  const cacheDir = resolve(GRID_DIR, '.thumb-cache');
  mkdirSync(cacheDir, { recursive: true });

  const thumbBuffers = new Array(allPhotos.length).fill(null);

  for (let batch = 0; batch < allPhotos.length; batch += 15) {
    const promises = allPhotos.slice(batch, batch + 15).map(async (photo, bi) => {
      const idx = batch + bi;
      const cacheFile = resolve(cacheDir, `${idx}.jpg`);

      // Use cache if available
      if (existsSync(cacheFile)) {
        thumbBuffers[idx] = readFileSync(cacheFile);
        return;
      }

      try {
        const url = `https://places.googleapis.com/v1/${photo.ref}/media?maxHeightPx=${THUMB_H}&maxWidthPx=${THUMB_W}&key=${API_KEY}`;
        const res = await fetch(url);
        if (!res.ok) return;
        const buf = Buffer.from(await res.arrayBuffer());
        const thumb = await sharp(buf)
          .resize(THUMB_W, THUMB_H, { fit: 'cover' })
          .jpeg({ quality: 75 })
          .toBuffer();
        thumbBuffers[idx] = thumb;
        writeFileSync(cacheFile, thumb);
      } catch {}
    });
    await Promise.all(promises);
  }

  const validThumbs = thumbBuffers.map((buf, i) => buf ? { buf, idx: i } : null).filter(Boolean);
  console.error(`Downloaded ${validThumbs.length}/${allPhotos.length} thumbnails`);

  // Build grid pages (~60 per page)
  const PER_PAGE = 60;
  const cellW = THUMB_W + PADDING;
  const cellH = THUMB_H + LABEL_H + PADDING;
  const pages = [];
  for (let start = 0; start < validThumbs.length; start += PER_PAGE) {
    pages.push(validThumbs.slice(start, start + PER_PAGE));
  }

  const gridPaths = [];
  for (let pg = 0; pg < pages.length; pg++) {
    const pageThumbs = pages[pg];
    const rows = Math.ceil(pageThumbs.length / COLS);
    const gridW = COLS * cellW + PADDING;
    const gridH = rows * cellH + PADDING;

    const composites = [];
    for (let i = 0; i < pageThumbs.length; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = PADDING + col * cellW;
      const y = PADDING + LABEL_H + row * cellH;

      composites.push({ input: pageThumbs[i].buf, left: x, top: y });

      const globalIdx = pageThumbs[i].idx;
      const label = `${globalIdx + 1}. ${allPhotos[globalIdx].place_name.substring(0, 18)}`;
      const labelSvg = Buffer.from(
        `<svg width="${THUMB_W}" height="${LABEL_H}">
          <rect width="${THUMB_W}" height="${LABEL_H}" fill="#1a3a5c"/>
          <text x="3" y="12" font-family="Arial" font-size="10" fill="white" font-weight="bold">${label}</text>
        </svg>`
      );
      composites.push({ input: labelSvg, left: x, top: y - LABEL_H });
    }

    const gridPath = resolve(GRID_DIR, `grid-page-${pg + 1}.jpg`);
    await sharp({
      create: { width: gridW, height: gridH, channels: 3, background: { r: 240, g: 244, b: 248 } }
    }).composite(composites).jpeg({ quality: 85 }).toFile(gridPath);

    gridPaths.push({ path: gridPath, thumbs: pageThumbs });
    console.error(`Saved grid page ${pg + 1}: ${gridPath} (${pageThumbs.length} photos, ${gridW}x${gridH})`);
  }

  // Build the prompt
  const promptText = `This is a grid of numbered photos from various breweries/restaurants. I'm searching for places with: ${criteriaStr}.

For EACH numbered photo, score it 0-10 on how well it shows outdoor seating/patio/beer garden or food:
- 10: Clear outdoor patio with seating, beer garden, outdoor dining area
- 7-9: Partially outdoor, covered patio, visible outdoor space
- 4-6: Ambiguous - could be outdoor but unclear
- 1-3: Mostly interior but has some relevant element
- 0: Interior shot, logo, beer taps, close-up of drinks, building exterior without seating

Return ONLY a JSON array: [{"n":1,"s":8,"reason":"outdoor patio with tables"},{"n":2,"s":0,"reason":"interior bar shot"},...] for ALL photos. n=photo number, s=score, reason=brief why.`;

  // Run all 3 models on each grid
  const models = ['haiku', 'sonnet', 'opus'];
  const results = {};

  for (const grid of gridPaths) {
    console.error(`\n--- Evaluating ${grid.path} ---`);

    // Run all 3 models in parallel
    const modelPromises = models.map(async (model) => {
      const start = Date.now();
      try {
        const result = execSync(
          `claude -p ${JSON.stringify(promptText)} --model ${model} --allowedTools Read <<< "Read the image at ${grid.path}"`,
          { timeout: 120000, maxBuffer: 4 * 1024 * 1024, shell: '/bin/bash' }
        ).toString().trim();
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);

        const scoresMatch = result.match(/\[[\s\S]*\]/);
        if (scoresMatch) {
          const scores = JSON.parse(scoresMatch[0]);
          console.error(`  ${model}: ${scores.length} scores in ${elapsed}s`);
          return { model, scores, elapsed, raw: result };
        } else {
          console.error(`  ${model}: could not parse response (${elapsed}s)`);
          console.error(`  Raw: ${result.substring(0, 200)}`);
          return { model, scores: [], elapsed, raw: result };
        }
      } catch (err) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.error(`  ${model}: FAILED (${elapsed}s) - ${err.message.substring(0, 100)}`);
        return { model, scores: [], elapsed, error: err.message };
      }
    });

    const modelResults = await Promise.all(modelPromises);
    for (const r of modelResults) {
      if (!results[r.model]) results[r.model] = [];
      results[r.model].push(...r.scores);
    }
  }

  // Build comparison report
  console.log('\n' + '='.repeat(80));
  console.log('PHOTO EVALUATION MODEL COMPARISON');
  console.log('='.repeat(80));

  // Create a lookup: photo number -> scores from each model
  const comparison = {};
  for (const model of models) {
    for (const entry of (results[model] || [])) {
      const n = entry.n || entry.num || entry.number;
      if (!comparison[n]) comparison[n] = { photo: n };
      comparison[n][model] = { score: entry.s || entry.score || 0, reason: entry.reason || '' };
    }
  }

  // Sort by opus score (our "gold standard")
  const sorted = Object.values(comparison).sort((a, b) =>
    (b.opus?.score || 0) - (a.opus?.score || 0)
  );

  // Print top-rated photos (by Opus)
  console.log('\n--- TOP RATED BY OPUS (score >= 6) ---');
  console.log(String('Photo#').padEnd(8) + String('Place').padEnd(22) +
    String('Haiku').padEnd(8) + String('Sonnet').padEnd(8) + String('Opus').padEnd(8) + 'Opus Reason');
  console.log('-'.repeat(90));

  for (const row of sorted) {
    const opusScore = row.opus?.score ?? '-';
    if (typeof opusScore === 'number' && opusScore < 6) break;

    const photoIdx = row.photo - 1;
    const placeName = allPhotos[photoIdx]?.place_name || '?';
    const haiku = row.haiku?.score ?? '-';
    const sonnet = row.sonnet?.score ?? '-';
    const reason = row.opus?.reason || '';

    console.log(
      String(row.photo).padEnd(8) +
      placeName.substring(0, 20).padEnd(22) +
      String(haiku).padEnd(8) +
      String(sonnet).padEnd(8) +
      String(opusScore).padEnd(8) +
      reason.substring(0, 50)
    );
  }

  // Print bottom-rated by Opus but high by Haiku (Haiku false positives)
  console.log('\n--- HAIKU FALSE POSITIVES (Haiku >= 6, Opus <= 3) ---');
  console.log(String('Photo#').padEnd(8) + String('Place').padEnd(22) +
    String('Haiku').padEnd(8) + String('Sonnet').padEnd(8) + String('Opus').padEnd(8) +
    'Haiku Reason | Opus Reason');
  console.log('-'.repeat(100));

  const falsePos = sorted.filter(r =>
    (r.haiku?.score || 0) >= 6 && (r.opus?.score || 0) <= 3
  ).sort((a, b) => (b.haiku?.score || 0) - (a.haiku?.score || 0));

  for (const row of falsePos) {
    const photoIdx = row.photo - 1;
    const placeName = allPhotos[photoIdx]?.place_name || '?';
    console.log(
      String(row.photo).padEnd(8) +
      placeName.substring(0, 20).padEnd(22) +
      String(row.haiku?.score ?? '-').padEnd(8) +
      String(row.sonnet?.score ?? '-').padEnd(8) +
      String(row.opus?.score ?? '-').padEnd(8) +
      `${(row.haiku?.reason || '').substring(0, 30)} | ${(row.opus?.reason || '').substring(0, 30)}`
    );
  }

  // Summary stats
  console.log('\n--- SUMMARY STATISTICS ---');
  for (const model of models) {
    const scores = (results[model] || []).map(e => e.s || e.score || 0);
    if (scores.length === 0) { console.log(`${model}: no scores`); continue; }
    const avg = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
    const high = scores.filter(s => s >= 6).length;
    const low = scores.filter(s => s <= 2).length;
    console.log(`${model.padEnd(8)}: avg=${avg}, high(>=6)=${high}, low(<=2)=${low}, total=${scores.length}`);
  }

  // Correlation between models
  console.log('\n--- MODEL AGREEMENT ---');
  const pairs = [['haiku', 'opus'], ['sonnet', 'opus'], ['haiku', 'sonnet']];
  for (const [m1, m2] of pairs) {
    let agree = 0, disagree = 0, total = 0;
    for (const row of Object.values(comparison)) {
      const s1 = row[m1]?.score, s2 = row[m2]?.score;
      if (s1 == null || s2 == null) continue;
      total++;
      // "agree" = both high (>=5) or both low (<5)
      if ((s1 >= 5) === (s2 >= 5)) agree++;
      else disagree++;
    }
    if (total > 0) {
      console.log(`${m1} vs ${m2}: ${agree}/${total} agree (${(100*agree/total).toFixed(0)}%), ${disagree} disagree`);
    }
  }

  // Save full results JSON for further analysis
  const resultsPath = resolve(GRID_DIR, 'model-comparison.json');
  writeFileSync(resultsPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    source: placesFile,
    photos: allPhotos.map((p, i) => ({ idx: i + 1, place: p.place_name })),
    results: comparison,
    summary: { models, totalPhotos: allPhotos.length, evaluated: Object.keys(comparison).length }
  }, null, 2));
  console.log(`\nFull results saved to: ${resultsPath}`);
  console.log(`Grid images saved to: ${GRID_DIR}/`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
