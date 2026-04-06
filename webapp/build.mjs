#!/usr/bin/env node
// build.mjs — Merge multiple source data into a single normalized restaurants.json
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(__dirname, '../trips/places/san-diego-best-restaurants.json');
const OUTPUT = resolve(__dirname, 'data/restaurants.json');

function slugify(name) {
  return name.toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeName(name) {
  return name.toLowerCase()
    .replace(/[''".]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findMatch(restaurants, name) {
  const norm = normalizeName(name);
  return restaurants.find(r => {
    const rNorm = normalizeName(r.name);
    return rNorm === norm
      || rNorm.includes(norm)
      || norm.includes(rNorm)
      || rNorm.replace(/\s/g, '') === norm.replace(/\s/g, '');
  });
}

const src = JSON.parse(readFileSync(SOURCE, 'utf-8'));
const restaurants = [];

// 1. Process discovered_places (Eater 38)
for (const p of src.discovered_places) {
  const rank = p.mentions?.[0]?.rank || null;
  restaurants.push({
    id: slugify(p.name),
    name: p.name,
    neighborhood: p.neighborhood,
    address: p.address,
    price: p.price,
    cuisine: p.cuisine,
    openFor: p.open_for || null,
    highlights: p.highlights,
    insiderTip: p.insider_tip || null,
    website: p.website,
    inTargetArea: p.in_target_area,
    notes: p.notes || null,
    sources: [{ type: 'eater', detail: 'Eater 38 Best Restaurants in San Diego', rank }],
  });
}

// 2. Cross-reference Infatuation overlaps
const infatuationSource = src.sources_scraped.find(s => s.source === 'infatuation');
if (infatuationSource?.notes) {
  const overlapNames = infatuationSource.notes
    .replace(/^.*Overlaps with Eater:\s*/, '')
    .replace(/\.\s*Unique to Infatuation:.*$/, '')
    .split(',')
    .map(s => s.trim());

  for (const name of overlapNames) {
    const match = findMatch(restaurants, name);
    if (match) {
      match.sources.push({ type: 'infatuation', detail: 'The Infatuation 25 Best Restaurants in San Diego' });
    }
  }
}

// 3. Process infatuation_unique_places
if (src.infatuation_unique_places) {
  for (const p of src.infatuation_unique_places) {
    const existing = findMatch(restaurants, p.name);
    if (existing) {
      existing.sources.push({ type: 'infatuation', detail: p.highlights });
      continue;
    }
    restaurants.push({
      id: slugify(p.name),
      name: p.name,
      neighborhood: p.neighborhood,
      address: p.address,
      price: p.price || null,
      cuisine: p.cuisine,
      openFor: null,
      highlights: p.highlights,
      insiderTip: null,
      website: null,
      inTargetArea: p.in_target_area ?? true,
      notes: p.notes || null,
      sources: [{ type: 'infatuation', detail: p.highlights }],
    });
  }
}

// 4. Process reddit_mentions
if (src.reddit_mentions) {
  const allReddit = [
    ...(src.reddit_mentions.la_jolla_specific || []),
    ...(src.reddit_mentions.sd_wide_highlights || []),
  ];
  for (const r of allReddit) {
    const match = findMatch(restaurants, r.name);
    if (match) {
      const existing = match.sources.find(s => s.type === 'reddit');
      if (!existing) {
        match.sources.push({
          type: 'reddit',
          detail: r.context,
          mentions: r.mentions || 1,
        });
      }
    } else {
      restaurants.push({
        id: slugify(r.name),
        name: r.name,
        neighborhood: null,
        address: null,
        price: null,
        cuisine: null,
        openFor: null,
        highlights: r.context,
        insiderTip: null,
        website: null,
        inTargetArea: true,
        notes: 'Reddit-only mention',
        sources: [{ type: 'reddit', detail: r.context, mentions: r.mentions || 1 }],
      });
    }
  }
}

// 5. Cross-reference CNT overlaps with existing entries
const cntOverlaps = [
  'The Fishery', 'Fort Oak', 'Animae', 'Soichi Sushi', 'Callie',
  'Cesarina', 'Kingfisher', 'Wolf in the Woods', 'Wayfarer Bread',
  'Serea', "George's at the Cove", 'Addison', 'Valle'
];
for (const name of cntOverlaps) {
  const match = findMatch(restaurants, name);
  if (match) {
    match.sources.push({ type: 'cnt', detail: "Conde Nast Traveler's 25 Best Restaurants in San Diego" });
  }
}

// 6. Process cnt_unique_places
if (src.cnt_unique_places) {
  for (const p of src.cnt_unique_places) {
    const existing = findMatch(restaurants, p.name);
    if (existing) {
      existing.sources.push({ type: 'cnt', detail: p.highlights });
      continue;
    }
    restaurants.push({
      id: slugify(p.name),
      name: p.name,
      neighborhood: p.neighborhood,
      address: p.address || null,
      price: p.price || null,
      cuisine: p.cuisine,
      openFor: null,
      highlights: p.highlights,
      insiderTip: null,
      website: null,
      inTargetArea: p.in_target_area ?? true,
      notes: p.notes || null,
      sources: [{ type: 'cnt', detail: p.highlights }],
    });
  }
}

// 7. Process eater_heatmap_places
if (src.eater_heatmap_places) {
  for (const p of src.eater_heatmap_places) {
    const existing = findMatch(restaurants, p.name);
    if (existing) {
      existing.sources.push({ type: 'eater_new', detail: p.highlights });
      continue;
    }
    restaurants.push({
      id: slugify(p.name),
      name: p.name,
      neighborhood: p.neighborhood,
      address: p.address || null,
      price: p.price || null,
      cuisine: p.cuisine,
      openFor: null,
      highlights: p.highlights,
      insiderTip: null,
      website: null,
      inTargetArea: p.in_target_area ?? true,
      notes: p.notes || null,
      sources: [{ type: 'eater_new', detail: p.highlights }],
    });
  }
}

// Deduplicate by id
const seen = new Set();
const deduped = [];
for (const r of restaurants) {
  if (seen.has(r.id)) {
    const existing = deduped.find(d => d.id === r.id);
    if (existing) {
      for (const s of r.sources) {
        if (!existing.sources.find(es => es.type === s.type)) {
          existing.sources.push(s);
        }
      }
    }
    continue;
  }
  seen.add(r.id);
  deduped.push(r);
}

// Sort: in-target-area first, then by source count desc, then by name
deduped.sort((a, b) => {
  if (a.inTargetArea !== b.inTargetArea) return a.inTargetArea ? -1 : 1;
  if (b.sources.length !== a.sources.length) return b.sources.length - a.sources.length;
  return a.name.localeCompare(b.name);
});

mkdirSync(resolve(__dirname, 'data'), { recursive: true });
writeFileSync(OUTPUT, JSON.stringify(deduped, null, 2));
console.log(`Built ${deduped.length} restaurants → ${OUTPUT}`);
console.log(`  In target area: ${deduped.filter(r => r.inTargetArea).length}`);
console.log(`  Multi-source: ${deduped.filter(r => r.sources.length > 1).length}`);
console.log(`  Sources: Eater ${deduped.filter(r => r.sources.some(s => s.type === 'eater')).length}, Infatuation ${deduped.filter(r => r.sources.some(s => s.type === 'infatuation')).length}, Reddit ${deduped.filter(r => r.sources.some(s => s.type === 'reddit')).length}, CNT ${deduped.filter(r => r.sources.some(s => s.type === 'cnt')).length}, Eater New ${deduped.filter(r => r.sources.some(s => s.type === 'eater_new')).length}`);
