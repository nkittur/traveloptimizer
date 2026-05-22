#!/usr/bin/env node
// _upsert-carmel-aug2026.mjs — One-off upsert: creates the "Carmel/SC hook options"
// trip + 4 candidate configurations of the same trip, each anchored on a
// different "highlight." Renders at /?t=<token>.
import { pg } from './_db.mjs';

const TRIP = {
  name: 'Carmel / Santa Cruz — Aug 2026 · Hook options',
  dates_start: '2026-08-01',
  dates_end: '2026-08-05',
  duration_days: 5,
  origin_airport: 'PIT',
  traveler_slugs: ['niki', 'carissa', 'ashi'],
  criteria: {
    freeText:
      'Hook-led 4-night summer vacation in the Carmel/Big Sur/Santa Cruz region. Each "destination" below is one configuration of the same trip built BACKWARD from a single highlight that would excite Carissa (vintage/atmospheric + dramatic nature) and Ashi (Instagram/aesthetic). Min 2 nights at any base. Hotel cap $500/night cash (Hyatt-points exception for dream-tier resorts). 14yo daughter — adults-only and max-2-guests stays excluded.',
  },
  is_public: true,
  created_by_name: 'Niki',
};

const COMMON_SOURCES = [
  { type: 'nyt36hours', title: 'NYT 36 Hours archive (Big Sur / Carmel / Santa Cruz)', url: 'https://www.nytimes.com/section/travel' },
  { type: 'afar', title: 'AFAR — Carmel & Big Sur features', url: 'https://www.afar.com/' },
  { type: 'cntraveler', title: 'CN Traveler best stays + restaurants', url: 'https://www.cntraveler.com/' },
];

// ───────── Hook B: Treebones omakase (RANK 1 — most distinctive) ─────────
const B_TREEBONES = {
  slug: 'treebones-big-sur-omakase-hook',
  name: 'Treebones Big Sur — Omakase Hook',
  region: 'Big Sur + Carmel',
  status: 'finalist',
  ranking: 1,
  composite_score: 4.55,
  scores: {
    climate_fit: 4,
    pit_accessibility: 3,
    natural_beauty: 5,
    city_aesthetic: 4,
    foodie_light: 5,
    boutique_stays: 5,
    instagrammy: 5,
  },
  operational: {
    tagline:
      'The hook is a meal, not a hotel. Wild Coast Sushi — Treebones\' 8-seat omakase counter on a Big Sur clifftop — anchors the trip. Sleep in yurts on redwood platforms above the Pacific; spend the rest in fairy-tale Carmel-by-the-Sea.',
    hook_label: 'Wild Coast Sushi 8-seat clifftop omakase',
    base_shape: '2 nights Treebones (Big Sur) + 2 nights Cypress Inn (Carmel-by-the-Sea)',
    why_it_lands: [
      'Carissa — dramatic Big Sur cliffs replace lake-and-mountain; omakase counter = supper-club energy in its modern form',
      'Ashi — yurt-on-redwood-platform is genuinely photogenic and unusual; sushi as the event meal; she eats sushi (✓ fish, no cheese)',
      'Niki — Pacific clear water from the deck, sushi pedigree',
    ],
    climate: { window: 'Aug 1-5', comfort: 'mild-cool', avg_high_F: 68, avg_low_F: 53, notes: 'Big Sur mornings foggy until ~11am; coastal cool; bring layers.' },
    cost_estimate: '~$2,250 for 4 nights (yurt $400×2 + Cypress Inn ~$450×2 + omakase $150pp×3 = ~$2,250)',
    points_play: 'No Hyatt match — cash only. In budget at $300-400 cash equivalent/night.',
  },
  hotel_pick: {
    name: 'Treebones Resort — Ocean View Yurt',
    summary:
      'Yurt on a redwood platform above the Pacific. Onsite Wild Coast Sushi is the trip\'s anchor experience — 8 seats, omakase only, reservations months ahead. Treebones notes guests 6+ allowed (13+ recommended for omakase atmosphere — confirm Ashi at booking).',
    source_url: 'https://www.treebonesresort.com/',
    mention_count: 2,
    mention_sources: ['afar', 'cntraveler'],
  },
  itinerary: [
    {
      day: 1, label: 'Sat Aug 1 · Arrive Big Sur', slots: [
        { key: '1-afternoon', type: 'afternoon', label: 'Afternoon · Arrival', place_name: 'Drive Hwy 1', text: 'Fly into SJC or SFO, drive Hwy 1 south (~3-4 hr). Pull off at Bixby Bridge for the obligatory photo.' },
        { key: '1-evening', type: 'evening', label: 'Evening · Wild Coast Sushi', place_name: 'Wild Coast Sushi at Treebones', text: 'THE hook. 8-seat omakase counter on the Big Sur cliffside at sunset. Book 3+ months ahead.' },
      ],
    },
    {
      day: 2, label: 'Sun Aug 2 · Big Sur Full Day', slots: [
        { key: '2-morning', type: 'morning', label: 'Morning · McWay Falls', place_name: 'Julia Pfeiffer Burns SP', text: 'McWay Falls — 80-ft waterfall dropping straight onto the sand. Easy 0.6-mi walk to the viewpoint.' },
        { key: '2-lunch', type: 'lunch', label: 'Lunch · Big Sur Bakery', place_name: 'Big Sur Bakery', text: 'Wood-fired pizza, the regional standout. Carissa: skip the cheese options, take a wood-oven veg dish.' },
        { key: '2-afternoon', type: 'afternoon', label: 'Afternoon · Pfeiffer Beach', place_name: 'Pfeiffer Beach (purple sand)', text: 'Actually purple sand — manganese garnet washes down from the cliffs. Photogenic at golden hour.' },
        { key: '2-evening', type: 'evening', label: 'Evening · Treebones deck', place_name: 'Treebones yurt deck', text: 'Sunset from the yurt deck. Stargazing at Big Sur dark sky.' },
      ],
    },
    {
      day: 3, label: 'Mon Aug 3 · Big Sur → Carmel', slots: [
        { key: '3-morning', type: 'morning', label: 'Morning · Drive north', place_name: 'Hwy 1 north', text: 'Slow drive back up. Stop at Nepenthe for coffee with the view. Check Cypress Inn early afternoon.' },
        { key: '3-afternoon', type: 'afternoon', label: 'Afternoon · Carmel village', place_name: 'Carmel-by-the-Sea', text: 'Storybook cottages walking tour (Comstock fairy-tale houses), Secret Garden Passageway. Galleries on Ocean Ave.' },
        { key: '3-dinner', type: 'dinner', label: 'Dinner · Mission Ranch', place_name: 'Mission Ranch (Clint Eastwood)', text: 'Piano bar nightly — Carissa\'s wood-paneled supper-club box checked. Kid-friendly dining room.' },
      ],
    },
    {
      day: 4, label: 'Tue Aug 4 · Sea Otters + Point Lobos', slots: [
        { key: '4-morning', type: 'morning', label: 'Morning · Elkhorn Slough kayak', place_name: 'Monterey Bay Kayaks — Moss Landing', text: 'Guided 3-hr paddle through eelgrass beds where 100+ sea otters rest. 30 min drive north of Carmel. Min age 13 ✓.' },
        { key: '4-lunch', type: 'lunch', label: 'Lunch · Monterey', place_name: 'Cannery Row', text: 'Clam chowder + oysters with Pacific views. Monterey Bay Aquarium nearby if rainy.' },
        { key: '4-afternoon', type: 'afternoon', label: 'Afternoon · Point Lobos', place_name: 'Cypress Grove Trail', text: '0.9-mi loop through rare Monterey cypress — Ansel Adams shot this. Carmel Beach sunset after.' },
        { key: '4-dinner', type: 'dinner', label: 'Dinner · Aubergine or village', place_name: 'Aubergine at L\'Auberge Carmel', text: '1 Michelin star tasting menu ($295) — milestone meal option. Or simpler at Anton & Michel.' },
      ],
    },
    {
      day: 5, label: 'Wed Aug 5 · Fly Home', slots: [
        { key: '5-morning', type: 'morning', label: 'Morning · last walk', place_name: 'Carmel Beach', text: 'Beach walk with cypresses, last coffee at Carmel Coffee Roasting Co, fly home from MRY or SJC.' },
      ],
    },
  ],
  sources: [
    ...COMMON_SOURCES,
    { type: 'cntraveler', title: 'Treebones Resort + Wild Coast Sushi', url: 'https://www.treebonesresort.com/wild-coast-restaurant/' },
    { type: 'nyt36hours', title: 'NYT — McWay Falls & Pfeiffer Beach', url: 'https://www.nytimes.com/2023/09/14/travel/big-sur-california.html' },
    { type: 'afar', title: 'AFAR — Cypress Inn Carmel', url: 'https://www.afar.com/places/cypress-inn-carmel-by-the-sea' },
  ],
};

// ───────── Hook C: SC + Carmel split (RANK 2 — classic summer vacation) ─────────
const C_SC_CARMEL = {
  slug: 'santa-cruz-carmel-summer-split',
  name: 'Santa Cruz Beach + Carmel Village',
  region: 'Santa Cruz + Carmel',
  status: 'finalist',
  ranking: 2,
  composite_score: 4.45,
  scores: {
    climate_fit: 5,
    pit_accessibility: 3,
    natural_beauty: 4,
    city_aesthetic: 5,
    foodie_light: 4,
    boutique_stays: 4,
    instagrammy: 5,
  },
  operational: {
    tagline:
      'The hook is contrast: 2 nights of classic American beach-summer (boardwalk + Capitola colorful houses + surf lesson) followed by 2 nights of fairy-tale Carmel sophistication. Every day feels different.',
    hook_label: 'Capitola Venetian colorful houses + Boardwalk + surf lesson',
    base_shape: '2 nights Dream Inn Santa Cruz (beachfront) + 2 nights Cypress Inn or La Playa (Carmel)',
    why_it_lands: [
      'Ashi — Boardwalk = peak American summer; Capitola colorful houses are an iconic Instagram set; Pacific Avenue shopping has the teen brands; surf lesson at Cowell Beach',
      'Carissa — Carmel half delivers Mission Ranch piano + storybook village + cypress trees; Cypress Inn vintage Hollywood feel',
      'Niki — Pacific everywhere, oysters at Capitola, sushi at Akira (SC)',
    ],
    climate: { window: 'Aug 1-5', comfort: 'mild', avg_high_F: 72, avg_low_F: 56, notes: 'Coastal both bases, morning fog burns off mid-late morning.' },
    cost_estimate: '~$1,800 for 4 nights (Dream Inn $450×2 + Cypress Inn $450×2 = $1,800) — fully in cash budget',
    points_play: 'Skip — neither hotel is Hyatt. Best cash play of the four.',
  },
  hotel_pick: {
    name: 'Dream Inn Santa Cruz + Cypress Inn Carmel (split)',
    summary:
      'Dream Inn — only true beachfront in Santa Cruz, retro-modern oceanfront balconies right on Cowell Beach. Cypress Inn — Doris Day\'s Carmel hotel since 1985, Terry\'s Lounge wood-paneled bar, pet- and kid-friendly, walkable to all village dining + Brandy Melville Monterey nearby.',
    source_url: 'https://www.dreaminnsantacruz.com/',
    mention_count: 3,
    mention_sources: ['cntraveler', 'afar', 'eater'],
  },
  itinerary: [
    {
      day: 1, label: 'Sat Aug 1 · Arrive Santa Cruz', slots: [
        { key: '1-afternoon', type: 'afternoon', label: 'Afternoon · Boardwalk', place_name: 'Santa Cruz Beach Boardwalk', text: 'Fly into SJC, 45-min drive. Check Dream Inn, walk straight onto Cowell Beach. Boardwalk afternoon — Giant Dipper coaster (1924, wood, photogenic).' },
        { key: '1-evening', type: 'evening', label: 'Evening · Verve Coffee + dinner', place_name: 'Verve Coffee Roasters HQ', text: 'Aesthetic 3rd-wave coffee headquarters on 41st Ave. Dinner at Akira (sushi) or Soif (wine bar).' },
      ],
    },
    {
      day: 2, label: 'Sun Aug 2 · Capitola + Surf', slots: [
        { key: '2-morning', type: 'morning', label: 'Morning · Surf lesson', place_name: 'Cowell Beach surf school', text: 'Cowell\'s is the gentlest beginner break in CA. Group lesson, 1.5 hr, all ages.' },
        { key: '2-lunch', type: 'lunch', label: 'Lunch · Capitola Esplanade', place_name: 'Zelda\'s on the Beach', text: 'Drive 15 min south to Capitola. Lunch with feet-in-sand views of the Venetian Court.' },
        { key: '2-afternoon', type: 'afternoon', label: 'Afternoon · Venetian Court', place_name: 'Capitola Venetian Hotel & colorful houses', text: 'The pastel beachfront row — Italianate 1920s rowhouses painted candy colors. Top-3 Instagram of the trip for Ashi.' },
        { key: '2-evening', type: 'evening', label: 'Evening · Wharf sunset', place_name: 'Santa Cruz Wharf sea lions', text: 'Sea lions barking under the wharf, sunset over the Boardwalk. Dinner at Stagnaro Bros for the wharf classic.' },
      ],
    },
    {
      day: 3, label: 'Mon Aug 3 · Drive south to Carmel', slots: [
        { key: '3-morning', type: 'morning', label: 'Morning · 17-Mile Drive', place_name: 'Pebble Beach 17-Mile Drive', text: 'Scenic toll drive ($12) — Lone Cypress, Bird Rock, Spanish Bay. About 90 min with stops.' },
        { key: '3-afternoon', type: 'afternoon', label: 'Afternoon · Carmel village', place_name: 'Carmel-by-the-Sea', text: 'Check Cypress Inn. Storybook cottages walk, Secret Garden Passageway, Ocean Ave galleries.' },
        { key: '3-dinner', type: 'dinner', label: 'Dinner · Mission Ranch', place_name: 'Mission Ranch (Clint Eastwood)', text: 'Sunset over sheep meadow, piano bar after. Carissa\'s atmospheric-bar box checked.' },
      ],
    },
    {
      day: 4, label: 'Tue Aug 4 · Sea Otters + Big Sur Day Trip', slots: [
        { key: '4-morning', type: 'morning', label: 'Morning · Elkhorn Slough kayak', place_name: 'Monterey Bay Kayaks — Moss Landing', text: '3-hr guided paddle through 100+ sea otter colony. Min age 13 ✓. 30 min from Carmel.' },
        { key: '4-afternoon', type: 'afternoon', label: 'Afternoon · Big Sur down to Bixby', place_name: 'Bixby Bridge / Point Lobos', text: 'Drive south to Bixby for the photo; Point Lobos Cypress Grove on the way back.' },
        { key: '4-evening', type: 'evening', label: 'Evening · Carmel Beach sunset', place_name: 'Carmel Beach + dinner', text: 'Dogs off-leash, cypresses, sunset. Dinner at Anton & Michel garden or Aubergine for the milestone meal.' },
      ],
    },
    {
      day: 5, label: 'Wed Aug 5 · Fly Home', slots: [
        { key: '5-morning', type: 'morning', label: 'Morning · last walk', place_name: 'Carmel Coffee Roasting Co', text: 'Last village walk, coffee, fly home from MRY or SJC.' },
      ],
    },
  ],
  sources: [
    ...COMMON_SOURCES,
    { type: 'cntraveler', title: 'Dream Inn Santa Cruz', url: 'https://www.dreaminnsantacruz.com/' },
    { type: 'afar', title: 'Capitola Venetian Court', url: 'https://www.afar.com/places/the-venetian-capitola-by-the-sea' },
    { type: 'nyt36hours', title: 'NYT — Santa Cruz', url: 'https://www.nytimes.com/2019/07/24/travel/what-to-do-in-santa-cruz-ca.html' },
  ],
};

// ───────── Hook A: Carmel Valley Ranch resort hub (RANK 3 — relaxed luxe) ─────────
const A_CVR = {
  slug: 'carmel-valley-ranch-resort-hub',
  name: 'Carmel Valley Ranch — Resort Hub',
  region: 'Carmel Valley',
  status: 'finalist',
  ranking: 3,
  composite_score: 4.35,
  scores: {
    climate_fit: 5,
    pit_accessibility: 3,
    natural_beauty: 4,
    city_aesthetic: 4,
    foodie_light: 4,
    boutique_stays: 5,
    instagrammy: 5,
  },
  operational: {
    tagline:
      'The hook is the hotel itself. 4 nights at Carmel Valley Ranch (Hyatt Unbound Collection) — lavender labyrinth, salt-water hilltop pools, hawk-handler experience, on a 500-acre vineyard ranch. Single base, fewer logistics, deepest relaxation.',
    hook_label: 'Carmel Valley Ranch (resort itself = the experience)',
    base_shape: '4 nights single base, Carmel Valley Ranch',
    why_it_lands: [
      'Carissa — vineyards + rolling hills replace lakes-and-mountains; spa, wood-clubhouse bar, immersive ranch quiet; daily wine experiences',
      'Ashi — lavender labyrinth Instagram, salt-water pools overlooking the valley, golf carts for buzzing around the property, hawk-handler falconry experience',
      'Niki — easy day trips to Pacific (Carmel village 15 min, Big Sur 45 min); no logistics hassle',
    ],
    climate: { window: 'Aug 1-5', comfort: 'mild-warm', avg_high_F: 82, avg_low_F: 55, notes: 'Carmel Valley microclimate — warmer than the coast, cooler nights. Sun reliable.' },
    cost_estimate: '~$25-35k Hyatt pts/night × 4 = 100-140k UR (recommended) OR ~$2,400-3,000 cash for 4 nights (over $500/night cap)',
    points_play: 'STRONG. Hyatt Unbound Collection brand → 1:1 UR transfer. Per the family travel doc, CVR is on the "Destination by Hyatt resorts (Gurney\'s, Carmel Valley Ranch)" dream-tier list — exact use case for the loyalty exception.',
  },
  hotel_pick: {
    name: 'Carmel Valley Ranch (Hyatt Unbound Collection)',
    summary:
      '500-acre family-friendly resort ranch in Carmel Valley. Family Garden Lodge suites (queen + bunks) or 2-bedroom suites accommodate 3. Onsite: lavender labyrinth, salt-water adult pool + family pool, organic garden, Valley Kitchen restaurant (Lucia for date night), spa, hawk handler, golf, tennis. Listed in the family travel doc\'s Hyatt dream tier.',
    source_url: 'https://www.hyatt.com/unbound-collection/en-US/sjcjc-carmel-valley-ranch',
    mention_count: 3,
    mention_sources: ['cntraveler', 'afar', 'travelandleisure'],
  },
  itinerary: [
    {
      day: 1, label: 'Sat Aug 1 · Arrive CVR', slots: [
        { key: '1-afternoon', type: 'afternoon', label: 'Afternoon · settle in', place_name: 'Carmel Valley Ranch', text: 'Fly into SJC, drive ~2 hr. Check in, hilltop pool for the rest of the day. Sunset wine on the lawn.' },
        { key: '1-evening', type: 'evening', label: 'Evening · Valley Kitchen', place_name: 'Valley Kitchen at CVR', text: 'Onsite, casual-elevated, organic-garden ingredients. Easy first night.' },
      ],
    },
    {
      day: 2, label: 'Sun Aug 2 · Ranch Day', slots: [
        { key: '2-morning', type: 'morning', label: 'Morning · lavender labyrinth + hawks', place_name: 'CVR lavender field & falconry', text: 'Walk the lavender labyrinth at golden light. Falconry experience with Sky Falconry — handle a real hawk on your glove.' },
        { key: '2-lunch', type: 'lunch', label: 'Lunch · pool', place_name: 'CVR pool bar', text: 'Salt-water adult pool overlooking the valley, lunch and lounge.' },
        { key: '2-afternoon', type: 'afternoon', label: 'Afternoon · vineyard tasting', place_name: 'Folktale Winery & Vineyards', text: '5-min from CVR, vineyard terrace tasting. Open to families on the lawn.' },
        { key: '2-evening', type: 'evening', label: 'Evening · Lucia restaurant', place_name: 'Bernardus Lodge — Lucia', text: '10 min from CVR. Tasting-menu-quality Italian, no cheese easy to handle. Carissa\'s atmospheric-restaurant slot.' },
      ],
    },
    {
      day: 3, label: 'Mon Aug 3 · Sea Otters + Monterey', slots: [
        { key: '3-morning', type: 'morning', label: 'Morning · Elkhorn Slough kayak', place_name: 'Monterey Bay Kayaks — Moss Landing', text: '3-hr guided paddle through 100+ sea otter colony. 30 min from CVR. Min age 13 ✓.' },
        { key: '3-afternoon', type: 'afternoon', label: 'Afternoon · Monterey Aquarium', place_name: 'Monterey Bay Aquarium', text: 'Kelp forest tank, sea otter feeding (2x daily). Cannery Row walk after.' },
        { key: '3-evening', type: 'evening', label: 'Evening · CVR clubhouse bar', place_name: 'CVR clubhouse', text: 'Back to the ranch, dinner at clubhouse — wood-paneled, Carissa-aligned.' },
      ],
    },
    {
      day: 4, label: 'Tue Aug 4 · Big Sur Day Trip', slots: [
        { key: '4-morning', type: 'morning', label: 'Morning · Bixby + McWay', place_name: 'Bixby Bridge / McWay Falls', text: '45 min south to Bixby for the photo. McWay Falls — 80-ft waterfall dropping straight onto the sand.' },
        { key: '4-lunch', type: 'lunch', label: 'Lunch · Big Sur Bakery', place_name: 'Big Sur Bakery', text: 'Wood-fired oven, regional standout. Back to CVR after lunch.' },
        { key: '4-afternoon', type: 'afternoon', label: 'Afternoon · Carmel village', place_name: 'Carmel-by-the-Sea', text: 'Storybook cottages, Secret Garden Passageway, galleries. 15 min from CVR.' },
        { key: '4-dinner', type: 'dinner', label: 'Dinner · Mission Ranch', place_name: 'Mission Ranch (Clint Eastwood)', text: 'Piano bar nightly — Carissa wins.' },
      ],
    },
    {
      day: 5, label: 'Wed Aug 5 · Fly Home', slots: [
        { key: '5-morning', type: 'morning', label: 'Morning · spa or pool', place_name: 'CVR spa', text: 'Last spa or pool morning. Fly home from MRY or SJC.' },
      ],
    },
  ],
  sources: [
    ...COMMON_SOURCES,
    { type: 'cntraveler', title: 'Carmel Valley Ranch overview', url: 'https://www.hyatt.com/unbound-collection/en-US/sjcjc-carmel-valley-ranch' },
    { type: 'travelandleisure', title: 'T+L — Carmel Valley Ranch feature', url: 'https://www.travelandleisure.com/' },
    { type: 'afar', title: 'AFAR — Big Sur McWay Falls', url: 'https://www.afar.com/places/julia-pfeiffer-burns-state-park-big-sur' },
  ],
};

// ───────── Hook D: Sea-otter day + Carmel single base (RANK 4 — simplest) ─────────
const D_OTTER_CARMEL = {
  slug: 'sea-otter-carmel-single-base',
  name: 'Sea Otter Hook + Carmel Single Base',
  region: 'Carmel',
  status: 'finalist',
  ranking: 4,
  composite_score: 4.2,
  scores: {
    climate_fit: 5,
    pit_accessibility: 3,
    natural_beauty: 4,
    city_aesthetic: 4,
    foodie_light: 5,
    boutique_stays: 4,
    instagrammy: 4,
  },
  operational: {
    tagline:
      'The hook is an animal encounter, not a hotel. Anchor the trip on a sunrise kayak through Elkhorn Slough\'s sea-otter colony, then settle into Carmel village for 4 nights. Fewest hotel switches, deepest Carmel food access.',
    hook_label: 'Elkhorn Slough sea-otter kayak (sunrise tour)',
    base_shape: '4 nights single base, La Playa Carmel or Cypress Inn',
    why_it_lands: [
      'Carissa — Mission Ranch + Cypress Inn Terry\'s Lounge bar nights, Point Lobos dramatic coast, Carmel Beach cypress walks',
      'Ashi — Carmel storybook cottages and Secret Garden Passageway, Monterey Aquarium otters, walkable boutiques',
      'Niki — clear blue water, sea otters, Aubergine 1-star tasting menu, oysters',
    ],
    climate: { window: 'Aug 1-5', comfort: 'mild', avg_high_F: 72, avg_low_F: 55, notes: 'Coastal Carmel — mild summer days, foggy mornings.' },
    cost_estimate: '~$1,800 for 4 nights (La Playa $450×4 or Cypress $450×4 = $1,800) — fully in cash budget',
    points_play: 'None — neither hotel is Hyatt. Pure cash, well under cap.',
  },
  hotel_pick: {
    name: 'La Playa Carmel',
    summary:
      '1905 stone mansion 4 blocks from Carmel Beach. Gardens, pool, family rooms (1-2 bedrooms). 6-min walk to sand, 5 min to all village dining + galleries. Family-friendly, breakfast included, less expensive than nearby L\'Auberge.',
    source_url: 'https://www.laplayahotel.com/',
    mention_count: 2,
    mention_sources: ['cntraveler', 'afar'],
  },
  itinerary: [
    {
      day: 1, label: 'Sat Aug 1 · Arrive Carmel', slots: [
        { key: '1-afternoon', type: 'afternoon', label: 'Afternoon · settle in', place_name: 'La Playa Carmel', text: 'Fly into SJC or MRY, drive to Carmel. Check in, beach walk, sunset on Carmel Beach with the cypresses.' },
        { key: '1-dinner', type: 'dinner', label: 'Dinner · Anton & Michel', place_name: 'Anton & Michel', text: 'Garden courtyard dining, walkable from La Playa. Carissa-friendly wine list, no cheese easy.' },
      ],
    },
    {
      day: 2, label: 'Sun Aug 2 · HERO DAY — Sea Otters', slots: [
        { key: '2-morning', type: 'morning', label: 'Morning · Elkhorn Slough kayak', place_name: 'Monterey Bay Kayaks — Moss Landing', text: 'Sunrise tour. 100+ otters resting on eelgrass beds, harbor seals, brown pelicans. 30 min drive, 3-hr paddle. Min age 13 ✓.' },
        { key: '2-lunch', type: 'lunch', label: 'Lunch · Monterey', place_name: 'Monterey Bay Aquarium / Cannery Row', text: 'Aquarium kelp forest, otter feeding at noon. Cannery Row lunch (Schooners or LouLou\'s Griddle).' },
        { key: '2-evening', type: 'evening', label: 'Evening · Carmel village', place_name: 'Cypress Inn — Terry\'s Lounge', text: 'Drinks at Terry\'s Lounge — Doris Day\'s legacy wood-paneled bar. Dinner at Aubergine (1 Michelin) or Mission Ranch piano bar.' },
      ],
    },
    {
      day: 3, label: 'Mon Aug 3 · Big Sur Day Trip', slots: [
        { key: '3-morning', type: 'morning', label: 'Morning · Bixby + McWay', place_name: 'Bixby Bridge / McWay Falls', text: 'Drive south on Hwy 1. Bixby Bridge, McWay Falls, Pfeiffer purple sand.' },
        { key: '3-lunch', type: 'lunch', label: 'Lunch · Nepenthe', place_name: 'Nepenthe', text: 'The cliff-edge view — overpriced but the view is the meal. Or Big Sur Bakery for the actual best food.' },
        { key: '3-afternoon', type: 'afternoon', label: 'Afternoon · Drive back', place_name: 'Hwy 1 north', text: 'Slow drive back. Sunset at Carmel Beach.' },
        { key: '3-dinner', type: 'dinner', label: 'Dinner · Mission Ranch', place_name: 'Mission Ranch', text: 'Sunset sheep meadow + piano bar.' },
      ],
    },
    {
      day: 4, label: 'Tue Aug 4 · Point Lobos + village', slots: [
        { key: '4-morning', type: 'morning', label: 'Morning · Point Lobos', place_name: 'Point Lobos Cypress Grove Trail', text: '0.9-mi loop through rare Monterey cypress — Ansel Adams shot here. Arrive 8am, parking fills by 10.' },
        { key: '4-afternoon', type: 'afternoon', label: 'Afternoon · Carmel village', place_name: 'Storybook cottages walk', text: 'Comstock fairy-tale houses, Secret Garden Passageway, galleries on Ocean Ave, Carmel Coffee Roasting Co.' },
        { key: '4-dinner', type: 'dinner', label: 'Dinner · Aubergine', place_name: 'Aubergine at L\'Auberge Carmel', text: 'The trip\'s milestone meal. 1 Michelin star tasting menu, $295pp — book ahead.' },
      ],
    },
    {
      day: 5, label: 'Wed Aug 5 · Fly Home', slots: [
        { key: '5-morning', type: 'morning', label: 'Morning · last walk', place_name: 'Carmel Beach', text: 'Beach walk, last coffee, fly home from MRY or SJC.' },
      ],
    },
  ],
  sources: [
    ...COMMON_SOURCES,
    { type: 'afar', title: 'AFAR — La Playa Carmel', url: 'https://www.laplayahotel.com/' },
    { type: 'nyt36hours', title: 'NYT — Carmel-by-the-Sea', url: 'https://www.nytimes.com/section/travel' },
    { type: 'cntraveler', title: 'Elkhorn Slough sea otters', url: 'https://www.montereybaykayaks.com/elkhorn-slough.html' },
  ],
};

// Compose report_md for each (drives the long-form section the renderer shows)
function composeReport(d) {
  const ops = d.operational;
  return `## The hook

**${ops.hook_label}**

${ops.tagline}

## Why this lands for Carissa + Ashi

${ops.why_it_lands.map(w => `- ${w}`).join('\n')}

## Trip shape

${ops.base_shape}

## Cost

${ops.cost_estimate}

${ops.points_play}

## Climate (Aug 1-5)

${ops.climate.notes} Average high ${ops.climate.avg_high_F}°F, low ${ops.climate.avg_low_F}°F. ${ops.climate.comfort}.
`;
}

const DESTINATIONS = [B_TREEBONES, C_SC_CARMEL, A_CVR, D_OTTER_CARMEL].map(d => ({
  ...d,
  report_md: composeReport(d),
}));

async function main() {
  // Find or create trip
  const existing = await pg(`/trips?name=eq.${encodeURIComponent(TRIP.name)}&select=id`);
  let tripId;
  if (existing?.length) {
    tripId = existing[0].id;
    process.stderr.write(`Trip exists: ${tripId}. Wiping destinations and re-inserting.\n`);
    await pg(`/trip_destinations?trip_id=eq.${tripId}`, { method: 'DELETE' });
  } else {
    const rows = await pg('/trips', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify(TRIP),
    });
    tripId = rows?.[0]?.id;
    process.stderr.write(`Created trip: ${tripId}\n`);
  }
  if (!tripId) throw new Error('Failed to create/find trip');

  for (const d of DESTINATIONS) {
    await pg('/trip_destinations', {
      method: 'POST',
      body: JSON.stringify({ trip_id: tripId, ...d }),
    });
    process.stderr.write(`  ↳ #${d.ranking}  ${d.name}  (${d.composite_score})\n`);
  }

  process.stderr.write(`\nShare URL:\n`);
  process.stdout.write(`https://webapp-rust-phi.vercel.app/?t=${tripId}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
