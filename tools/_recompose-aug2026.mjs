#!/usr/bin/env node
// _recompose-aug2026.mjs
// Reads <destination-slug>-mentions.json files and rebuilds each finalist's
// report_md + itinerary[] to be driven by cross-source mention counts. Sections
// driven by mentions: "What every source agrees on", "The food side",
// "Where to stay", and the entire itinerary. Existing "The place" intro +
// "Risks / tradeoffs" closer are preserved verbatim from the prior report.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { selectMany, pg } from './_db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const TRIP = 'cg7pgj64';

function readMaybeDouble(path) {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf-8');
  const first = JSON.parse(raw);
  return typeof first === 'string' ? JSON.parse(first) : first;
}

const dests = await selectMany('trip_destinations', { trip_id: TRIP },
  'select=id,slug,name,country,operational,scores,composite_score,sources,report_md,itinerary,hotel_pick&status=eq.finalist&order=ranking.asc');

console.log(`Trip ${TRIP}: ${dests.length} finalists\n`);

// Helpers ---------------------------------------------------------------

// Extract a section block from existing report_md by its "## <name>" header.
// Returns the text from the heading up to (but not including) the next "## " or end.
function extractSection(reportMd, headerNames) {
  if (!reportMd) return null;
  for (const name of headerNames) {
    const re = new RegExp(`^##\\s+${name.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\$&')}\\s*$([\\s\\S]*?)(?=^##\\s|\\Z)`, 'mi');
    const m = reportMd.match(re);
    if (m) return `## ${name}\n${m[1].trim()}`;
  }
  return null;
}

// Sort and group mentions by category
function topByCategory(mentions, category, limit) {
  return mentions.filter(m => m.category === category).slice(0, limit);
}

function bestSnippet(mention) {
  if (!mention.snippets?.length) return '';
  return mention.snippets[0].text || '';
}

function escapeMd(s) {
  return s.replace(/([_*\[\]])/g, '\\$1');
}

// Build "What every source agrees on" — top mention-counted places overall (not category-specific).
// When count is uniform (single-source per finalist for now), order by snippet richness.
function buildAgreeSection(destName, mentions, sources) {
  const top = mentions.slice(0, 8);
  const sourceLabel = sources.length === 1
    ? `_Names below are extracted from the **${sourceLabelFor(sources[0])}** article on this destination — single-source for this v1 run; future runs cross-reference 4–5 sources for true mention counting._`
    : `_Mention counts below reflect cross-references across ${sources.length} scraped sources: ${sources.map(sourceLabelFor).join(', ')}._`;
  const lines = top.map(m => {
    const snip = bestSnippet(m);
    const trimmed = snip.length > 220 ? snip.slice(0, 217) + '…' : snip;
    const catTag = `[#${m.category}]`;
    const srcTags = m.sources.map(s => `[#${sourceLabelFor(s)}]`).join(' ');
    return `- **${escapeMd(m.display)}** ${catTag} ${srcTags} — ${trimmed}`;
  });
  return `## What every source agrees on\n\n${sourceLabel}\n\n${lines.join('\n')}`;
}

function sourceLabelFor(src) {
  return ({
    'nyt36hours': 'NYT 36 Hours',
    'cntraveler': 'CN Traveler',
    'afar': 'AFAR',
    'lonelyplanet': 'Lonely Planet',
    'tl50best': 'Travel + Leisure 50 Best',
    'tl': 'Travel + Leisure',
  })[src] || src;
}

// Food section — top restaurants/cafes/bars by mention count
function buildFoodSection(mentions) {
  const restaurants = topByCategory(mentions, 'restaurant', 5);
  const cafes       = topByCategory(mentions, 'cafe', 3);
  const bars        = topByCategory(mentions, 'bar', 3);
  const lines = [];
  if (restaurants.length) {
    lines.push('**Restaurants the sources keep returning to:**');
    for (const m of restaurants) {
      const snip = bestSnippet(m).split('. ')[0]; // first sentence only
      lines.push(`- **${escapeMd(m.display)}** — ${snip}`);
    }
  }
  if (cafes.length) {
    lines.push('\n**Cafés / bakeries:**');
    for (const m of cafes) {
      const snip = bestSnippet(m).split('. ')[0];
      lines.push(`- **${escapeMd(m.display)}** — ${snip}`);
    }
  }
  if (bars.length) {
    lines.push('\n**Bars / nightlife:**');
    for (const m of bars) {
      const snip = bestSnippet(m).split('. ')[0];
      lines.push(`- **${escapeMd(m.display)}** — ${snip}`);
    }
  }
  if (!lines.length) return null;
  return `## The food side\n\n${lines.join('\n')}`;
}

// Stay section — top hotel
function buildStaySection(mentions) {
  const hotels = topByCategory(mentions, 'hotel', 3);
  if (!hotels.length) return null;
  const top = hotels[0];
  const snip = bestSnippet(top);
  let body = `**${escapeMd(top.display)}** — ${snip}`;
  if (hotels.length > 1) {
    body += '\n\nAlternates the same source named: ' +
      hotels.slice(1).map(h => `**${escapeMd(h.display)}**`).join(', ') + '.';
  }
  return `## Where to stay\n\n${body}`;
}

// Hotel pick JSON — top hotel
function buildHotelPick(mentions) {
  const hotels = topByCategory(mentions, 'hotel', 1);
  if (!hotels.length) return null;
  const top = hotels[0];
  return {
    name: top.display,
    summary: bestSnippet(top),
    mention_count: top.count,
    mention_sources: top.sources,
    source_url: null,
  };
}

// Itinerary — pick from mentions per slot type, no repeats across the trip
function buildItinerary(mentions, days = 4, destName = '') {
  const used = new Set();
  const pickFrom = (cats, fallback = []) => {
    for (const cat of cats) {
      const candidates = mentions.filter(m => m.category === cat && !used.has(m.display.toLowerCase()));
      if (candidates.length) {
        const pick = candidates[0];
        used.add(pick.display.toLowerCase());
        return pick;
      }
    }
    for (const fb of fallback) {
      const candidates = mentions.filter(m => m.category === fb && !used.has(m.display.toLowerCase()));
      if (candidates.length) {
        const pick = candidates[0];
        used.add(pick.display.toLowerCase());
        return pick;
      }
    }
    return null;
  };

  const itinerary = [];
  for (let day = 1; day <= days; day++) {
    const slots = [];
    const slotDefs = [
      { key: `${day}-morning`,   type: 'morning',   label: 'Morning · Nature / Beauty',           cats: ['park','landmark','museum','sight'] },
      { key: `${day}-lunch`,     type: 'lunch',     label: 'Lunch',                                cats: ['cafe','restaurant'] },
      { key: `${day}-afternoon`, type: 'afternoon', label: 'Afternoon · City / Walk',              cats: ['shop','sight','museum','park'] },
      { key: `${day}-dinner`,    type: 'dinner',    label: 'Dinner',                                cats: ['restaurant','cafe'] },
      { key: `${day}-evening`,   type: 'evening',   label: 'Evening · View / Bar',                  cats: ['bar','restaurant','sight'] },
    ];
    for (const sd of slotDefs) {
      const pick = pickFrom(sd.cats);
      if (pick) {
        const snip = bestSnippet(pick).split('. ')[0];
        slots.push({
          key: sd.key,
          type: sd.type,
          label: sd.label,
          place_name: pick.display,
          text: snip,
          mention_count: pick.count,
          mention_sources: pick.sources,
        });
      } else {
        // No mention available for this slot — leave a styled-text-only placeholder
        slots.push({
          key: sd.key,
          type: sd.type,
          label: sd.label,
          place_name: '—',
          text: 'No mention-sourced pick for this slot. Open question — suggest a place from your own knowledge or skip the slot.',
        });
      }
    }
    itinerary.push({ day, slots });
  }
  return itinerary;
}

// Recomposer ---------------------------------------------------------------

let updated = 0, skipped = 0;
for (const d of dests) {
  const mentionsPath = resolve(REPO_ROOT, `${d.slug}-mentions.json`);
  const mentionsData = readMaybeDouble(mentionsPath);
  if (!mentionsData?.mentions?.length) {
    console.log(`· ${d.slug}: no mentions file — keeping existing composition`);
    skipped++;
    continue;
  }
  // Thin-scrape guard — if fewer than 5 mentions made it through the filter,
  // the article was likely paywalled or used a non-standard format. Keep curated.
  if (mentionsData.mentions.length < 5) {
    console.log(`· ${d.slug}: only ${mentionsData.mentions.length} mentions (thin scrape) — keeping existing composition`);
    skipped++;
    continue;
  }
  const sources = mentionsData.sources_drilled || [];
  const M = mentionsData.mentions;

  // Preserve intro + risks from existing report
  const oldReport = d.report_md || '';
  const intro = extractSection(oldReport, ['The place', 'The place ']);
  const naturalSide = extractSection(oldReport, ['The natural side']);
  const citySide    = extractSection(oldReport, ['The city side']);
  const risks       = extractSection(oldReport, ['Risks / tradeoffs', 'Risks/tradeoffs']);

  // ── NEW: structured picks for the card-grid renderer ─────────────────
  // Replaces the prior "What every source agrees on" + "The food side" markdown
  // bullet sections. The renderer now uses these arrays to build card grids
  // (see renderSeeDoSection / renderFoodSection in trip.js).
  const SEE_DO_CATS = new Set(['museum', 'park', 'landmark', 'sight', 'shop']);
  const FOOD_CATS   = new Set(['restaurant', 'cafe', 'bar']);
  function pick(m) {
    return {
      name: m.display,
      category: m.category,
      count: m.count,
      sources: m.sources.map(sourceLabelFor),
      snippet: bestSnippet(m).split('. ')[0].slice(0, 220),
    };
  }
  const agree_picks = M.filter(m => SEE_DO_CATS.has(m.category)).slice(0, 8).map(pick);
  const food_picks  = M.filter(m => FOOD_CATS.has(m.category)).slice(0, 9).map(pick);

  // Compose report_md WITHOUT the bullet sections — those are now cards.
  const parts = [];
  if (intro)        parts.push(intro);
  if (naturalSide)  parts.push(naturalSide);
  if (citySide)     parts.push(citySide);
  if (risks)        parts.push(risks);
  const reportMd = parts.join('\n\n');

  const itinerary = buildItinerary(M, 4, d.name);
  const hotel_pick = buildHotelPick(M) || d.hotel_pick;

  // Merge into existing operational so we don't blow away other fields
  const newOperational = { ...(d.operational || {}), agree_picks, food_picks };

  await pg(`/trip_destinations?id=eq.${d.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      report_md: reportMd,
      itinerary,
      hotel_pick,
      operational: newOperational,
    }),
  });
  updated++;
  console.log(`✓ ${d.slug}: ${M.length} mentions used; ${itinerary.length} days × 5 slots; ${agree_picks.length} see-do, ${food_picks.length} food picks`);
}

console.log(`\n✓ Recomposed: ${updated}  Skipped: ${skipped}`);
console.log('Next: re-fetch Google Places photos for new itinerary slots:');
console.log(`  node tools/enrich-trip-itinerary-photos.mjs ${TRIP} --force`);
