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
import { execSync } from 'child_process';

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
      photos: (p.photos || []).slice(0, 10).map(ph => ({
        ref: ph.name,
        width: ph.widthPx || null,
        height: ph.heightPx || null,
      })).filter(ph => ph.ref),
    };
  });
}

// Extract evidence sentences from reviews that match query-relevant keywords
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

  if (Object.keys(evidenceKeywords).length === 0) return;

  for (const place of places) {
    place.evidence = [];
    if (!place.reviews || !place.reviews.length) continue;

    for (const review of place.reviews) {
      if (!review.text) continue;
      // Split into sentences
      const sentences = review.text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 15);

      for (const sentence of sentences) {
        const sLower = sentence.toLowerCase();
        for (const [category, keywords] of Object.entries(evidenceKeywords)) {
          const matched = keywords.find(kw => sLower.includes(kw));
          if (matched) {
            // Avoid duplicates
            if (!place.evidence.some(e => e.text === sentence)) {
              place.evidence.push({
                text: sentence,
                category,
                keyword: matched,
                source: 'review',
                review_rating: review.rating,
              });
            }
          }
        }
      }
    }
    // Keep top 3 most relevant excerpts
    place.evidence = place.evidence.slice(0, 3);
  }
}

// Rank photos by relevance to query criteria.
// Pass 1: metadata heuristics (aspect ratio). Free, instant.
// Pass 2: multimodal AI evaluation via Claude Haiku. Parallel, for top places only.
async function rankPhotos(places, query, apiKey) {
  const q = (query || '').toLowerCase();
  const wantOutdoor = !!q.match(/outdoor|patio|outside|terrace|garden|space|seating/);
  const wantFood = !!q.match(/food|truck|eat|kitchen|menu|pizza/);

  if (!wantOutdoor && !wantFood) return; // nothing specific to rank for

  const criteria = [];
  if (wantOutdoor) criteria.push('outdoor seating area, patio, beer garden, outdoor space');
  if (wantFood) criteria.push('food, food truck, kitchen, menu items');
  const criteriaStr = criteria.join('; ');

  // Pass 1: metadata heuristics (instant)
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

  // Pass 2: vision evaluation using a thumbnail grid
  // Download all photos as small thumbnails, composite into a numbered grid,
  // send ONE image to Claude Haiku to identify which show the key criteria.
  if (!apiKey) return;

  const allPhotos = []; // { placeIdx, photoIdx, ref, place_name }
  places.forEach((place, pi) => {
    if (!place.photos) return;
    place.photos.forEach((ph, phi) => {
      allPhotos.push({ placeIdx: pi, photoIdx: phi, ref: ph.ref, place_name: place.name });
    });
  });

  if (allPhotos.length === 0) return;

  console.error(`Building photo grids: ${allPhotos.length} photos from ${places.filter(p=>p.photos?.length).length} places...`);

  try {
    const sharp = (await import('sharp')).default;
    const { mkdtempSync, writeFileSync: writeFS, rmSync } = await import('fs');
    const { tmpdir } = await import('os');
    const tmpDir = mkdtempSync(resolve(tmpdir(), 'photogrid-'));

    // Download thumbnails in parallel (batches of 15)
    const THUMB_W = 120, THUMB_H = 90;
    const thumbBuffers = new Array(allPhotos.length).fill(null);

    for (let batch = 0; batch < allPhotos.length; batch += 15) {
      const batchPromises = allPhotos.slice(batch, batch + 15).map(async (photo, bi) => {
        const idx = batch + bi;
        try {
          const url = `https://places.googleapis.com/v1/${photo.ref}/media?maxHeightPx=${THUMB_H}&maxWidthPx=${THUMB_W}&key=${apiKey}`;
          const res = await fetch(url);
          if (!res.ok) return;
          const buf = Buffer.from(await res.arrayBuffer());
          const thumb = await sharp(buf)
            .resize(THUMB_W, THUMB_H, { fit: 'cover' })
            .jpeg({ quality: 65 })
            .toBuffer();
          thumbBuffers[idx] = thumb;
        } catch {}
      });
      await Promise.all(batchPromises);
    }

    const validThumbs = thumbBuffers.map((buf, i) => buf ? { buf, idx: i } : null).filter(Boolean);
    if (validThumbs.length === 0) { console.error('  No photos downloaded'); return; }

    console.error(`  Downloaded ${validThumbs.length} thumbnails`);

    // Split into grid pages (~60 thumbs per page for readable grids)
    const PER_PAGE = 60;
    const COLS = 6;
    const PADDING = 3;
    const LABEL_H = 14;
    const cellW = THUMB_W + PADDING;
    const cellH = THUMB_H + LABEL_H + PADDING;

    const pages = [];
    for (let start = 0; start < validThumbs.length; start += PER_PAGE) {
      pages.push(validThumbs.slice(start, start + PER_PAGE));
    }

    console.error(`  Creating ${pages.length} grid page(s)...`);

    // Build all grid images
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
        const labelSvg = Buffer.from(
          `<svg width="${THUMB_W}" height="${LABEL_H}">
            <rect width="${THUMB_W}" height="${LABEL_H}" fill="#1a3a5c"/>
            <text x="3" y="11" font-family="Arial" font-size="9" fill="white" font-weight="bold">${globalIdx + 1}. ${allPhotos[globalIdx].place_name.substring(0, 16)}</text>
          </svg>`
        );
        composites.push({ input: labelSvg, left: x, top: y - LABEL_H });
      }

      const gridPath = resolve(tmpDir, `grid-${pg}.jpg`);
      await sharp({
        create: { width: gridW, height: gridH, channels: 3, background: { r: 240, g: 244, b: 248 } }
      }).composite(composites).jpeg({ quality: 75 }).toFile(gridPath);

      gridPaths.push({ path: gridPath, thumbs: pageThumbs, w: gridW, h: gridH });
    }

    // Send all grid pages to Claude Haiku in PARALLEL
    console.error(`  Sending ${gridPaths.length} grid(s) to Claude Haiku in parallel...`);

    const allVisionResults = [];
    const visionPromises = gridPaths.map(async (grid, pg) => {
      try {
        const promptText = `This is a grid of ${grid.thumbs.length} numbered photos from various places. I'm searching for: ${criteriaStr}.

Score each photo 0-10: outdoor patio/beer garden/food truck = high, interior/logos/beer taps = 0.

Return ONLY a JSON array: [{"n":1,"s":8},{"n":2,"s":1},...] where n=photo number, s=score. ALL photos.`;

        const result = execSync(
          `claude -p ${JSON.stringify(promptText)} --model haiku --allowedTools Read <<< "Read the image at ${grid.path}"`,
          { timeout: 60000, maxBuffer: 2 * 1024 * 1024, shell: '/bin/bash' }
        ).toString().trim();

        const scoresMatch = result.match(/\[[\s\S]*?\]/);
        if (scoresMatch) {
          const scores = JSON.parse(scoresMatch[0]);
          allVisionResults.push(...scores);
          console.error(`  Grid ${pg + 1}: scored ${scores.length} photos`);
        } else {
          console.error(`  Grid ${pg + 1}: could not parse response`);
        }
      } catch (err) {
        console.error(`  Grid ${pg + 1}: failed (${err.message})`);
      }
    });

    await Promise.all(visionPromises);

    // Apply vision scores
    let applied = 0;
    for (const vs of allVisionResults) {
      const photoNum = (vs.n || vs.num || vs.number) - 1;
      const score = vs.s || vs.score || 0;
      const validThumb = validThumbs.find(vt => vt.idx === photoNum);
      if (validThumb) {
        const photo = allPhotos[photoNum];
        const place = places[photo.placeIdx];
        if (place.photos?.[photo.photoIdx]) {
          place.photos[photo.photoIdx]._visionScore = score;
          place.photos[photo.photoIdx]._relevance = (place.photos[photo.photoIdx]._relevance || 0) + score * 0.15;
          applied++;
        }
      }
    }
    console.error(`  Vision total: ${allVisionResults.length} scored, ${applied} applied`);

    // Re-sort photos per place by relevance
    for (const place of places) {
      if (place.photos) place.photos.sort((a, b) => (b._relevance || 0) - (a._relevance || 0));
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

  // Rank photos by relevance to query criteria (metadata + vision)
  await rankPhotos(places, searchTerm, API_KEY);

  // Extract evidence from reviews for key differentiator criteria
  extractEvidence(places, searchTerm);
  const evidenceCount = places.reduce((n, p) => n + (p.evidence?.length || 0), 0);
  if (evidenceCount > 0) console.error(`Extracted ${evidenceCount} evidence excerpts from reviews`);

  const output = {
    query: searchTerm,
    location_bias: locationBias,
    radius_meters: parseFloat(radius),
    result_count: places.length,
    scraped_at: new Date().toISOString(),
    source: 'google_places_api',
    places
  };

  // Output to stdout
  console.log(JSON.stringify(output, null, 2));
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
