#!/usr/bin/env node
// _score-aug2026.mjs — One-off scoring pass for the August 2026 trip.
// Computes per-bucket scores, composite, and picks top-6 finalists.
// Writes back via PATCH on each destination.

import { selectMany, pg } from './_db.mjs';

const TRIP = 'cg7pgj64';

// Per-destination editorial scores (judgment from sources + family fit, 0–5 scale,
// excluding climate_fit and pit_accessibility which derive from enrichment data).
// Captures: nature payoff, urban aesthetic depth, light-cuisine foodie strength,
// boutique-aesthetic stay availability, photo/instagram density.
const EDITORIAL = {
  'reykjavik-iceland':   { natural_beauty: 5.0, city_aesthetic: 3.5, foodie_light: 4.0, boutique_stays: 4.5, instagrammy: 5.0,
                           note: 'Black sand beaches, geothermal pools, Sand Hotel/ION, photogenic landscapes.' },
  'lisbon-portugal':     { natural_beauty: 3.5, city_aesthetic: 5.0, foodie_light: 5.0, boutique_stays: 5.0, instagrammy: 5.0,
                           note: 'Pastel streets, Sintra palaces, Memmo Alfama-tier boutiques, light Mediterranean food.' },
  'quebec-city-canada':  { natural_beauty: 4.0, city_aesthetic: 4.5, foodie_light: 4.0, boutique_stays: 4.5, instagrammy: 4.5,
                           note: 'Walled Old Town, Charlevoix river/mountains, Auberge Saint-Antoine, Quebec food scene.' },
  'montreal-canada':     { natural_beauty: 2.5, city_aesthetic: 4.5, foodie_light: 4.5, boutique_stays: 4.0, instagrammy: 4.0,
                           note: 'Mile End/Plateau aesthetic, top food city (Joe Beef etc.), but mostly urban.' },
  'vancouver-tofino':    { natural_beauty: 5.0, city_aesthetic: 4.0, foodie_light: 4.5, boutique_stays: 4.0, instagrammy: 4.0,
                           note: 'PNW mountains/ocean, Tofino beaches, strong Asian food, Wickaninnish Inn.' },
  'acadia-maine':        { natural_beauty: 5.0, city_aesthetic: 3.0, foodie_light: 4.0, boutique_stays: 4.0, instagrammy: 4.0,
                           note: 'Cadillac Mountain sunrise, lobster-shack scene, Bar Harbor inns. Limited city.' },
  'marthas-vineyard':    { natural_beauty: 4.0, city_aesthetic: 3.5, foodie_light: 4.0, boutique_stays: 4.5, instagrammy: 4.0,
                           note: 'Beaches + farms, Edgartown/Oak Bluffs aesthetic, Among the Flowers, Outermost Inn.' },
  'copenhagen-denmark':  { natural_beauty: 3.0, city_aesthetic: 5.0, foodie_light: 5.0, boutique_stays: 4.5, instagrammy: 4.5,
                           note: 'Nyhavn/Refshaleøen aesthetic, top food city (Noma alumni), bike-friendly. Limited nature.' },
  'stockholm-sweden':    { natural_beauty: 4.0, city_aesthetic: 4.5, foodie_light: 4.0, boutique_stays: 4.0, instagrammy: 4.0,
                           note: 'Archipelago day-trips, Gamla Stan, Ett Hem boutique hotel, strong food scene.' },
  'bergen-fjords-norway':{ natural_beauty: 5.0, city_aesthetic: 3.5, foodie_light: 3.5, boutique_stays: 3.5, instagrammy: 4.5,
                           note: 'Geiranger/Sognefjord world-class, Bryggen wharf photogenic, food scene growing.' },
  'banff-canada':        { natural_beauty: 5.0, city_aesthetic: 2.5, foodie_light: 3.0, boutique_stays: 4.0, instagrammy: 5.0,
                           note: 'Lake Louise/Moraine/Peyto are photo icons, Fairmont/Buffalo Mountain Lodge. Peak August crowds.' },
  'halifax-cape-breton': { natural_beauty: 4.5, city_aesthetic: 3.5, foodie_light: 3.5, boutique_stays: 3.5, instagrammy: 3.5,
                           note: 'Cabot Trail drive, Halifax growing food scene. Lower aesthetic density vs. peers.' },
  // Family-rich revisits (added 2026-04-27 after relaxing exclude_recently_visited rule)
  'san-diego-california':  { natural_beauty: 4.5, city_aesthetic: 4.5, foodie_light: 4.5, boutique_stays: 4.0, instagrammy: 4.5,
                             note: 'Best August coastal weather in US. Cousin Stefi. La Jolla coves, Balboa Park, foodie scene Bird Rock + Little Italy.' },
  'hamptons-newyork':      { natural_beauty: 4.0, city_aesthetic: 4.0, foodie_light: 4.5, boutique_stays: 4.5, instagrammy: 4.5,
                             note: 'Cousin Gaurav. East End beaches + farmstands. NYT 36 Hours 2025 cover. Boutique inns + light coastal food.' },
  'irvine-orange-county':  { natural_beauty: 3.5, city_aesthetic: 3.5, foodie_light: 4.0, boutique_stays: 3.5, instagrammy: 3.5,
                             note: 'Parents (3-4x/year visit). Newport coast + Crystal Cove. Strong Asian food, Irvine boutique mall scene. Hot inland but coast 15 min.' },
  // Hidden gems added 2026-04-27 (round 3)
  'asturias-spain':         { natural_beauty: 5.0, city_aesthetic: 4.0, foodie_light: 4.5, boutique_stays: 4.0, instagrammy: 4.5,
                              note: 'Northern Atlantic Spain. Picos de Europa + fishing villages + sidrerias. Far less American than Andalucía or Costa del Sol.' },
  'slovenia-bled-ljubljana':{ natural_beauty: 5.0, city_aesthetic: 4.0, foodie_light: 4.0, boutique_stays: 4.0, instagrammy: 5.0,
                              note: 'Lake Bled island church + Habsburg Ljubljana + Postojna Caves + Hiša Franko region. Carissa-leaning + Ashi photo paradise.' },
  'azores-portugal':        { natural_beauty: 5.0, city_aesthetic: 3.5, foodie_light: 4.0, boutique_stays: 4.0, instagrammy: 4.5,
                              note: 'Volcanic crater lakes, hot springs, hidden boutique pousadas. Mid-Atlantic, low US tourist density. Whale watching reliable.' },
  'costa-brava-spain':      { natural_beauty: 4.5, city_aesthetic: 4.5, foodie_light: 5.0, boutique_stays: 4.5, instagrammy: 5.0,
                              note: 'Cap de Creus rocky coves + Cadaqués + Empordà food region (El Celler de Can Roca, Compartir, Disfrutar alums everywhere). Coastal mitigation for the heat.' },
  'cortina-italy':          { natural_beauty: 5.0, city_aesthetic: 4.0, foodie_light: 4.0, boutique_stays: 5.0, instagrammy: 5.0,
                              note: 'Italian Dolomites — limestone-spire mountains right behind town. Cortina has the best mountain-boutique-hotel concentration in Europe (Cristallo, Rosapetra, Lajadira).' },
  'newport-rhode-island':   { natural_beauty: 4.0, city_aesthetic: 4.5, foodie_light: 4.5, boutique_stays: 4.5, instagrammy: 4.5,
                              note: 'Gilded Age mansions, Cliff Walk, sailing harbor, Aquidneck farm-to-table boom. PIT short hop. Carissa-vintage-bar paradise.' },
  'magdalen-islands-quebec':{ natural_beauty: 5.0, city_aesthetic: 3.0, foodie_light: 3.5, boutique_stays: 3.5, instagrammy: 4.5,
                              note: 'Crescent of red-cliff islands in Gulf of St. Lawrence. Acadian-French culture, lobster pounds, white-sand beaches. Truly remote.' },
};

// Score climate_fit from enrichment data.
// Sweet spot widened to 65–84°F (per 2026-04-27 user revision in ghostwheel travel.md).
// 84-90°F is OK if the destination has clear cool-down mitigation (coastal, lake, pool).
// <65°F is acceptable for landscape-driven trips but starts to feel "dressing for cold."
function scoreClimate(climate, region) {
  if (!climate) return null;
  const h = climate.avg_high_F, hot = climate.hottest_F, risks = climate.region_risks || [];
  const hasMitigation = /coast|island|lake|fjord|river|beach|archipelago|mountain/i.test(region || '');
  // Sweet spot 65-84°F: 5.0 (or 4.5 if region risks)
  if (h >= 65 && h <= 84) return (risks.includes('heat-dome') || risks.includes('wildfire')) ? 4.5 : 5.0;
  // 60-65 or 84-88 with mitigation: 4.0
  if (h >= 60 && h <= 88) {
    if (h > 84 && !hasMitigation) return 3.0;          // hot, no mitigation
    if (h > 84 && risks.includes('wildfire')) return 3.0;
    return 4.0;
  }
  // 55-60 (chilly) or 88-92 (hot): 3.0 — workable but not great
  if (h >= 55 && h <= 92) {
    if (h > 88 && risks.includes('wildfire')) return 2.0;
    return 3.0;
  }
  // <55 or >92: 2.0 (very chilly or oppressive)
  return 2.0;
}

// Score family-visit cooldown — applies a soft demotion when a destination was
// recently visited and the cooldown window hasn't elapsed. Per ghostwheel
// travel.md (2026-04-27 revision): parents 3-month cooldown, cousins/friends
// 6-month cooldown.
//
// Reads `d.operational.recently_visited` = { last_visited_iso, who, cooldown_months }
// Returns a NEGATIVE number (penalty applied to composite_score) and a textual
// reason string for the UI.
//
// Trip start hard-coded for the Aug 2026 trip (would be passed in for a generic
// implementation). Calling code: composite_score = sum(weighted) - cooldownPenalty.
function scoreCooldown(d, tripStartIso = '2026-08-01') {
  const rv = d.operational?.recently_visited;
  if (!rv || !rv.last_visited_iso || !rv.cooldown_months) return { penalty: 0, reason: null };
  const last = new Date(rv.last_visited_iso).getTime();
  const start = new Date(tripStartIso).getTime();
  const monthsOut = (start - last) / (1000 * 60 * 60 * 24 * 30.4375);
  if (monthsOut >= rv.cooldown_months) {
    return { penalty: 0, reason: `Last visited ${rv.last_visited_iso} (${monthsOut.toFixed(1)} mo before trip — past ${rv.cooldown_months}-mo cooldown)` };
  }
  // Linear ramp from MAX_PENALTY at "just visited" → 0 at "exactly cooldown out"
  const MAX_PENALTY = 0.6;
  const ratio = Math.max(0, monthsOut) / rv.cooldown_months;
  const penalty = Number(((1 - ratio) * MAX_PENALTY).toFixed(2));
  return {
    penalty,
    reason: `Last visited ${rv.last_visited_iso} (${monthsOut.toFixed(1)} mo before trip; ${rv.cooldown_months}-mo cooldown not elapsed) — soft demotion ${penalty.toFixed(2)}`,
    monthsOut: Number(monthsOut.toFixed(1)),
  };
}

// Score pit_accessibility — what matters is total door-to-door time vs. trip length, not nonstop-vs-1-stop.
// Per 2026-04-27 user revision in ghostwheel travel.md: 1-stop is fine if layover is sane.
function scorePit(routing) {
  if (!routing) return 3.0;
  if (routing.status === 'nonstop') {
    return routing.seasonal ? 4.5 : 5.0;
  }
  if (routing.status === 'no_nonstop') {
    // 1-stop with a normal layover = 4.0 (was 3.0 — softened)
    return 4.0;
  }
  return 3.5;
}

const WEIGHTS = {
  climate_fit:       2.0,
  pit_accessibility: 1.0,    // softened: total time matters, not direct-vs-1-stop
  natural_beauty:    1.5,
  city_aesthetic:    1.2,
  foodie_light:      1.2,
  boutique_stays:    1.0,
  instagrammy:       0.8,
};

const dests = await selectMany('trip_destinations', { trip_id: TRIP });
const sumW = Object.values(WEIGHTS).reduce((a,b)=>a+b, 0);

const scored = dests.map(d => {
  const ed = EDITORIAL[d.slug] || {};
  const scores = {
    climate_fit:       scoreClimate(d.operational?.climate, d.region),
    pit_accessibility: scorePit(d.operational?.pit_routing),
    natural_beauty:    ed.natural_beauty,
    city_aesthetic:    ed.city_aesthetic,
    foodie_light:      ed.foodie_light,
    boutique_stays:    ed.boutique_stays,
    instagrammy:       ed.instagrammy,
  };
  let weighted = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) {
    weighted += (scores[k] ?? 0) * w;
  }
  const cooldown = scoreCooldown(d);
  const composite = Number((weighted / sumW - cooldown.penalty).toFixed(2));
  return { d, scores, composite, note: ed.note, cooldown };
});

scored.sort((a, b) => b.composite - a.composite);

console.log('Ranked (composite / climate / pit / nat / city / food / boutique / insta):');
for (const r of scored) {
  const s = r.scores;
  console.log(`  ${r.composite.toFixed(2)}  ${r.d.slug.padEnd(24)}  ` +
    `${(s.climate_fit ?? '–').toString().padStart(3)}  ` +
    `${(s.pit_accessibility ?? '–').toString().padStart(3)}  ` +
    `${(s.natural_beauty ?? '–').toString().padStart(3)}  ` +
    `${(s.city_aesthetic ?? '–').toString().padStart(3)}  ` +
    `${(s.foodie_light ?? '–').toString().padStart(3)}  ` +
    `${(s.boutique_stays ?? '–').toString().padStart(3)}  ` +
    `${(s.instagrammy ?? '–').toString().padStart(3)}`);
}

// All scored destinations become finalists (the overview shows them all). For
// each, write/preserve operational.tagline so the overview cards have prose.
const topN = scored.length;
for (let i = 0; i < scored.length; i++) {
  const r = scored[i];
  const newOperational = { ...(r.d.operational || {}) };
  if (!newOperational.tagline && r.note) newOperational.tagline = r.note;
  // Surface the cooldown reason on the destination so the renderer can show it.
  if (r.cooldown?.reason) {
    newOperational.cooldown_status = {
      penalty: r.cooldown.penalty,
      reason: r.cooldown.reason,
      months_out: r.cooldown.monthsOut ?? null,
      ok: r.cooldown.penalty === 0,
    };
  } else {
    delete newOperational.cooldown_status;
  }
  await pg(`/trip_destinations?id=eq.${r.d.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      scores: r.scores,
      composite_score: r.composite,
      status: 'finalist',
      ranking: i + 1,
      operational: newOperational,
    }),
  });
}

console.log(`\n✓ Scored ${dests.length}, marked top ${topN} as finalists.`);
console.log(`Top: ${scored.slice(0, topN).map(r => `#${scored.indexOf(r)+1} ${r.d.name}`).join(', ')}`);
