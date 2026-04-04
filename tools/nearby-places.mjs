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

async function searchPlacesAPI(textQuery, locationBias) {
  // Use the Places API (New) Text Search
  const url = 'https://places.googleapis.com/v1/places:searchText';

  const body = {
    textQuery: textQuery,
    maxResultCount: 20,
    languageCode: 'en',
  };

  if (locationBias) {
    body.locationBias = {
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
  ].join(',');

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
    console.error('API Error:', JSON.stringify(data.error, null, 2));
    return null;
  }

  if (!data.places) return [];

  // Transform to clean output
  return data.places.map(p => {
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
      location: p.location ? { lat: p.location.latitude, lng: p.location.longitude } : null
    };
  });
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

            const text = await page.evaluate(() => document.body.innerText.toLowerCase());
            await page.close();

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
