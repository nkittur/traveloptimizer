#!/usr/bin/env node
// enrich-trip-climate.mjs — fetch early-August climatology for each active
// destination via Open-Meteo's free historical weather API (no key required).
// Aggregates daily highs/lows/precip across the past 5 Augusts (configurable).
//
// Writes `operational.climate` on each destination:
//   {
//     window:        "Aug 1–15",
//     years:         [2021,2022,2023,2024,2025],
//     avg_high_F:    78.4,
//     avg_low_F:     63.1,
//     hottest_F:     93.2,
//     avg_precip_mm: 2.3,
//     rainy_days:    5,
//     region_risks:  ["hurricane"|"wildfire"|"monsoon"|"heat-dome"],
//     comfort:       "mild" | "warm" | "hot" | "hot-with-water-mitigation",
//     checked_at:    ISO8601,
//     source:        "open-meteo-archive"
//   }
//
// Requires each destination to have lat/lng set (geocoding step).
//
// Usage:
//   node tools/enrich-trip-climate.mjs <trip-id>
//   node tools/enrich-trip-climate.mjs <trip-id> --force

import { selectOne, selectMany, pg } from './_db.mjs';

const tripId = process.argv[2];
const force = process.argv.includes('--force');
if (!tripId) { console.error('Usage: enrich-trip-climate.mjs <trip-id> [--force]'); process.exit(1); }

const trip = await selectOne('trips', { id: tripId });
if (!trip) { console.error(`No trip ${tripId}`); process.exit(2); }

const dests = await selectMany('trip_destinations', { trip_id: tripId },
  'select=id,slug,name,lat,lng,country,operational&status=in.(candidate,active,finalist)');

console.log(`Trip: ${trip.name}`);
console.log(`Destinations: ${dests.length}`);

const YEARS = [2021, 2022, 2023, 2024, 2025];
const WINDOW_START = '08-01';
const WINDOW_END   = '08-15';

function cToF(c) { return Number((c * 9/5 + 32).toFixed(1)); }
function avg(nums) { return nums.length ? nums.reduce((a,b)=>a+b,0) / nums.length : null; }
function regionRisks(lat, lng, country) {
  const risks = [];
  // Hurricane basin (Atlantic + Caribbean + Gulf): early-Aug start of peak season
  if (lat >= 8 && lat <= 35 && lng >= -100 && lng <= -55) risks.push('hurricane');
  // Western US wildfire belt
  if (lat >= 32 && lat <= 50 && lng >= -125 && lng <= -103 && (country === 'United States' || country === 'USA' || country === 'US' || !country)) {
    risks.push('wildfire');
  }
  // Mediterranean wildfire (S. Europe)
  if (lat >= 35 && lat <= 45 && lng >= -10 && lng <= 30) risks.push('wildfire');
  // South/SE Asia monsoon
  if (lat >= 5 && lat <= 30 && lng >= 65 && lng <= 110) risks.push('monsoon');
  // Pacific NW heat-dome risk has grown in recent years
  if (lat >= 42 && lat <= 50 && lng >= -125 && lng <= -118) risks.push('heat-dome');
  return risks;
}

function comfortLabel(highF, country, lat) {
  // crude near-coast / island heuristic — doesn't catch everything, but good enough as a hint
  // (real cool-down-mitigation gets confirmed during composition).
  if (highF <= 78) return 'mild';
  if (highF <= 84) return 'warm';
  if (highF <= 92) return 'hot';
  return 'hot';
}

let updated = 0, skipped = 0, missing = 0, failed = 0;

for (const d of dests) {
  if (!force && d.operational?.climate?.checked_at) { skipped++; continue; }
  if (d.lat == null || d.lng == null) {
    missing++;
    process.stderr.write(`  ${d.slug}: ⚠ no lat/lng — skipping\n`);
    continue;
  }

  const highs = [];
  const lows  = [];
  const precip = [];
  const rainyDayCounts = [];
  let hottest = -Infinity;

  for (const y of YEARS) {
    const url = `https://archive-api.open-meteo.com/v1/archive`
      + `?latitude=${d.lat}&longitude=${d.lng}`
      + `&start_date=${y}-${WINDOW_START}&end_date=${y}-${WINDOW_END}`
      + `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum`
      + `&temperature_unit=celsius&timezone=auto`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`open-meteo ${res.status}`);
      const j = await res.json();
      const days = j.daily?.time?.length || 0;
      let yearRainy = 0;
      for (let i = 0; i < days; i++) {
        const hi = j.daily.temperature_2m_max[i];
        const lo = j.daily.temperature_2m_min[i];
        const pr = j.daily.precipitation_sum[i];
        if (hi != null) { highs.push(hi); if (cToF(hi) > hottest) hottest = cToF(hi); }
        if (lo != null) lows.push(lo);
        if (pr != null) {
          precip.push(pr);
          if (pr >= 1.0) yearRainy++;  // ≥1 mm = "rainy day" by met convention
        }
      }
      rainyDayCounts.push(yearRainy);
    } catch (e) {
      process.stderr.write(`  ${d.slug}: ⚠ ${y} fetch failed (${e.message})\n`);
    }
    // Light pacing — Open-Meteo is generous but be polite
    await new Promise(r => setTimeout(r, 80));
  }

  if (highs.length === 0) {
    failed++;
    process.stderr.write(`  ${d.slug}: ✗ no climate data returned\n`);
    continue;
  }

  const avgHighF = cToF(avg(highs));
  const avgLowF  = cToF(avg(lows));
  const avgPrecip = Number(avg(precip).toFixed(2));
  const rainyDays = Math.round(avg(rainyDayCounts));
  const risks = regionRisks(d.lat, d.lng, d.country);

  const climate = {
    window: 'Aug 1–15',
    years: YEARS,
    avg_high_F: avgHighF,
    avg_low_F:  avgLowF,
    hottest_F:  Number(hottest.toFixed(1)),
    avg_precip_mm: avgPrecip,
    rainy_days: rainyDays,
    region_risks: risks,
    comfort: comfortLabel(avgHighF, d.country, d.lat),
    checked_at: new Date().toISOString(),
    source: 'open-meteo-archive',
  };

  const newOperational = { ...(d.operational || {}), climate };
  await pg(`/trip_destinations?id=eq.${d.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ operational: newOperational }),
  });
  updated++;
  process.stderr.write(`  ${d.slug}: hi ${avgHighF}°F / lo ${avgLowF}°F / hottest ${hottest.toFixed(0)}°F / rainy ${rainyDays}d${risks.length ? ' [' + risks.join(',') + ']' : ''}\n`);
}

console.log(`\n✓ Climate enrichment complete`);
console.log(`  Updated:           ${updated}`);
console.log(`  Skipped (cached):  ${skipped}`);
console.log(`  Missing lat/lng:   ${missing}`);
console.log(`  Failed:            ${failed}`);
