#!/usr/bin/env node
// _fetch-aug2026-photos.mjs — Build a photo manifest for the August 2026 trip
// using Wikipedia REST API. For each (destination, query, bucket, slot_key),
// fetch the lead image of the Wikipedia article and emit a manifest entry.
//
// Output: writes the manifest as JSON to stdout. Pipe to mirror-trip-photos.mjs:
//   node tools/_fetch-aug2026-photos.mjs | node tools/mirror-trip-photos.mjs

const TRIP = 'cg7pgj64';

// Hand-curated per-destination queries. Each entry resolves to a Wikipedia article;
// the lead image becomes our photo. Bucket assignment + (optionally) itinerary_slot_key.
const PLAN = {
  'acadia-maine': {
    hero: [
      ['Cadillac Mountain', 'Cadillac Mountain at sunrise — Acadia National Park'],
      ['Sand Beach (Acadia National Park)', 'Sand Beach in Acadia'],
      ['Bass Harbor Head Light', 'Bass Harbor Head Lighthouse'],
      ['Jordan Pond (Maine)', 'Jordan Pond and the Bubbles'],
      ['Bar Harbor, Maine', 'Bar Harbor village'],
      ['Schoodic Peninsula', 'Schoodic Peninsula granite coast'],
    ],
    bucket: {
      'natural-beauty':  ['Acadia National Park',     'Pink granite of Acadia'],
      'city-aesthetic':  ['Bar Harbor, Maine',         'Bar Harbor harbor'],
      'foodie':          ['Lobster roll',              'Maine lobster'],
      'boutique-stay':   ['Bar Harbor Inn',            'Historic Bar Harbor lodging'],
      'climate-feel':    ['Mount Desert Island',       'Maine coastal summer'],
    },
    slots: {
      '1-morning':   ['Sand Beach (Acadia National Park)', 'Sand Beach + Thunder Hole'],
      '1-afternoon': ['Bar Harbor, Maine',                 'Main Street + Shore Path'],
      '2-morning':   ['Cadillac Mountain',                  'Cadillac Mountain sunrise'],
      '2-lunch':     ['Jordan Pond (Maine)',                'Jordan Pond House'],
      '2-evening':   ['Bass Harbor Head Light',             'Bass Harbor Head Light'],
      '3-morning':   ['Beehive Trail',                       'Beehive Trail iron rungs'],
      '3-afternoon': ['Asticou Azalea Garden',              'Asticou Garden'],
      '4-morning':   ['Schoodic Peninsula',                  'Schoodic Point granite'],
    },
  },
  'copenhagen-denmark': {
    hero: [
      ['Nyhavn',            'Nyhavn pastel townhouses'],
      ['Tivoli Gardens',    'Tivoli at lights'],
      ['Refshaleøen',       'Refshaleøen post-industrial waterfront'],
      ['Louisiana Museum of Modern Art', 'Sculpture park sloping into the Øresund'],
      ['Copenhagen Opera House',         'Copenhagen Opera reflection'],
      ['Møns Klint',        'Møns Klint chalk cliffs over Baltic'],
    ],
    bucket: {
      'natural-beauty':  ['Møns Klint',                'Chalk cliffs over Baltic'],
      'city-aesthetic':  ['Nyhavn',                    'Pastel canal townhouses'],
      'foodie':          ['Smørrebrød',                'Open-face Danish sandwich'],
      'boutique-stay':   ['Hotel Sanders',             'Hotel Sanders Copenhagen'],
      'climate-feel':    ['Copenhagen',                'Bicycle city'],
    },
    slots: {
      '1-afternoon': ['Refshaleøen',                  'Reffen Street Food Market'],
      '1-evening':   ['Tivoli Gardens',               'Tivoli at lights'],
      '2-morning':   ['Louisiana Museum of Modern Art', 'Louisiana sculpture park'],
      '2-afternoon': ['Kronborg Castle',              'Hamlet\'s Elsinore'],
      '2-evening':   ['Superkilen',                   'Superkilen red zone'],
      '3-afternoon': ['Frederiksberg Gardens',        'Frederiksberg Have'],
      '3-evening':   ['Christianshavn',               'Christianshavn canals'],
      '4-morning':   ['Møns Klint',                   'Chalk cliffs over Baltic'],
    },
  },
  'quebec-city-canada': {
    hero: [
      ['Château Frontenac',     'Château Frontenac dominating the skyline'],
      ['Quartier Petit Champlain', 'Rue du Petit-Champlain'],
      ['Place Royale (Quebec City)', 'Place Royale in Lower Town'],
      ['Montmorency Falls',     'Montmorency Falls'],
      ['Île d\'Orléans',        'Île d\'Orléans countryside'],
      ['Charlevoix',            'Charlevoix river-and-mountain landscape'],
    ],
    bucket: {
      'natural-beauty':  ['Charlevoix',                'Charlevoix biosphere'],
      'city-aesthetic':  ['Quartier Petit Champlain',  'Rue du Petit-Champlain at night'],
      'foodie':          ['Quebec cuisine',            'Quebec cuisine'],
      'boutique-stay':   ['Auberge Saint-Antoine',     'Auberge Saint-Antoine'],
      'climate-feel':    ['Old Quebec',                'Walled-city summer'],
    },
    slots: {
      '1-afternoon': ['Quartier Petit Champlain',     'Petit-Champlain + Funicular'],
      '1-evening':   ['Plains of Abraham',             'Walls + Plains of Abraham'],
      '2-morning':   ['Île d\'Orléans',                'Île d\'Orléans loop'],
      '2-afternoon': ['Montmorency Falls',             'Montmorency Falls cable car'],
      '3-afternoon': ['Parc national des Grands-Jardins', 'Mont du Lac-des-Cygnes hike'],
      '3-evening':   ['Cap-à-l\'Aigle',                'Cap-à-l\'Aigle cliff sunset'],
      '4-morning':   ['Tadoussac',                     'Tadoussac whale-watch'],
    },
  },
  'reykjavik-iceland': {
    hero: [
      ['Hallgrímskirkja',      'Hallgrímskirkja basalt church'],
      ['Reynisfjara',          'Reynisfjara black-sand beach + basalt columns'],
      ['Skógafoss',            'Skógafoss waterfall'],
      ['Jökulsárlón',          'Jökulsárlón glacier lagoon'],
      ['Þingvellir National Park', 'Þingvellir continental rift'],
      ['Kirkjufell',           'Kirkjufell mountain — Snæfellsnes'],
    ],
    bucket: {
      'natural-beauty':  ['Reynisfjara',         'Black-sand basalt beach'],
      'city-aesthetic':  ['Hallgrímskirkja',     'Reykjavík church + city'],
      'foodie':          ['Icelandic cuisine',    'Icelandic cuisine'],
      'boutique-stay':   ['Reykjavík',           'Reykjavík hotel scene'],
      'climate-feel':    ['Iceland',             'Iceland summer light'],
    },
    slots: {
      '1-morning':   ['Sky Lagoon',               'Sky Lagoon geothermal pool'],
      '1-afternoon': ['Hallgrímskirkja',          'Hallgrímskirkja + Laugavegur'],
      '1-evening':   ['Harpa Concert Hall',       'Harpa concert hall facade'],
      '2-morning':   ['Þingvellir National Park', 'Þingvellir continental rift'],
      '2-lunch':     ['Friðheimar',               'Friðheimar tomato greenhouse'],
      '2-afternoon': ['Secret Lagoon',            'Gamla Laugin Secret Lagoon'],
      '3-morning':   ['Skógafoss',                'Skógafoss + Seljalandsfoss'],
      '3-afternoon': ['Reynisfjara',              'Reynisfjara basalt + Dyrhólaey arch'],
      '4-morning':   ['Kirkjufell',               'Kirkjufell + Arnarstapi cliff'],
      '4-afternoon': ['Djúpalónssandur',          'Djúpalónssandur black-pebble beach'],
    },
  },
  'vancouver-tofino': {
    hero: [
      ['Stanley Park',                      'Stanley Park seawall + skyline'],
      ['Granville Island',                  'Granville Island Public Market'],
      ['Lynn Canyon Park',                  'Lynn Canyon suspension bridge'],
      ['Tofino',                            'Tofino Pacific surf'],
      ['Long Beach (Vancouver Island)',     'Long Beach + Cox Bay'],
      ['Pacific Rim National Park Reserve', 'Pacific Rim temperate rainforest'],
    ],
    bucket: {
      'natural-beauty':  ['Pacific Rim National Park Reserve', 'Temperate rainforest'],
      'city-aesthetic':  ['Gastown',                          'Gastown Steam Clock + cobbles'],
      'foodie':          ['Cuisine of British Columbia',      'BC seafood'],
      'boutique-stay':   ['Wickaninnish Inn',                 'Tofino cliff lodge'],
      'climate-feel':    ['Vancouver',                        'Vancouver summer harbor'],
    },
    slots: {
      '1-morning':   ['Stanley Park',                'Stanley Park seawall'],
      '1-lunch':     ['Granville Island',            'Public Market lunch'],
      '1-evening':   ['English Bay',                 'English Bay sunset'],
      '2-morning':   ['Lynn Canyon Park',            'Lynn Canyon suspension bridge'],
      '2-afternoon': ['Gastown',                     'Steam Clock + cobbles'],
      '3-morning':   ['Horseshoe Bay (West Vancouver)', 'Horseshoe Bay ferry'],
      '3-lunch':     ['MacMillan Provincial Park',   'Cathedral Grove ancient firs'],
      '3-afternoon': ['Cox Bay',                      'Cox Bay arrival'],
      '4-morning':   ['Hot Springs Cove',            'Hot Springs Cove zodiac'],
      '4-afternoon': ['Pacific Rim National Park Reserve', 'Rainforest Trail boardwalks'],
    },
  },
  'stockholm-sweden': {
    hero: [
      ['Gamla stan',          'Gamla Stan medieval old town'],
      ['Vasa Museum',         'Vasa warship raised whole'],
      ['Vaxholm',             'Vaxholm fortress + village'],
      ['Djurgården',          'Djurgården royal park'],
      ['Fotografiska',        'Fotografiska photo museum'],
      ['Stockholm archipelago', 'Stockholm archipelago islands'],
    ],
    bucket: {
      'natural-beauty':  ['Stockholm archipelago',     'Archipelago islands'],
      'city-aesthetic':  ['Gamla stan',                'Stortorget pastel facades'],
      'foodie':          ['Smörgåsbord',               'Smörgåsbord'],
      'boutique-stay':   ['Hotel Skeppsholmen',        'Hotel Skeppsholmen'],
      'climate-feel':    ['Stockholm',                 'Stockholm waterfront'],
    },
    slots: {
      '1-morning':   ['Gamla stan',                'Gamla Stan + Stortorget'],
      '1-afternoon': ['Vasa Museum',                'Vasa Museum + Rosendals'],
      '1-evening':   ['Fotografiska',               'Fotografiska rooftop'],
      '2-morning':   ['Vaxholm',                    'Vaxholm fortress + village'],
      '3-morning':   ['Hagaparken',                 'Hagaparken Echo Temple'],
      '3-afternoon': ['Södermalm',                  'Mariatorget + SoFo'],
      '3-evening':   ['Skinnarviksberget',          'Skinnarviksberget viewpoint'],
      '4-morning':   ['Skansen',                    'Skansen open-air museum'],
      '4-afternoon': ['Moderna Museet',             'Moderna Museet + Skeppsholmen'],
    },
  },
};

async function fetchWikiImage(title) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'traveloptimizer/1.0 (nkittur@andrew.cmu.edu)' } });
    if (!res.ok) return null;
    const j = await res.json();
    const img = j.originalimage?.source || j.thumbnail?.source;
    if (!img) return null;
    return {
      url: img,
      title: j.title,
      extract: (j.extract || '').slice(0, 240),
    };
  } catch {
    return null;
  }
}

const out = { trip_id: TRIP, destinations: [] };

for (const [slug, plan] of Object.entries(PLAN)) {
  const photos = [];
  let rank = 0;

  // Hero — top slot
  for (const [title, caption] of plan.hero) {
    const img = await fetchWikiImage(title);
    if (!img) { process.stderr.write(`  ! ${slug} hero "${title}" not found\n`); continue; }
    photos.push({
      source_url: img.url,
      caption,
      alt_text: img.title,
      source_name: 'Wikimedia Commons',
      attribution: `Wikimedia Commons / ${img.title}`,
      bucket: 'hero',
      rank: rank++,
    });
    process.stderr.write(`  ✓ ${slug} hero ${title}\n`);
    await new Promise(r => setTimeout(r, 60));
  }

  // Per-bucket scorecard photo
  for (const [bucket, [title, caption]] of Object.entries(plan.bucket)) {
    const img = await fetchWikiImage(title);
    if (!img) { process.stderr.write(`  ! ${slug} ${bucket} "${title}" not found\n`); continue; }
    photos.push({
      source_url: img.url,
      caption,
      alt_text: img.title,
      source_name: 'Wikimedia Commons',
      attribution: `Wikimedia Commons / ${img.title}`,
      bucket,
      rank: 0,
    });
    process.stderr.write(`  ✓ ${slug} bucket=${bucket} ${title}\n`);
    await new Promise(r => setTimeout(r, 60));
  }

  // Per-slot itinerary photo
  for (const [slotKey, [title, caption]] of Object.entries(plan.slots)) {
    const img = await fetchWikiImage(title);
    if (!img) { process.stderr.write(`  ! ${slug} slot=${slotKey} "${title}" not found\n`); continue; }
    photos.push({
      source_url: img.url,
      caption,
      alt_text: img.title,
      source_name: 'Wikimedia Commons',
      attribution: `Wikimedia Commons / ${img.title}`,
      bucket: 'itinerary-slot',
      itinerary_slot_key: slotKey,
      place_mentions: [title],
      rank: 0,
    });
    process.stderr.write(`  ✓ ${slug} slot=${slotKey} ${title}\n`);
    await new Promise(r => setTimeout(r, 60));
  }

  out.destinations.push({ slug, photos });
}

console.log(JSON.stringify(out, null, 2));
