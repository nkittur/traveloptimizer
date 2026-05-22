#!/usr/bin/env node
// _upsert-carmel-photos.mjs — Insert trip_destination_photos for the Carmel/SC
// hook-options trip. URLs are absolute (Wikipedia Commons + official hotel
// site OG images), so they get used verbatim by tripPhotoUrl().
import { pg } from './_db.mjs';

const TRIP_ID = 'ygm5x2kd';

// Photo manifest by destination slug. Buckets per schema:
// hero | natural-beauty | city-aesthetic | foodie | boutique-stay | climate-feel
const PHOTOS = {
  'treebones-big-sur-omakase-hook': [
    { bucket: 'hero',           url: 'https://www.treebonesresort.com/wp-content/uploads/2026/04/Yurts-at-Treebones-Resort.webp', caption: 'Ocean-view yurts at Treebones Resort, Big Sur', source: 'Treebones Resort' },
    { bucket: 'natural-beauty', url: 'https://upload.wikimedia.org/wikipedia/commons/7/72/McWay_Falls_Big_Sur_September_2012_002.jpg', caption: 'McWay Falls — 80-ft waterfall onto the Pacific, Julia Pfeiffer Burns SP', source: 'Wikipedia Commons' },
    { bucket: 'natural-beauty', url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d5/Pfieffer_Beach.jpg/3840px-Pfieffer_Beach.jpg', caption: 'Pfeiffer Beach purple sand, Big Sur', source: 'Wikipedia Commons', rank: 2 },
    { bucket: 'city-aesthetic', url: 'https://upload.wikimedia.org/wikipedia/commons/a/a7/Carmel_Mission_Church.jpg', caption: 'Carmel Mission — the village base for nights 3-4', source: 'Wikipedia Commons' },
    { bucket: 'boutique-stay',  url: 'https://cypress-inn.com/wp-content/uploads/2025/06/Living-Room-Arch-And-Lobby-1280-720.jpg', caption: "Cypress Inn lobby — Doris Day's Carmel hotel, walkable to village", source: 'Cypress Inn' },
    { bucket: 'foodie',         url: 'https://cypress-inn.com/wp-content/uploads/2025/07/Terrys-Ahi-Tuna-Tartare-1280-700.jpg', caption: "Ahi tuna tartare at Terry's Lounge, Cypress Inn", source: 'Cypress Inn' },
    { bucket: 'climate-feel',   url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/Central_Californian_Coastline%2C_Big_Sur_-_May_2013.jpg/3840px-Central_Californian_Coastline%2C_Big_Sur_-_May_2013.jpg', caption: 'Big Sur coastline — coastal-cool in August', source: 'Wikipedia Commons' },
  ],
  'santa-cruz-carmel-summer-split': [
    { bucket: 'hero',           url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b2/Colorful_Venetian_Hotel_on_the_Beach_in_Capitola_%288038026675%29_%28cropped%29.jpg/3840px-Colorful_Venetian_Hotel_on_the_Beach_in_Capitola_%288038026675%29_%28cropped%29.jpg', caption: 'Capitola Venetian Court — pastel beachfront rowhouses', source: 'Wikipedia Commons' },
    { bucket: 'natural-beauty', url: 'https://upload.wikimedia.org/wikipedia/commons/d/d9/SantaCruz_BeachBoardwalk_GiantDipperTrack2_DSCN9390.JPG', caption: 'Giant Dipper (1924) at Santa Cruz Beach Boardwalk', source: 'Wikipedia Commons' },
    { bucket: 'natural-beauty', url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/Central_Californian_Coastline%2C_Big_Sur_-_May_2013.jpg/3840px-Central_Californian_Coastline%2C_Big_Sur_-_May_2013.jpg', caption: 'Central California coastline', source: 'Wikipedia Commons', rank: 2 },
    { bucket: 'city-aesthetic', url: 'https://upload.wikimedia.org/wikipedia/commons/a/a7/Carmel_Mission_Church.jpg', caption: 'Carmel-by-the-Sea village', source: 'Wikipedia Commons' },
    { bucket: 'boutique-stay',  url: 'https://www.dreaminnsantacruz.com/images/hero/full/dream-inn_renato-films_photography_500.jpg', caption: 'Dream Inn Santa Cruz — only true beachfront, on Cowell Beach', source: 'Dream Inn' },
    { bucket: 'boutique-stay',  url: 'https://cypress-inn.com/wp-content/uploads/2025/07/Cypress-Inn-Front-Entrance-1052-700.jpg', caption: "Cypress Inn entrance — Doris Day's vintage Hollywood hotel", source: 'Cypress Inn', rank: 2 },
    { bucket: 'foodie',         url: 'https://cypress-inn.com/wp-content/uploads/2025/07/Terrys-Ahi-Tuna-Tartare-1280-700.jpg', caption: "Ahi tuna tartare at Terry's Lounge", source: 'Cypress Inn' },
    { bucket: 'climate-feel',   url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d5/Pfieffer_Beach.jpg/3840px-Pfieffer_Beach.jpg', caption: 'Coastal August — mild and foggy mornings', source: 'Wikipedia Commons' },
  ],
  'carmel-valley-ranch-resort-hub': [
    { bucket: 'hero',           url: 'https://assets.hyatt.com/content/dam/hyatt/hyattdam/images/2019/05/16/1523/Carmel-Valley-Ranch-P052-Vineyard.jpg/Carmel-Valley-Ranch-P052-Vineyard.4x3.jpg', caption: 'Carmel Valley Ranch vineyard — 500 acres of rolling hills', source: 'Hyatt' },
    { bucket: 'natural-beauty', url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Carmel_Valley_-_panoramio.jpg/3840px-Carmel_Valley_-_panoramio.jpg', caption: 'Carmel Valley — vineyards and rolling hills', source: 'Wikipedia Commons' },
    { bucket: 'natural-beauty', url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/Bixby_Creek_Bridge%2C_California%2C_USA_-_May_2013.jpg/3840px-Bixby_Creek_Bridge%2C_California%2C_USA_-_May_2013.jpg', caption: 'Bixby Bridge — Big Sur day-trip stop', source: 'Wikipedia Commons', rank: 2 },
    { bucket: 'city-aesthetic', url: 'https://upload.wikimedia.org/wikipedia/commons/a/a7/Carmel_Mission_Church.jpg', caption: 'Carmel village — 15 min from CVR', source: 'Wikipedia Commons' },
    { bucket: 'boutique-stay',  url: 'https://assets.hyatt.com/content/dam/hyatt/hyattdam/images/2019/05/16/1523/Carmel-Valley-Ranch-P052-Vineyard.jpg/Carmel-Valley-Ranch-P052-Vineyard.4x3.jpg', caption: 'Carmel Valley Ranch — Hyatt Unbound Collection, on the dream-tier list', source: 'Hyatt' },
    { bucket: 'foodie',         url: 'https://cypress-inn.com/wp-content/uploads/2025/07/Terrys-Ahi-Tuna-Tartare-1280-700.jpg', caption: 'Carmel Valley fine-dining', source: 'Cypress Inn (illustrative)' },
    { bucket: 'climate-feel',   url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Carmel_Valley_-_panoramio.jpg/3840px-Carmel_Valley_-_panoramio.jpg', caption: 'Warm valley microclimate (82°F days, cool nights)', source: 'Wikipedia Commons' },
  ],
  'sea-otter-carmel-single-base': [
    { bucket: 'hero',           url: 'https://upload.wikimedia.org/wikipedia/commons/0/02/Sea_Otter_%28Enhydra_lutris%29_%2825169790524%29_crop.jpg', caption: 'Sea otter — 100+ live at Elkhorn Slough', source: 'Wikipedia Commons' },
    { bucket: 'natural-beauty', url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6e/Whaler%27s_Cove%2C_Point_Lobos%2C_CA%2C_US_-_May_2013.jpg/3840px-Whaler%27s_Cove%2C_Point_Lobos%2C_CA%2C_US_-_May_2013.jpg', caption: "Whaler's Cove, Point Lobos — Ansel Adams shot here", source: 'Wikipedia Commons' },
    { bucket: 'natural-beauty', url: 'https://upload.wikimedia.org/wikipedia/commons/d/d2/Moss_Landing_California_aerial_view.jpg', caption: 'Moss Landing / Elkhorn Slough — the sea otter colony', source: 'Wikipedia Commons', rank: 2 },
    { bucket: 'natural-beauty', url: 'https://upload.wikimedia.org/wikipedia/commons/7/72/McWay_Falls_Big_Sur_September_2012_002.jpg', caption: 'McWay Falls — Big Sur day-trip', source: 'Wikipedia Commons', rank: 3 },
    { bucket: 'city-aesthetic', url: 'https://upload.wikimedia.org/wikipedia/commons/a/a7/Carmel_Mission_Church.jpg', caption: 'Carmel-by-the-Sea — single base for 4 nights', source: 'Wikipedia Commons' },
    { bucket: 'boutique-stay',  url: 'https://cypress-inn.com/wp-content/uploads/2025/06/Living-Room-Arch-And-Lobby-1280-720.jpg', caption: 'Cypress Inn — alt to La Playa for the single-base choice', source: 'Cypress Inn' },
    { bucket: 'foodie',         url: 'https://cypress-inn.com/wp-content/uploads/2025/07/Terrys-Ahi-Tuna-Tartare-1280-700.jpg', caption: "Carmel village dining — Terry's Lounge ahi tartare", source: 'Cypress Inn' },
    { bucket: 'climate-feel',   url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/Central_Californian_Coastline%2C_Big_Sur_-_May_2013.jpg/3840px-Central_Californian_Coastline%2C_Big_Sur_-_May_2013.jpg', caption: 'Coastal Carmel — mild summer days', source: 'Wikipedia Commons' },
  ],
};

async function main() {
  // Get the destination IDs for this trip
  const dests = await pg(`/trip_destinations?trip_id=eq.${TRIP_ID}&select=id,slug`);
  if (!dests?.length) throw new Error(`No destinations found for trip ${TRIP_ID}`);
  const bySlug = Object.fromEntries(dests.map(d => [d.slug, d.id]));

  // Wipe existing photos for these destinations
  const destIds = dests.map(d => d.id);
  await pg(`/trip_destination_photos?trip_destination_id=in.(${destIds.join(',')})`, { method: 'DELETE' });
  process.stderr.write(`Wiped existing photos for ${destIds.length} destinations.\n`);

  let total = 0;
  for (const [slug, photos] of Object.entries(PHOTOS)) {
    const destId = bySlug[slug];
    if (!destId) {
      process.stderr.write(`  ⚠ No destination with slug=${slug} — skipping\n`);
      continue;
    }
    const rows = photos.map((p, i) => ({
      trip_destination_id: destId,
      storage_path: p.url,
      source_url: p.url,
      source_name: p.source,
      caption: p.caption,
      alt_text: p.caption,
      bucket: p.bucket,
      rank: p.rank ?? (i + 1),
      attribution: `Photo via ${p.source}`,
    }));
    await pg('/trip_destination_photos', {
      method: 'POST',
      body: JSON.stringify(rows),
    });
    process.stderr.write(`  ${slug}: +${rows.length} photos\n`);
    total += rows.length;
  }
  process.stderr.write(`\nInserted ${total} photos across ${Object.keys(PHOTOS).length} destinations.\n`);
  process.stdout.write(`https://webapp-rust-phi.vercel.app/?t=${TRIP_ID}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
