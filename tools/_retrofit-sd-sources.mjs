#!/usr/bin/env node
// One-off: attach source article URLs + Reddit thread arrays to the existing
// SD group's restaurant rows. The original SD backfill predated the
// "source.url" / "source.threads" fields, so detail-view sources rendered
// as plain text. This walks each row in place and upserts them back.
//
// No scrape re-run, no loss of votes/comments/state. Idempotent — running
// it twice is a no-op after the first pass because we only overwrite with
// the same data.
import { pg, selectMany, upsert } from './_db.mjs';

const GROUP_ID = 'fgvy96yg'; // SD group

// Editorial source URLs (copied from the SD build's original metadata in
// webapp/js/components.js renderGlobalSourcesModal)
const SOURCE_ARTICLES = {
  eater: {
    url: 'https://sandiego.eater.com/maps/38-best-restaurants-san-diego-california',
    detail: 'Eater San Diego — The 38 Best Restaurants',
  },
  eater_new: {
    url: 'https://sandiego.eater.com/maps/best-new-san-diego-restaurants-heatmap',
    detail: 'Eater San Diego — Best New Restaurants (Heatmap)',
  },
  infatuation: {
    url: 'https://www.theinfatuation.com/san-diego/guides/san-diego-restaurants',
    detail: 'The Infatuation — 25 Best Restaurants in San Diego',
  },
  cnt: {
    url: 'https://www.cntraveler.com/gallery/best-restaurants-in-san-diego',
    detail: 'Condé Nast Traveler — 25 Best Restaurants in San Diego',
  },
};

// The 11 SD Reddit threads the original scrape drew from
const SD_REDDIT_THREADS = [
  { title: 'La Jolla Day — Where to hit?',                                   url: 'https://www.reddit.com/r/FoodSanDiego/comments/1ljq6yg/la_jolla_day_where_to_hit/' },
  { title: 'Must Try food in La Jolla',                                      url: 'https://www.reddit.com/r/FoodSanDiego/comments/1gs8hhm/must_try_food_in_la_jolla/' },
  { title: "Decent restaurants in La Jolla that aren't expensive",           url: 'https://www.reddit.com/r/FoodSanDiego/comments/1qxquq8/what_are_some_decent_restaurants_in_la_jolla_that/' },
  { title: 'Fine dining near La Jolla',                                      url: 'https://www.reddit.com/r/FoodSanDiego/comments/1or4bt6/fine_dining_near_la_jolla/' },
  { title: "La Jolla restaurants with a view that aren't George's",          url: 'https://www.reddit.com/r/FoodSanDiego/comments/1elp15q/la_jolla_restaurants_with_a_view_that_arent/' },
  { title: 'Best nice restaurant in La Jolla',                               url: 'https://www.reddit.com/r/FoodSanDiego/comments/x4fzt0/best_nice_restaurant_in_la_jolla/' },
  { title: 'Mid/High-End Restaurants that are actually WORTH IT',            url: 'https://www.reddit.com/r/FoodSanDiego/comments/1lmusdd/midhighend_restaurants_that_are_actually_worth_it/' },
  { title: "What restaurants are a 'can't miss' in SD?",                     url: 'https://www.reddit.com/r/FoodSanDiego/' },
  { title: 'Underrated restaurants',                                         url: 'https://www.reddit.com/r/sandiego/' },
  { title: 'Most underrated restaurant in San Diego?',                       url: 'https://www.reddit.com/r/SanDiegan/' },
  { title: 'Quintessential San Diego restaurants to take visitors to?',      url: 'https://www.reddit.com/r/FoodSanDiego/' },
];

const rows = await selectMany('group_restaurants',
  { group_id: GROUP_ID, status: 'active' },
  'select=group_id,restaurant_id,data');
console.log(`Loaded ${rows.length} active SD restaurants`);

const updates = [];
let touched = 0;

for (const row of rows) {
  const r = row.data || {};
  const sources = Array.isArray(r.sources) ? r.sources : [];
  let changed = false;

  for (const s of sources) {
    if (s.type === 'reddit') {
      if (!Array.isArray(s.threads)) {
        // All SD reddit sources get the full thread list (we don't have per-
        // restaurant thread attribution — the original build collapsed into
        // one reddit source with a mention count). Linking all threads is a
        // reasonable degradation.
        s.threads = SD_REDDIT_THREADS;
        s.detail = s.detail || `r/FoodSanDiego — ${SD_REDDIT_THREADS.length} threads`;
        changed = true;
      }
    } else {
      const art = SOURCE_ARTICLES[s.type];
      if (art && !s.url) {
        s.url = art.url;
        if (!s.detail || s.detail.length < 10) s.detail = art.detail;
        changed = true;
      }
    }
  }

  if (changed) {
    touched++;
    updates.push({ ...row, data: { ...r, sources } });
  }
}

console.log(`Rows touched: ${touched} / ${rows.length}`);

if (!updates.length) {
  console.log('Nothing to update.');
  process.exit(0);
}

// Batched upsert
const BATCH = 50;
for (let i = 0; i < updates.length; i += BATCH) {
  const slice = updates.slice(i, i + BATCH);
  await upsert('group_restaurants', slice, { onConflict: 'group_id,restaurant_id' });
  process.stderr.write(`  upserted ${Math.min(i + BATCH, updates.length)}/${updates.length}\r`);
}
process.stderr.write('\n');

console.log('✓ SD source URLs retrofitted');
console.log(`  Verify: https://webapp-rust-phi.vercel.app/?g=${GROUP_ID}`);
