#!/usr/bin/env node
// nearby-places: Search for nearby places using Google Places API, return structured JSON
// Usage: node tools/nearby-places.mjs "query" "location"
// Example: node tools/nearby-places.mjs "outdoor patio beer" "Ross Park Mall Pittsburgh"
//
// Requires GOOGLE_MAPS_API_KEY in .env or environment
// Falls back to Playwright scraping if no API key

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync, exec as execCb } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(execCb);

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// Load API key from .env
let API_KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!API_KEY) {
  try {
    const envFile = readFileSync(resolve(REPO_ROOT, '.env'), 'utf-8');
    const match = envFile.match(/GOOGLE_MAPS_API_KEY=(.+)/);
    if (match) API_KEY = match[1].trim();
  } catch {}
}

const query = process.argv[2];
const location = process.argv[3] || '';
const radius = process.argv[4] || '5000'; // meters, default 5km

if (!query) {
  console.error('Usage: node tools/nearby-places.mjs "query" [location] [radius_meters]');
  console.error('Example: node tools/nearby-places.mjs "outdoor patio beer" "Ross Park Mall Pittsburgh" 3000');
  process.exit(1);
}

// ==========================================
// Google Places API (New) approach
// ==========================================

async function geocode(address) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.results && data.results.length > 0) {
    return data.results[0].geometry.location; // { lat, lng }
  }
  return null;
}

async function searchPlacesAPI(textQuery, locationBias, targetCount = 25) {
  const url = 'https://places.googleapis.com/v1/places:searchText';
  const PAGE_SIZE = 20; // API max per request

  const baseBody = {
    textQuery: textQuery,
    maxResultCount: PAGE_SIZE,
    languageCode: 'en',
  };

  if (locationBias) {
    baseBody.locationBias = {
      circle: {
        center: {
          latitude: locationBias.lat,
          longitude: locationBias.lng
        },
        radius: parseFloat(radius)
      }
    };
  }

  const fieldMask = [
    'places.displayName',
    'places.formattedAddress',
    'places.rating',
    'places.userRatingCount',
    'places.priceLevel',
    'places.primaryType',
    'places.primaryTypeDisplayName',
    'places.currentOpeningHours',
    'places.regularOpeningHours',
    'places.outdoorSeating',
    'places.servesBeer',
    'places.servesWine',
    'places.servesCocktails',
    'places.servesCoffee',
    'places.servesDessert',
    'places.servesBreakfast',
    'places.servesLunch',
    'places.servesDinner',
    'places.dineIn',
    'places.takeout',
    'places.delivery',
    'places.liveMusic',
    'places.goodForGroups',
    'places.goodForChildren',
    'places.allowsDogs',
    'places.restroom',
    'places.editorialSummary',
    'places.googleMapsUri',
    'places.websiteUri',
    'places.location',
    'places.shortFormattedAddress',
    'places.reviews',
    'places.photos',
    'nextPageToken',
  ].join(',');

  let allPlaces = [];
  let pageToken = null;
  let page = 0;

  while (allPlaces.length < targetCount) {
    const body = { ...baseBody };
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': fieldMask
      },
      body: JSON.stringify(body)
    });

    const data = await res.json();

    if (data.error) {
      if (page === 0) {
        console.error('API Error:', JSON.stringify(data.error, null, 2));
        return null;
      }
      break; // Got some results, stop paginating
    }

    if (data.places) allPlaces.push(...data.places);
    page++;

    if (data.nextPageToken && allPlaces.length < targetCount) {
      pageToken = data.nextPageToken;
      console.error(`  Page ${page}: ${allPlaces.length} results, fetching more...`);
    } else {
      break;
    }
  }

  console.error(`  Total: ${allPlaces.length} results from ${page} page(s)`);

  if (!allPlaces.length) return [];

  // Transform to clean output
  return allPlaces.map(p => {
    const isOpenNow = p.currentOpeningHours?.openNow ?? null;

    // Get today's hours
    let todayHours = null;
    if (p.currentOpeningHours?.weekdayDescriptions) {
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const today = days[new Date().getDay()];
      todayHours = p.currentOpeningHours.weekdayDescriptions.find(d => d.startsWith(today)) || null;
    }

    return {
      name: p.displayName?.text || null,
      address: p.shortFormattedAddress || p.formattedAddress || null,
      full_address: p.formattedAddress || null,
      rating: p.rating || null,
      review_count: p.userRatingCount || null,
      price_level: p.priceLevel || null,
      type: p.primaryTypeDisplayName?.text || p.primaryType || null,
      description: p.editorialSummary?.text || null,
      open_now: isOpenNow,
      today_hours: todayHours,
      outdoor_seating: p.outdoorSeating ?? null,
      serves_beer: p.servesBeer ?? null,
      serves_wine: p.servesWine ?? null,
      serves_cocktails: p.servesCocktails ?? null,
      serves_coffee: p.servesCoffee ?? null,
      dine_in: p.dineIn ?? null,
      live_music: p.liveMusic ?? null,
      good_for_groups: p.goodForGroups ?? null,
      allows_dogs: p.allowsDogs ?? null,
      google_maps_url: p.googleMapsUri || null,
      website: p.websiteUri || null,
      location: p.location ? { lat: p.location.latitude, lng: p.location.longitude } : null,
      reviews: (p.reviews || []).map(r => ({
        text: r.text?.text || null,
        rating: r.rating || null,
        time: r.relativePublishTimeDescription || null,
      })).filter(r => r.text),
      photos: (p.photos || []).map(ph => ({
        ref: ph.name,
        width: ph.widthPx || null,
        height: ph.heightPx || null,
      })).filter(ph => ph.ref),
    };
  });
}

// Review filter definitions — reviews matching these patterns are tagged for potential exclusion
const REVIEW_FILTERS = {
  service_complaints: {
    label: 'Service complaints',
    patterns: ['rude', 'slow service', 'bad service', 'terrible service', 'worst service', 'waited forever',
      'ignored', 'unfriendly', 'unprofessional', 'never came back', 'manager', 'complained'],
  },
  tipping: {
    label: 'Tipping complaints',
    patterns: ['tip', 'tipping', 'gratuity', 'auto-grat', 'service charge', '18%', '20%'],
  },
  price_complaints: {
    label: 'Price complaints',
    patterns: ['overpriced', 'too expensive', 'not worth the price', 'rip off', 'ripoff', 'pricey for what',
      'highway robbery', 'way too much', 'ridiculous price'],
  },
  cheesy_rich: {
    label: 'Likes cheesy/rich food',
    patterns: ['extra cheese', 'so cheesy', 'loaded with cheese', 'mac and cheese was amazing',
      'cheese was perfect', 'creamy', 'rich and decadent', 'butter', 'double bacon'],
  },
  low_quality: {
    label: 'Low quality review',
    patterns: [], // detected by length/content heuristics
    heuristic: (text) => text.length < 30 || /^(great|good|nice|ok|meh|bad|terrible|awesome|love it|cool)\s*$/i.test(text.trim()),
  },
};

// Extract evidence sentences from reviews + tag reviews with filter flags
function extractEvidence(places, query) {
  const q = (query || '').toLowerCase();

  // Build keyword groups for differentiator criteria
  const evidenceKeywords = {};
  if (q.match(/outdoor|patio|outside|terrace|garden|deck/)) {
    evidenceKeywords.outdoor = ['outdoor', 'patio', 'outside', 'terrace', 'beer garden', 'garden', 'deck', 'fire pit', 'picnic', 'courtyard', 'al fresco', 'open air'];
  }
  if (q.match(/food|truck|eat|kitchen|menu/)) {
    evidenceKeywords.food = ['food', 'food truck', 'kitchen', 'pizza', 'menu', 'eat', 'bites', 'snack', 'chef', 'smoker', 'grill', 'taco'];
  }
  if (q.match(/music|live|band|entertainment/)) {
    evidenceKeywords.music = ['music', 'live', 'band', 'concert', 'dj', 'entertainment', 'acoustic'];
  }
  if (q.match(/dog|pet/)) {
    evidenceKeywords.dogs = ['dog', 'pet', 'pup', 'fur', 'four-legged'];
  }

  for (const place of places) {
    place.evidence = [];

    // Tag each review with filter flags
    for (const review of (place.reviews || [])) {
      if (!review.text) continue;
      const textLower = review.text.toLowerCase();
      review._filters = [];
      for (const [filterId, filter] of Object.entries(REVIEW_FILTERS)) {
        if (filter.heuristic && filter.heuristic(review.text)) {
          review._filters.push(filterId);
        } else if (filter.patterns.some(p => textLower.includes(p))) {
          review._filters.push(filterId);
        }
      }
    }

    if (!place.reviews || !place.reviews.length || Object.keys(evidenceKeywords).length === 0) continue;

    for (const review of place.reviews) {
      if (!review.text) continue;
      const sentences = review.text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 15);

      for (const sentence of sentences) {
        const sLower = sentence.toLowerCase();
        for (const [category, keywords] of Object.entries(evidenceKeywords)) {
          const matched = keywords.find(kw => sLower.includes(kw));
          if (matched) {
            if (!place.evidence.some(e => e.text === sentence)) {
              place.evidence.push({
                text: sentence,
                category,
                keyword: matched,
                source: review.source || 'review',
                review_rating: review.rating,
                _filters: review._filters || [],
              });
            }
          }
        }
      }
    }
    // Keep top 5 most relevant excerpts (increased from 3 since we have more reviews)
    place.evidence = place.evidence.slice(0, 5);
  }

  return REVIEW_FILTERS; // return so score-places can embed filter definitions
}

// Rank photos by relevance to query criteria using Claude Opus vision.
// Smart budget: top-ranked places get more photos evaluated, interleaved
// so every place gets at least one photo seen early in the grid.
async function rankPhotos(places, query, apiKey) {
  const q = (query || '').toLowerCase();
  const wantOutdoor = !!q.match(/outdoor|patio|outside|terrace|garden|space|seating/);
  const wantFood = !!q.match(/food|truck|eat|kitchen|menu|pizza/);

  if (!wantOutdoor && !wantFood) return;

  const criteria = [];
  if (wantOutdoor) criteria.push('outdoor seating area, patio, beer garden, outdoor space');
  if (wantFood) criteria.push('food, food truck, kitchen, menu items');
  const criteriaStr = criteria.join('; ');

  // Pass 1: metadata heuristics (instant, free)
  for (const place of places) {
    if (!place.photos || !place.photos.length) continue;
    place.photos.forEach((ph, idx) => {
      let score = 0;
      const ratio = (ph.width && ph.height) ? ph.width / ph.height : 1;
      score += Math.max(0, (6 - idx) * 0.1);
      if (wantOutdoor) {
        if (ratio > 1.3) score += 0.5;
        if (ratio > 1.6) score += 0.3;
        if (ratio < 0.8) score -= 0.3;
      }
      if (wantFood) {
        if (ratio >= 0.7 && ratio <= 1.3) score += 0.3;
      }
      ph._relevance = score;
    });
    place.photos.sort((a, b) => (b._relevance || 0) - (a._relevance || 0));
  }

  // Pass 2: Adaptive Opus vision evaluation with dynamic EV-based budgets.
  //
  // Each place starts with an "expected value" based on choosability rank.
  // Photos are evaluated in iterative rounds (up to 10 Opus calls, 2 parallel).
  // After each round, EVs update: misses (non-outdoor) decay EV, hits maintain it.
  // Places drop out when EV falls below threshold or all photos are exhausted.
  // Top-ranked places naturally get more photos evaluated because they start
  // with higher EV and tolerate more misses before dropping out.
  if (!apiKey) return;

  // Compute choosability score per place
  const outdoorReviewWords = /outdoor|patio|outside|beer garden|terrace|rooftop|deck|fire pit|courtyard|al fresco/i;
  const placeScores = places.map((p, idx) => {
    let score = 0;
    if (p.rating && p.review_count) {
      const bayesian = (p.rating * p.review_count + 3.5 * 10) / (p.review_count + 10);
      score += bayesian * 2;
    }
    if (wantOutdoor && p.outdoor_seating === true) score += 3;
    if (wantFood && (p.serves_beer === true || p._has_food === true)) score += 2;
    if (p.good_for_groups === true) score += 1;
    if (p.allows_dogs === true) score += 0.5;
    score += Math.min((p.evidence?.length || 0) * 1.5, 4);
    score += Math.max(0, (places.length - idx) / places.length * 2);

    // Scan review text for outdoor mentions — strong signal that outdoor photos exist
    if (wantOutdoor && p.reviews?.length) {
      const outdoorMentions = p.reviews.filter(r => outdoorReviewWords.test(r.text || '')).length;
      score += Math.min(outdoorMentions * 2, 6); // up to +6 for 3+ reviews mentioning outdoor
    }

    return { idx, score };
  });

  const sorted = [...placeScores].sort((a, b) => b.score - a.score);
  const maxScore = sorted[0]?.score || 1;
  const minScore = sorted[sorted.length - 1]?.score || 0;
  const scoreRange = Math.max(maxScore - minScore, 1);

  // Initialize per-place EV state.
  // EV starts proportional to rank: top = 1.0, bottom = 0.2
  // nextPhoto tracks which photo index to evaluate next for each place.
  // outdoorFound counts how many outdoor photos we've already found.
  const placeState = places.map((p, idx) => {
    const rankInfo = placeScores[idx];
    const normalizedScore = (rankInfo.score - minScore) / scoreRange; // 0-1
    return {
      ev: 0.2 + normalizedScore * 0.8, // range [0.2, 1.0]
      nextPhoto: 0,
      outdoorFound: 0,
      photosEvaluated: 0,
      totalPhotos: p.photos?.length || 0,
    };
  });

  const MAX_OPUS_CALLS = 20;
  const PHOTOS_PER_GRID = 16; // fewer photos per grid at higher resolution
  const EV_THRESHOLD = 0.08;  // drop out below this
  const MISS_DECAY = 0.12;    // EV penalty per non-outdoor photo
  const HIT_BOOST = 0.05;     // small EV boost per outdoor photo found
  const COLS = 4;
  const THUMB_W = 400, THUMB_H = 300;
  const PADDING = 4, LABEL_H = 20;
  const cellW = THUMB_W + PADDING;
  const cellH = THUMB_H + LABEL_H + PADDING;

  console.error(`Adaptive vision eval: ${places.length} places, up to ${MAX_OPUS_CALLS} Opus calls`);
  console.error(`  EV range: ${places[sorted[0]?.idx]?.name} = ${placeState[sorted[0]?.idx]?.ev.toFixed(2)}, ` +
    `${places[sorted[sorted.length-1]?.idx]?.name} = ${placeState[sorted[sorted.length-1]?.idx]?.ev.toFixed(2)}`);

  try {
    const sharp = (await import('sharp')).default;
    const { mkdtempSync, rmSync } = await import('fs');
    const { tmpdir } = await import('os');
    const tmpDir = mkdtempSync(resolve(tmpdir(), 'photogrid-'));

    // Download ALL thumbnails upfront (cheap, ~3s) so adaptive rounds are fast.
    // Only download for places with photos and EV above a minimum.
    const thumbCache = new Map(); // "placeIdx:photoIdx" → Buffer

    const allDownloads = [];
    places.forEach((place, pi) => {
      if (!place.photos) return;
      place.photos.forEach((ph, phi) => {
        allDownloads.push({ placeIdx: pi, photoIdx: phi, ref: ph.ref });
      });
    });

    console.error(`  Downloading ${allDownloads.length} thumbnails...`);
    for (let batch = 0; batch < allDownloads.length; batch += 10) {
      const promises = allDownloads.slice(batch, batch + 10).map(async (dl) => {
        try {
          const url = `https://places.googleapis.com/v1/${dl.ref}/media?maxHeightPx=${THUMB_H}&maxWidthPx=${THUMB_W}&key=${apiKey}`;
          const res = await fetch(url);
          if (!res.ok) return;
          const buf = Buffer.from(await res.arrayBuffer());
          const thumb = await sharp(buf)
            .resize(THUMB_W, THUMB_H, { fit: 'cover' })
            .jpeg({ quality: 70 })
            .toBuffer();
          thumbCache.set(`${dl.placeIdx}:${dl.photoIdx}`, thumb);
        } catch {}
      });
      await Promise.all(promises);
    }
    console.error(`  Cached ${thumbCache.size}/${allDownloads.length} thumbnails`);

    // Helper: build a grid image from a list of photo entries
    async function buildGrid(photoEntries, gridPath) {
      const rows = Math.ceil(photoEntries.length / COLS);
      const gridW = COLS * cellW + PADDING;
      const gridH = rows * cellH + PADDING;

      const composites = [];
      for (let i = 0; i < photoEntries.length; i++) {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const x = PADDING + col * cellW;
        const y = PADDING + LABEL_H + row * cellH;
        const entry = photoEntries[i];

        composites.push({ input: entry.thumb, left: x, top: y });

        const label = `${i + 1}. ${entry.place_name.substring(0, 18)}`;
        const escapedLabel = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const labelSvg = Buffer.from(
          `<svg width="${THUMB_W}" height="${LABEL_H}">
            <rect width="${THUMB_W}" height="${LABEL_H}" fill="#1a3a5c"/>
            <text x="4" y="15" font-family="Arial" font-size="13" fill="white" font-weight="bold">${escapedLabel}</text>
          </svg>`
        );
        composites.push({ input: labelSvg, left: x, top: y - LABEL_H });
      }

      await sharp({
        create: { width: gridW, height: gridH, channels: 3, background: { r: 240, g: 244, b: 248 } }
      }).composite(composites).jpeg({ quality: 80 }).toFile(gridPath);
    }

    // Helper: send a grid to Opus and parse scores with descriptions
    async function evaluateGrid(gridPath, photoCount) {
      const promptText = `This is a grid of ${photoCount} numbered photos from various restaurants/breweries. I'm searching for: ${criteriaStr}.

Score each photo 0-10:
- 10: Clear outdoor patio with seating, beer garden, outdoor dining area
- 7-9: Partially outdoor, covered patio, visible outdoor space
- 4-6: Ambiguous or food-related photo
- 1-3: Interior with some relevant element
- 0: Interior shot, logo, beer taps, close-up of drinks, building exterior without seating

For EVERY photo include:
- "t": type (e.g. "patio", "beer garden", "deck", "food", "interior", "bar", "logo", "exterior", "drinks")
- "d": brief description (5-15 words describing what you actually see)

Return ONLY a JSON array. Examples:
[{"n":1,"s":9,"t":"beer garden","d":"large open-air beer garden with picnic tables and string lights"},{"n":2,"s":0,"t":"interior","d":"indoor bar with beer taps and chalkboard menu"},{"n":3,"s":5,"t":"food","d":"pizza and loaded nachos on outdoor table"}]
Score ALL photos.`;

      const { stdout: result } = await execAsync(
        `claude -p ${JSON.stringify(promptText)} --model opus --allowedTools Read <<< "Read the image at ${gridPath}"`,
        { timeout: 180000, maxBuffer: 4 * 1024 * 1024, shell: '/bin/bash' }
      );

      const scoresMatch = result.trim().match(/\[[\s\S]*?\]/);
      if (!scoresMatch) return null;
      return JSON.parse(scoresMatch[0]);
    }

    // Helper: apply vision scores from a grid evaluation to place photos
    function applyGridScores(gridBatch, scores) {
      let scored = 0;
      for (const vs of (scores || [])) {
        const localIdx = (vs.n || vs.num || vs.number || 1) - 1;
        const score = vs.s || vs.score || 0;
        if (localIdx < 0 || localIdx >= gridBatch.length) continue;

        const entry = gridBatch[localIdx];
        const place = places[entry.placeIdx];
        const st = placeState[entry.placeIdx];

        if (place.photos?.[entry.photoIdx]) {
          place.photos[entry.photoIdx]._visionScore = score;
          place.photos[entry.photoIdx]._relevance =
            (place.photos[entry.photoIdx]._relevance || 0) + score * 0.15;
          if (vs.t) place.photos[entry.photoIdx]._visionType = vs.t;
          if (vs.d) place.photos[entry.photoIdx]._visionDesc = vs.d;
          scored++;
        }

        st.photosEvaluated++;
        if (score >= 5) {
          st.outdoorFound++;
          st.ev = Math.min(1.0, st.ev + HIT_BOOST);
        } else {
          st.ev -= MISS_DECAY;
        }
      }
      totalScored += scored;
      return scored;
    }

    // ---- Adaptive evaluation loop ----
    let opusCallsUsed = 0;
    let totalScored = 0;

    while (opusCallsUsed < MAX_OPUS_CALLS) {
      // Select photos for next batch: pick from places with highest EV,
      // taking their next unevaluated photo. Fill up to 2 grids (run in parallel).
      const batch = []; // { placeIdx, photoIdx, thumb, place_name }

      // Sort places by current EV (descending) for selection
      const evOrder = sorted
        .map(s => s.idx)
        .filter(pi => {
          const st = placeState[pi];
          return st.ev >= EV_THRESHOLD && st.nextPhoto < st.totalPhotos;
        })
        .sort((a, b) => placeState[b].ev - placeState[a].ev);

      if (evOrder.length === 0) {
        console.error(`  All places below EV threshold or exhausted — stopping`);
        break;
      }

      // Fill grids: round-robin by EV rank, up to 2 * PHOTOS_PER_GRID
      // Allow up to 4 parallel grids per round (16 photos each = 64 photos/round)
      const maxGridsPerRound = Math.min(4, MAX_OPUS_CALLS - opusCallsUsed);
      const maxPhotos = maxGridsPerRound * PHOTOS_PER_GRID;
      let filled = true;
      while (batch.length < maxPhotos && filled) {
        filled = false;
        for (const pi of evOrder) {
          if (batch.length >= maxPhotos) break;
          const st = placeState[pi];
          if (st.ev < EV_THRESHOLD || st.nextPhoto >= st.totalPhotos) continue;

          const thumb = thumbCache.get(`${pi}:${st.nextPhoto}`);
          if (!thumb) { st.nextPhoto++; continue; }

          batch.push({
            placeIdx: pi,
            photoIdx: st.nextPhoto,
            thumb,
            place_name: places[pi].name,
          });
          st.nextPhoto++;
          filled = true;
        }
      }

      if (batch.length === 0) break;

      // Split into grids of PHOTOS_PER_GRID
      const grids = [];
      for (let i = 0; i < batch.length; i += PHOTOS_PER_GRID) {
        grids.push(batch.slice(i, i + PHOTOS_PER_GRID));
      }

      const activePlaces = evOrder.filter(pi => placeState[pi].ev >= EV_THRESHOLD).length;
      console.error(`  Round ${opusCallsUsed + 1}: ${batch.length} photos in ${grids.length} grid(s), ${activePlaces} active places`);

      // Build and evaluate grids in parallel
      const gridResults = await Promise.all(grids.map(async (gridBatch, gi) => {
        const gridPath = resolve(tmpDir, `grid-${opusCallsUsed + gi}.jpg`);
        await buildGrid(gridBatch, gridPath);

        try {
          const scores = await evaluateGrid(gridPath, gridBatch.length);
          if (scores) {
            console.error(`    Grid ${opusCallsUsed + gi + 1}: Opus scored ${scores.length} photos`);
            return { gridBatch, scores };
          } else {
            console.error(`    Grid ${opusCallsUsed + gi + 1}: could not parse response`);
            return { gridBatch, scores: [] };
          }
        } catch (err) {
          console.error(`    Grid ${opusCallsUsed + gi + 1}: failed (${err.message.substring(0, 80)})`);
          return { gridBatch, scores: [] };
        }
      }));

      opusCallsUsed += grids.length;

      // Apply scores and update EVs
      for (const { gridBatch, scores } of gridResults) {
        applyGridScores(gridBatch, scores);
      }

      // Log EV state after this round
      const stillActive = evOrder.filter(pi => placeState[pi].ev >= EV_THRESHOLD && placeState[pi].nextPhoto < placeState[pi].totalPhotos);
      const droppedThisRound = evOrder.length - stillActive.length;
      const totalOutdoor = placeState.reduce((n, st) => n + st.outdoorFound, 0);
      console.error(`    Scored: ${totalScored} total, ${totalOutdoor} outdoor found, ${droppedThisRound} places dropped, ${stillActive.length} still active`);

      // Early exit: if no places remain active
      if (stillActive.length === 0) {
        console.error(`  All places resolved — stopping early`);
        break;
      }
    }

    // ---- "Last call" pass ----
    // Places with no outdoor photo found that still have unevaluated photos
    // AND have reason to believe outdoor space exists (outdoor_seating=true,
    // review mentions, evidence). Give them one final batch with remaining photos.
    if (opusCallsUsed < MAX_OPUS_CALLS) {
      const unresolved = [];
      places.forEach((p, pi) => {
        const st = placeState[pi];
        if (st.outdoorFound > 0) return; // already found outdoor
        if (st.nextPhoto >= st.totalPhotos) return; // no photos left

        // Only bother if there's reason to believe outdoor exists
        const hasOutdoorSignal = p.outdoor_seating === true
          || (p.evidence || []).some(e => e.category === 'outdoor')
          || (p.reviews || []).some(r => outdoorReviewWords.test(r.text || ''));
        if (!hasOutdoorSignal) return;

        unresolved.push(pi);
      });

      if (unresolved.length > 0) {
        // Gather ALL remaining unevaluated photos from these places
        const lastCallBatch = [];
        for (const pi of unresolved) {
          const st = placeState[pi];
          while (st.nextPhoto < st.totalPhotos) {
            const thumb = thumbCache.get(`${pi}:${st.nextPhoto}`);
            if (thumb) {
              lastCallBatch.push({
                placeIdx: pi,
                photoIdx: st.nextPhoto,
                thumb,
                place_name: places[pi].name,
              });
            }
            st.nextPhoto++;
          }
        }

        if (lastCallBatch.length > 0) {
          const callsRemaining = MAX_OPUS_CALLS - opusCallsUsed;
          const maxPhotos = callsRemaining * PHOTOS_PER_GRID;
          const finalBatch = lastCallBatch.slice(0, maxPhotos);

          const grids = [];
          for (let i = 0; i < finalBatch.length; i += PHOTOS_PER_GRID) {
            grids.push(finalBatch.slice(i, i + PHOTOS_PER_GRID));
          }

          console.error(`  Last call: ${finalBatch.length} remaining photos from ${unresolved.length} unresolved places (${grids.length} grid(s))`);

          const lastResults = await Promise.all(grids.map(async (gridBatch, gi) => {
            const gridPath = resolve(tmpDir, `grid-lastcall-${gi}.jpg`);
            await buildGrid(gridBatch, gridPath);
            try {
              const scores = await evaluateGrid(gridPath, gridBatch.length);
              if (scores) {
                console.error(`    Last-call grid ${gi + 1}: Opus scored ${scores.length} photos`);
                return { gridBatch, scores };
              }
              return { gridBatch, scores: [] };
            } catch (err) {
              console.error(`    Last-call grid ${gi + 1}: failed (${err.message.substring(0, 80)})`);
              return { gridBatch, scores: [] };
            }
          }));

          opusCallsUsed += grids.length;

          for (const { gridBatch, scores } of lastResults) {
            applyGridScores(gridBatch, scores);
          }

          const resolved = unresolved.filter(pi => placeState[pi].outdoorFound > 0).map(pi => places[pi].name);
          const stillMissing = unresolved.filter(pi => placeState[pi].outdoorFound === 0).map(pi => places[pi].name);
          if (resolved.length) console.error(`    Last call found outdoor for: ${resolved.join(', ')}`);
          if (stillMissing.length) console.error(`    Truly no outdoor photos: ${stillMissing.join(', ')}`);
        }
      }
    }

    // ---- "Top-up" pass ----
    // Top-ranked places with only 1 outdoor photo and unevaluated photos remaining
    // deserve another look — 1 photo isn't great for display variety.
    if (opusCallsUsed < MAX_OPUS_CALLS) {
      const needsMore = [];
      // Use choosability rank to prioritize
      for (const { idx: pi } of sorted) {
        const st = placeState[pi];
        if (st.outdoorFound !== 1) continue; // only places with exactly 1
        if (st.nextPhoto >= st.totalPhotos) continue; // no photos left
        needsMore.push(pi);
      }

      if (needsMore.length > 0) {
        const topupBatch = [];
        for (const pi of needsMore) {
          const st = placeState[pi];
          while (st.nextPhoto < st.totalPhotos) {
            const thumb = thumbCache.get(`${pi}:${st.nextPhoto}`);
            if (thumb) {
              topupBatch.push({
                placeIdx: pi,
                photoIdx: st.nextPhoto,
                thumb,
                place_name: places[pi].name,
              });
            }
            st.nextPhoto++;
          }
        }

        if (topupBatch.length > 0) {
          const callsRemaining = MAX_OPUS_CALLS - opusCallsUsed;
          const maxPhotos = callsRemaining * PHOTOS_PER_GRID;
          const finalBatch = topupBatch.slice(0, maxPhotos);

          const grids = [];
          for (let i = 0; i < finalBatch.length; i += PHOTOS_PER_GRID) {
            grids.push(finalBatch.slice(i, i + PHOTOS_PER_GRID));
          }

          console.error(`  Top-up: ${finalBatch.length} photos from ${needsMore.length} places with only 1 outdoor photo (${grids.length} grid(s))`);

          const topupResults = await Promise.all(grids.map(async (gridBatch, gi) => {
            const gridPath = resolve(tmpDir, `grid-topup-${gi}.jpg`);
            await buildGrid(gridBatch, gridPath);
            try {
              const scores = await evaluateGrid(gridPath, gridBatch.length);
              if (scores) {
                console.error(`    Top-up grid ${gi + 1}: Opus scored ${scores.length} photos`);
                return { gridBatch, scores };
              }
              return { gridBatch, scores: [] };
            } catch (err) {
              console.error(`    Top-up grid ${gi + 1}: failed (${err.message.substring(0, 80)})`);
              return { gridBatch, scores: [] };
            }
          }));

          opusCallsUsed += grids.length;

          const prevOutdoor = needsMore.map(pi => placeState[pi].outdoorFound);
          for (const { gridBatch, scores } of topupResults) {
            applyGridScores(gridBatch, scores);
          }
          const topupFound = needsMore.reduce((n, pi, i) => n + (placeState[pi].outdoorFound - prevOutdoor[i]), 0);

          const improved = needsMore.filter(pi => placeState[pi].outdoorFound > 1).map(pi =>
            `${places[pi].name} (${placeState[pi].outdoorFound})`);
          console.error(`    Top-up found ${topupFound} more outdoor photos` +
            (improved.length ? `: ${improved.join(', ')}` : ''));
        }
      }
    }

    console.error(`  Opus vision complete: ${opusCallsUsed} calls, ${totalScored} photos scored`);
    const outdoorSummary = places.map((p, pi) => {
      const st = placeState[pi];
      return st.outdoorFound > 0 ? p.name : null;
    }).filter(Boolean);
    if (outdoorSummary.length > 0) {
      console.error(`  Outdoor photos found for: ${outdoorSummary.join(', ')}`);
    }

    // Sort photos: vision score is primary key, metadata relevance as tiebreaker.
    // Photos with outdoor vision scores (>=5) always come first.
    for (const place of places) {
      if (place.photos) place.photos.sort((a, b) => {
        const av = a._visionScore ?? -1, bv = b._visionScore ?? -1;
        if (av !== bv) return bv - av; // highest vision score first
        return (b._relevance || 0) - (a._relevance || 0); // tiebreak on metadata
      });
    }

    // ---- Verification pass ----
    // Grid thumbnails (150x110) are too small for reliable classification.
    // Verify each place's top-ranked photos at full resolution to catch
    // misidentifications (e.g. beer taps scored as "patio").
    // Download at 600px and send individually to Opus for confirmation.
    const toVerify = [];
    for (let pi = 0; pi < places.length; pi++) {
      const photos = places[pi].photos || [];
      // Verify top 2 photos that claim to be outdoor (score >= 5, outdoor type)
      let verified = 0;
      for (let phi = 0; phi < photos.length && verified < 2; phi++) {
        const ph = photos[phi];
        if ((ph._visionScore ?? 0) < 5) break; // sorted, so no more high scores
        const t = (ph._visionType || '').toLowerCase();
        const isOutdoorClaim = t.includes('patio') || t.includes('outdoor') || t.includes('deck')
          || t.includes('garden') || t.includes('roof') || t.includes('courtyard')
          || t.includes('sidewalk') || t.includes('terrace') || t.includes('balcony');
        if (!isOutdoorClaim) continue;
        toVerify.push({ placeIdx: pi, photoIdx: phi, ref: ph.ref, place_name: places[pi].name,
          claimedScore: ph._visionScore, claimedType: ph._visionType, claimedDesc: ph._visionDesc });
        verified++;
      }
    }

    if (toVerify.length > 0) {
      console.error(`  Verifying ${toVerify.length} top outdoor photos at full resolution...`);

      // Download full-res versions and verify in parallel (batches of 10)
      const verifyPrompt = (type, desc) =>
        `Look at this photo carefully. It was identified at thumbnail resolution as: "${type}" — "${desc}".

Is this ACTUALLY an outdoor seating area, patio, beer garden, deck, or outdoor dining space? Look for: sky/open air, outdoor furniture, plants/trees, natural light indicating outdoors.

Reply with ONLY a JSON object: {"outdoor": true/false, "actual": "brief description of what this actually shows", "confidence": "high/medium/low"}`;

      for (let batch = 0; batch < toVerify.length; batch += 10) {
        const batchItems = toVerify.slice(batch, batch + 10);
        await Promise.all(batchItems.map(async (item) => {
          try {
            // Download at larger size for verification
            const url = `https://places.googleapis.com/v1/${item.ref}/media?maxHeightPx=600&maxWidthPx=800&key=${apiKey}`;
            const res = await fetch(url);
            if (!res.ok) return;
            const buf = Buffer.from(await res.arrayBuffer());
            const imgPath = resolve(tmpDir, `verify-${item.placeIdx}-${item.photoIdx}.jpg`);
            const { writeFileSync: wfs } = await import('fs');
            wfs(imgPath, buf);

            const prompt = verifyPrompt(item.claimedType, item.claimedDesc || '');
            const { stdout: result } = await execAsync(
              `claude -p ${JSON.stringify(prompt)} --model sonnet --allowedTools Read <<< "Read the image at ${imgPath}"`,
              { timeout: 60000, maxBuffer: 1024 * 1024, shell: '/bin/bash' }
            );

            const jsonMatch = result.trim().match(/\{[\s\S]*?\}/);
            if (jsonMatch) {
              const verdict = JSON.parse(jsonMatch[0]);
              const place = places[item.placeIdx];
              const ph = place.photos[item.photoIdx];

              if (!verdict.outdoor) {
                // Misidentified! Demote this photo.
                console.error(`    DEMOTED: ${item.place_name} photo #${item.photoIdx + 1} — was "${item.claimedType}" (${item.claimedScore}), actually: ${verdict.actual}`);
                ph._visionScore = 0;
                ph._visionType = verdict.actual || 'interior';
                ph._visionDesc = verdict.actual || 'misidentified at thumbnail resolution';
                ph._verified = false;
              } else {
                // Confirmed outdoor — update description with full-res assessment
                ph._visionDesc = verdict.actual || ph._visionDesc;
                ph._verified = true;
                console.error(`    Confirmed: ${item.place_name} photo #${item.photoIdx + 1} — ${verdict.actual || item.claimedType}`);
              }
            }
          } catch (err) {
            // Verification failed — keep original score but mark unverified
            console.error(`    Verify failed for ${item.place_name}: ${err.message.substring(0, 60)}`);
          }
        }));
      }

      // Re-sort after verification demotions
      let demoted = 0;
      for (const place of places) {
        if (place.photos) {
          const hadTop = place.photos[0]?._visionScore ?? 0;
          place.photos.sort((a, b) => {
            const av = a._visionScore ?? -1, bv = b._visionScore ?? -1;
            if (av !== bv) return bv - av;
            return (b._relevance || 0) - (a._relevance || 0);
          });
          if ((place.photos[0]?._visionScore ?? 0) < hadTop) demoted++;
        }
      }
      console.error(`  Verification complete: ${demoted} places had top photo demoted`);
    }

    // Aggregate per-place photo insights keyed by criterion.
    // Classify each scored photo into the criterion it best matches,
    // then aggregate per criterion per place.
    const outdoorTypes = new Set(['patio', 'rooftop', 'beer garden', 'deck', 'courtyard',
      'sidewalk', 'covered patio', 'terrace', 'garden', 'outdoor', 'balcony']);
    const foodTypes = new Set(['food', 'food truck', 'kitchen', 'menu', 'restaurant']);

    // Build criteria-to-classifier map based on what this query cares about
    const criteriaClassifiers = [];
    if (wantOutdoor) {
      criteriaClassifiers.push({
        key: 'outdoor',
        match: (ph) => {
          const t = (ph._visionType || '').toLowerCase();
          return outdoorTypes.has(t) || t.includes('patio') || t.includes('outdoor')
            || t.includes('deck') || t.includes('garden') || t.includes('roof');
        },
        highlightKeywords: [
          'string lights', 'fire pit', 'firepit', 'views', 'view', 'rooftop',
          'covered', 'heated', 'large', 'spacious', 'greenery', 'garden',
          'dog-friendly', 'dogs', 'pet-friendly', 'umbrella', 'shade',
          'picnic', 'waterfront', 'river', 'scenic', 'courtyard',
          'live music', 'stage', 'games', 'bocce', 'cornhole',
        ],
      });
    }
    if (wantFood) {
      criteriaClassifiers.push({
        key: 'food',
        match: (ph) => {
          const t = (ph._visionType || '').toLowerCase();
          return foodTypes.has(t) || t.includes('food') || t.includes('menu')
            || t.includes('kitchen') || t.includes('truck');
        },
        highlightKeywords: [
          'pizza', 'burger', 'nachos', 'wings', 'tacos', 'bbq', 'smoker',
          'food truck', 'kitchen', 'menu', 'chef', 'plated', 'fresh',
        ],
      });
    }

    for (const place of places) {
      const scoredPhotos = (place.photos || []).filter(ph => (ph._visionScore ?? 0) >= 5);
      if (scoredPhotos.length === 0) continue;

      const insights = {};
      for (const cc of criteriaClassifiers) {
        const matching = scoredPhotos.filter(cc.match);
        if (matching.length === 0) continue;

        const types = [...new Set(matching.map(ph => ph._visionType).filter(Boolean))];
        const descs = matching.map(ph => ph._visionDesc).filter(Boolean);
        const descText = descs.join(' ').toLowerCase();
        const highlights = cc.highlightKeywords.filter(kw => descText.includes(kw));

        const bestDescs = descs.slice(0, 2);
        const summary = bestDescs.length > 1
          ? bestDescs[0].replace(/[.!]$/, '') + '; also ' + bestDescs[1].charAt(0).toLowerCase() + bestDescs[1].slice(1)
          : bestDescs[0] || types.join(', ');

        insights[cc.key] = {
          score: matching[0]._visionScore,
          types,
          highlights,
          summary,
          photoCount: matching.length,
        };
      }

      if (Object.keys(insights).length > 0) {
        place._photoInsights = insights;
      }

      // Keep _outdoorQuality as alias for backward compatibility
      if (insights.outdoor) {
        place._outdoorQuality = insights.outdoor;
      }
    }

    const insightCount = places.filter(p => p._photoInsights).length;
    if (insightCount > 0) {
      const criteriaFound = [...new Set(places.flatMap(p => Object.keys(p._photoInsights || {})))];
      console.error(`  Photo insights for ${insightCount} places across criteria: ${criteriaFound.join(', ')}`);
    }

    try { rmSync(tmpDir, { recursive: true }); } catch {}
  } catch (err) {
    console.error(`  Vision grid evaluation failed: ${err.message}`);
  }
}

// ==========================================
// Main
// ==========================================

async function main() {
  const searchTerm = location ? `${query} near ${location}` : query;

  if (!API_KEY) {
    console.error('No GOOGLE_MAPS_API_KEY found. Set it in .env or environment.');
    console.error('Falling back to Playwright scraper...');
    // Could import and run the playwright version here
    process.exit(1);
  }

  console.error(`Using Google Places API`);
  console.error(`Query: "${searchTerm}" (radius: ${radius}m)`);

  // Geocode the location if provided
  let locationBias = null;
  if (location) {
    console.error(`Geocoding: "${location}"`);
    locationBias = await geocode(location);
    if (locationBias) {
      console.error(`Location: ${locationBias.lat}, ${locationBias.lng}`);
    } else {
      console.error('Could not geocode location, searching without location bias');
    }
  }

  const places = await searchPlacesAPI(searchTerm, locationBias);

  if (places === null) {
    console.error('API call failed');
    process.exit(1);
  }

  // --- Verify null fields via web search for query-relevant attributes ---
  // Parse which boolean fields the query cares about
  const queryLower = searchTerm.toLowerCase();
  const relevantFields = [];
  if (queryLower.match(/outdoor|patio|outside|terrace/)) relevantFields.push('outdoor_seating');
  if (queryLower.match(/food|truck|eat|kitchen|menu/)) relevantFields.push('serves_food');
  if (queryLower.match(/beer|brew|tap|ipa/)) relevantFields.push('serves_beer');
  if (queryLower.match(/cocktail|whiskey|spirits/)) relevantFields.push('serves_cocktails');
  if (queryLower.match(/music|live|band/)) relevantFields.push('live_music');
  if (queryLower.match(/dog|pet/)) relevantFields.push('allows_dogs');

  // Find places with null in relevant fields
  const needsVerification = places.filter(p =>
    relevantFields.some(f => p[f] === null || p[f] === undefined)
  );

  if (needsVerification.length > 0 && relevantFields.length > 0) {
    console.error(`Verifying ${needsVerification.length} places with missing data for: ${relevantFields.join(', ')}`);

    // Strategy: do broad web searches for the query terms + location, then
    // cross-reference which of our places appear in the results.
    // This is 2-3 fetches total, not one per place.
    const placeNames = places.map(p => p.name.toLowerCase());

    const webSearches = [];
    if (relevantFields.includes('outdoor_seating')) {
      webSearches.push({ field: 'outdoor_seating', query: `breweries outdoor seating patio ${location || ''}` });
    }
    if (relevantFields.includes('serves_food')) {
      webSearches.push({ field: 'serves_food', query: `breweries food trucks food menu ${location || ''}` });
    }
    if (relevantFields.includes('live_music')) {
      webSearches.push({ field: 'live_music', query: `breweries live music ${location || ''}` });
    }

    for (const ws of webSearches) {
      try {
        // Use Google Custom Search via Places-style search to find articles
        // Actually, use a simple Google search via fetch
        const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(ws.query)}&num=10`;
        const res = await fetch(googleUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TravelOptimizer/1.0)' }
        });
        const html = await res.text();
        const textLower = html.toLowerCase();

        // Check which of our places appear in the search results
        for (const place of needsVerification) {
          if (place[ws.field] !== null) continue;

          // Check if the place name appears in search results
          const nameLower = place.name.toLowerCase();
          // Try matching on core name words (skip "brewery", "brewing", "beer", "company")
          const coreWords = nameLower
            .replace(/\b(brewery|brewing|beer|company|co|taproom|craft|the)\b/g, '')
            .trim().split(/\s+/).filter(w => w.length > 2);

          const found = coreWords.length > 0 && coreWords.every(w => textLower.includes(w));
          if (found) {
            place[ws.field] = true;
            console.error(`  ${place.name}: ${ws.field} = true (from web search)`);
          }
        }
      } catch (err) {
        console.error(`  Web verify for ${ws.field} failed: ${err.message}`);
      }
    }

    // For remaining nulls, use Playwright to scrape Google search results
    const stillMissing = needsVerification.filter(p =>
      relevantFields.some(f => p[f] === null || p[f] === undefined)
    );

    if (stillMissing.length > 0) {
      console.error(`Playwright verification for ${stillMissing.length} remaining places...`);
      try {
        const { chromium } = await import('playwright');
        const browser = await chromium.launch({ headless: true });

        for (const place of stillMissing) {
          const nullFields = relevantFields.filter(f => place[f] === null || place[f] === undefined);
          if (nullFields.length === 0) continue;

          try {
            const page = await browser.newPage();
            const q = `${place.name} ${place.address || ''} outdoor seating patio food truck`;
            await page.goto(`https://www.google.com/search?q=${encodeURIComponent(q)}`, {
              waitUntil: 'domcontentloaded', timeout: 15000
            });
            await page.waitForTimeout(2000);

            const pageData = await page.evaluate(() => {
              const text = document.body.innerText.toLowerCase();
              // Also extract social links from the page
              const html = document.body.innerHTML;
              const igMatch = html.match(/https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9_.]+/);
              const fbMatch = html.match(/https?:\/\/(?:www\.)?facebook\.com\/[a-zA-Z0-9_.]+/);
              return { text, instagram: igMatch?.[0] || null, facebook: fbMatch?.[0] || null };
            });
            await page.close();

            const text = pageData.text;

            if (nullFields.includes('outdoor_seating') && (
              text.includes('outdoor seating') || text.includes('patio') ||
              text.includes('beer garden') || text.includes('outdoor space') ||
              text.includes('outdoor dining')
            )) {
              place.outdoor_seating = true;
              console.error(`  ${place.name}: outdoor_seating = true (playwright)`);
            }

            if (nullFields.includes('serves_food') && (
              text.includes('food truck') || text.includes('food menu') ||
              text.includes('kitchen') || text.includes('serves food')
            )) {
              place._has_food = true;
              console.error(`  ${place.name}: has food (playwright)`);
            }

            // Store social links
            if (pageData.instagram || pageData.facebook) {
              place.social_links = {};
              if (pageData.instagram) place.social_links.instagram = pageData.instagram;
              if (pageData.facebook) place.social_links.facebook = pageData.facebook;
              console.error(`  ${place.name}: found social links`);
            }
          } catch (err) {
            console.error(`  ${place.name}: playwright verify failed`);
          }
        }

        await browser.close();
      } catch (err) {
        console.error(`Playwright not available for verification: ${err.message}`);
      }
    }
  }

  // --- Fetch additional reviews via Claude web search ---
  // Google Places API caps at 5 reviews. Use Claude to find more from Yelp/TripAdvisor/etc.
  // Process in batches of 5 places per Claude call for efficiency.
  const criteriaTerms = [];
  if (searchTerm.match(/outdoor|patio|outside|terrace|garden|seating/i))
    criteriaTerms.push('outdoor seating', 'patio', 'beer garden');
  if (searchTerm.match(/food|truck|eat|kitchen|menu/i))
    criteriaTerms.push('food', 'menu');
  const criteriaSearchStr = criteriaTerms.length ? criteriaTerms.join(', ') : '';

  const REVIEW_BATCH_SIZE = 5;
  const placesForReviews = places.filter(p => p.name && p.address);
  console.error(`Fetching additional reviews for ${placesForReviews.length} places via web search...`);

  for (let batch = 0; batch < placesForReviews.length; batch += REVIEW_BATCH_SIZE) {
    const batchPlaces = placesForReviews.slice(batch, batch + REVIEW_BATCH_SIZE);
    const placeList = batchPlaces.map((p, i) => `${i + 1}. "${p.name}" at ${p.address}`).join('\n');

    const prompt = `Find real customer reviews for these places near ${location || 'Pittsburgh PA'}. Focus on reviews mentioning: ${criteriaSearchStr || 'atmosphere, quality'}.

${placeList}

For each place, find 3-5 reviews from Yelp, TripAdvisor, Google, or blogs. Return ONLY a JSON array:
[{"place":"exact place name","text":"review text","source":"yelp/google/tripadvisor/blog","rating":5}]
Only include REAL reviews you find on the web. If you can't find reviews for a place, skip it.`;

    try {
      const { stdout: result } = await execAsync(
        `claude -p ${JSON.stringify(prompt)} --model sonnet --allowedTools WebSearch,WebFetch 2>/dev/null`,
        { timeout: 90000, maxBuffer: 2 * 1024 * 1024, shell: '/bin/bash' }
      );

      const jsonMatch = result.trim().match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const webReviews = JSON.parse(jsonMatch[0]);
        let added = 0;
        for (const wr of webReviews) {
          const place = batchPlaces.find(p => p.name.toLowerCase().includes((wr.place || '').toLowerCase().substring(0, 15))
            || (wr.place || '').toLowerCase().includes(p.name.toLowerCase().substring(0, 15)));
          if (!place || !wr.text || wr.text.length < 20) continue;

          // Deduplicate against existing reviews
          const existing = (place.reviews || []).map(r => (r.text || '').substring(0, 40).toLowerCase());
          if (existing.some(e => wr.text.toLowerCase().includes(e) || e.includes(wr.text.substring(0, 40).toLowerCase()))) continue;

          place.reviews.push({
            text: wr.text.substring(0, 500),
            rating: wr.rating || null,
            time: null,
            source: wr.source || 'web',
          });
          added++;
        }
        if (added > 0) console.error(`  Batch ${Math.floor(batch / REVIEW_BATCH_SIZE) + 1}: +${added} web reviews`);
      }
    } catch (err) {
      console.error(`  Batch ${Math.floor(batch / REVIEW_BATCH_SIZE) + 1}: web review fetch failed`);
    }
  }

  const totalReviews = places.reduce((n, p) => n + (p.reviews || []).length, 0);
  const webReviews = places.reduce((n, p) => n + (p.reviews || []).filter(r => r.source === 'web' || r.source === 'yelp' || r.source === 'tripadvisor' || r.source === 'blog').length, 0);
  console.error(`Total reviews: ${totalReviews} (${webReviews} from web, ${totalReviews - webReviews} from API)`);

  // Sort reviews per place: prioritize those mentioning query-relevant criteria
  const reviewKeywords = [];
  if (searchTerm.match(/outdoor|patio|outside|terrace|garden|seating/i))
    reviewKeywords.push('outdoor', 'patio', 'outside', 'beer garden', 'terrace', 'deck');
  if (searchTerm.match(/food|truck|eat|kitchen|menu/i))
    reviewKeywords.push('food', 'food truck', 'kitchen', 'menu', 'pizza');
  if (reviewKeywords.length > 0) {
    for (const place of places) {
      if (!place.reviews || place.reviews.length <= 1) continue;
      place.reviews.sort((a, b) => {
        const aRelevant = reviewKeywords.some(kw => (a.text || '').toLowerCase().includes(kw));
        const bRelevant = reviewKeywords.some(kw => (b.text || '').toLowerCase().includes(kw));
        if (aRelevant && !bRelevant) return -1;
        if (!aRelevant && bRelevant) return 1;
        return (b.rating || 0) - (a.rating || 0);
      });
    }
  }

  // Rank photos by relevance to query criteria (metadata + vision)
  await rankPhotos(places, searchTerm, API_KEY);

  // Extract evidence from reviews for key differentiator criteria
  const reviewFilters = extractEvidence(places, searchTerm);
  const evidenceCount = places.reduce((n, p) => n + (p.evidence?.length || 0), 0);
  const filteredReviewCount = places.reduce((n, p) =>
    n + (p.reviews || []).filter(r => (r._filters || []).length > 0).length, 0);
  if (evidenceCount > 0) console.error(`Extracted ${evidenceCount} evidence excerpts from reviews`);
  if (filteredReviewCount > 0) console.error(`Tagged ${filteredReviewCount} reviews with filter flags`);

  const output = {
    query: searchTerm,
    location_bias: locationBias,
    radius_meters: parseFloat(radius),
    result_count: places.length,
    scraped_at: new Date().toISOString(),
    source: 'google_places_api',
    review_filters: Object.fromEntries(Object.entries(reviewFilters).map(([k, v]) => [k, v.label])),
    places
  };

  // Output to stdout
  console.log(JSON.stringify(output, null, 2));
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
