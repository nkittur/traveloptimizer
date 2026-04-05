#!/usr/bin/env node
// fetch-reviews: Enrich places with additional reviews from Yelp and Google
// Runs as a standalone tool (not nested inside nearby-places.mjs)
// Uses Claude web search to find real reviews from reputable sources.
//
// Usage: node tools/fetch-reviews.mjs <places.json> [criteria keywords]
// Output: enriched JSON to stdout
//
// Architecture: "conductor" that tries multiple strategies per place:
//   1. Claude + WebSearch for criteria-specific reviews (outdoor, food, etc.)
//   2. Claude + WebSearch for top/recent reviews (red flags, tradeoffs)
// Tracks search process metadata for transparency in the UI.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const inputFile = process.argv[2];
const criteriaArg = process.argv[3] || '';

if (!inputFile) {
  console.error('Usage: node tools/fetch-reviews.mjs <places.json> [criteria]');
  console.error('Example: node tools/fetch-reviews.mjs /tmp/places.json "outdoor seating, food"');
  process.exit(1);
}

const data = JSON.parse(readFileSync(resolve(inputFile), 'utf-8'));
const places = data.places;

// Parse criteria from the query or argument
const query = data.query || criteriaArg || '';
const criteriaTerms = [];
if (query.match(/outdoor|patio|outside|terrace|garden|seating/i))
  criteriaTerms.push('outdoor seating', 'patio');
if (query.match(/food|truck|eat|kitchen|menu/i))
  criteriaTerms.push('food');
if (query.match(/beer|brew|tap|ipa/i))
  criteriaTerms.push('beer selection');
if (query.match(/cocktail|whiskey|spirits/i))
  criteriaTerms.push('cocktails');
if (query.match(/music|live|band/i))
  criteriaTerms.push('live music');
if (query.match(/dog|pet/i))
  criteriaTerms.push('dog-friendly');

const BATCH_SIZE = 1; // 1 place per Claude call — web search is slow
// Sort by review count descending — popular places have more web reviews
const sortedPlaces = [...places]
  .map((p, i) => ({ ...p, _origIdx: i }))
  .sort((a, b) => (b.review_count || 0) - (a.review_count || 0));

// Only fetch for top 10 places (most likely to be chosen — web search is slow)
const targetPlaces = sortedPlaces.slice(0, 10);

console.error(`Fetching additional Yelp/Google reviews for ${targetPlaces.length} places...`);
console.error(`Criteria: ${criteriaTerms.join(', ') || 'general'}`);

async function fetchReviewBatch(batchPlaces, searchType) {
  const placeList = batchPlaces.map((p, i) =>
    `${i + 1}. "${p.name}" at ${p.address || p.full_address || ''}`
  ).join('\n');

  let prompt;
  if (searchType === 'criteria') {
    prompt = `Find real customer reviews from Yelp and Google for these places. Look specifically for reviews mentioning: ${criteriaTerms.join(', ')}.

${placeList}

Search Yelp and Google for each place. Return ONLY a JSON array of reviews you actually find:
[{"place":"exact place name","text":"the full review text","source":"yelp or google","rating":5}]

Rules:
- Only include REAL reviews from Yelp or Google — do not make up reviews
- Focus on reviews that mention ${criteriaTerms.join(' or ')}
- Include 3-5 reviews per place if available
- Include the reviewer's actual words, not summaries`;
  } else {
    prompt = `Find the most helpful and recent customer reviews from Yelp and Google for these places. Look for reviews that mention tradeoffs, red flags, or standout features.

${placeList}

Search Yelp and Google for each place. Return ONLY a JSON array:
[{"place":"exact place name","text":"the full review text","source":"yelp or google","rating":5}]

Rules:
- Only include REAL reviews — do not fabricate
- Prioritize detailed, helpful reviews (not just "great place!")
- Include reviews that mention problems or downsides too
- 2-3 reviews per place`;
  }

  try {
    const result = execSync(
      `claude -p ${JSON.stringify(prompt)} --allowedTools WebSearch,WebFetch < /dev/null`,
      { timeout: 180000, maxBuffer: 4 * 1024 * 1024, shell: '/bin/bash' }
    ).toString().trim();

    const jsonMatch = result.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return { reviews: [], error: 'no JSON in response' };

    const reviews = JSON.parse(jsonMatch[0]);
    return { reviews, error: null };
  } catch (err) {
    return { reviews: [], error: err.message.substring(0, 80) };
  }
}

async function main() {
  const searchLog = []; // Track what we searched and found

  // Phase 1: Criteria-specific reviews
  if (criteriaTerms.length > 0) {
    console.error(`\nPhase 1: Criteria-specific reviews (${criteriaTerms.join(', ')})...`);
    for (let batch = 0; batch < targetPlaces.length; batch += BATCH_SIZE) {
      const batchPlaces = targetPlaces.slice(batch, batch + BATCH_SIZE);
      const batchNum = Math.floor(batch / BATCH_SIZE) + 1;

      const { reviews, error } = await fetchReviewBatch(batchPlaces, 'criteria');

      const logEntry = {
        type: 'criteria',
        criteria: criteriaTerms,
        places: batchPlaces.map(p => p.name),
        found: 0,
        error,
      };

      if (!error && reviews.length > 0) {
        let added = 0;
        for (const wr of reviews) {
          // Match to place
          const place = batchPlaces.find(p =>
            p.name.toLowerCase().includes((wr.place || '').toLowerCase().substring(0, 15)) ||
            (wr.place || '').toLowerCase().includes(p.name.toLowerCase().substring(0, 15))
          );
          if (!place || !wr.text || wr.text.length < 20) continue;

          // Deduplicate
          const existing = (places[place._origIdx].reviews || []).map(r => (r.text || '').substring(0, 40).toLowerCase());
          if (existing.some(e => wr.text.toLowerCase().startsWith(e) || e.startsWith(wr.text.substring(0, 40).toLowerCase()))) continue;

          places[place._origIdx].reviews.push({
            text: wr.text.substring(0, 600),
            rating: wr.rating || null,
            time: null,
            source: wr.source || 'web',
          });
          added++;
        }
        logEntry.found = added;
        console.error(`  Batch ${batchNum}: +${added} criteria reviews from ${reviews.length} found`);
      } else {
        console.error(`  Batch ${batchNum}: ${error || 'no reviews found'}`);
      }
      searchLog.push(logEntry);
    }
  }

  // Phase 2: Top/recent reviews for red flags and tradeoffs
  console.error(`\nPhase 2: Top/recent reviews for red flags...`);
  // Only for top 15 places
  const topPlaces = targetPlaces.slice(0, 15);
  for (let batch = 0; batch < topPlaces.length; batch += BATCH_SIZE) {
    const batchPlaces = topPlaces.slice(batch, batch + BATCH_SIZE);
    const batchNum = Math.floor(batch / BATCH_SIZE) + 1;

    const { reviews, error } = await fetchReviewBatch(batchPlaces, 'top_recent');

    const logEntry = {
      type: 'top_recent',
      places: batchPlaces.map(p => p.name),
      found: 0,
      error,
    };

    if (!error && reviews.length > 0) {
      let added = 0;
      for (const wr of reviews) {
        const place = batchPlaces.find(p =>
          p.name.toLowerCase().includes((wr.place || '').toLowerCase().substring(0, 15)) ||
          (wr.place || '').toLowerCase().includes(p.name.toLowerCase().substring(0, 15))
        );
        if (!place || !wr.text || wr.text.length < 20) continue;

        const existing = (places[place._origIdx].reviews || []).map(r => (r.text || '').substring(0, 40).toLowerCase());
        if (existing.some(e => wr.text.toLowerCase().startsWith(e) || e.startsWith(wr.text.substring(0, 40).toLowerCase()))) continue;

        places[place._origIdx].reviews.push({
          text: wr.text.substring(0, 600),
          rating: wr.rating || null,
          time: null,
          source: wr.source || 'web',
        });
        added++;
      }
      logEntry.found = added;
      console.error(`  Batch ${batchNum}: +${added} top/recent reviews`);
    } else {
      console.error(`  Batch ${batchNum}: ${error || 'no reviews found'}`);
    }
    searchLog.push(logEntry);
  }

  // Summary
  const totalReviews = places.reduce((n, p) => n + (p.reviews || []).length, 0);
  const webReviews = places.reduce((n, p) =>
    n + (p.reviews || []).filter(r => r.source && r.source !== 'review').length, 0);
  console.error(`\nDone. Total reviews: ${totalReviews} (${webReviews} from web, ${totalReviews - webReviews} from API)`);

  // Attach search log to output
  data._reviewSearchLog = searchLog;
  data._reviewStats = {
    totalReviews,
    webReviews,
    apiReviews: totalReviews - webReviews,
    criteria: criteriaTerms,
    placesSearched: targetPlaces.length,
  };

  console.log(JSON.stringify(data, null, 2));
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
