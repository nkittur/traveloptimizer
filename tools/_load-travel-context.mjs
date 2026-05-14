#!/usr/bin/env node
// Loads the family's travel context from ghostwheel (the canonical source).
//
// CLI usage:
//   node tools/_load-travel-context.mjs                    # default: niki, carissa, ashi
//   node tools/_load-travel-context.mjs niki carissa       # explicit travelers
//
// Importable:
//   import { loadTravelContext } from './tools/_load-travel-context.mjs';
//   const ctx = loadTravelContext({ travelers: ['niki', 'carissa', 'ashi'] });
//
// Returns:
//   {
//     family: { members: [{ name, role, age, notes }], home_airport, home_city },
//     friend_profiles: { [name]: { notes } },
//     travel_md: string,   // full preferences/travel.md
//     food_md:   string,   // full preferences/food.md
//   }
//
// Ghostwheel layout:
//   <ghostwheel>/data/people/<slug>.md       — per-person; reads YAML frontmatter (name, role, age) + body
//   <ghostwheel>/data/preferences/travel.md  — family-level travel prefs
//   <ghostwheel>/data/preferences/food.md    — family-level food prefs

import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const GHOSTWHEEL =
  process.env.GHOSTWHEEL_DIR ||
  resolve(__dirname, '../../ghostwheel');

const FAMILY_ROLES = new Set(['self', 'wife', 'husband', 'daughter', 'son', 'child', 'partner']);
const FRIEND_ROLES = new Set(['friend']);
const DEFAULT_TRAVELERS = ['niki', 'carissa', 'ashi'];

function parseFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { frontmatter: {}, body: md };
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim().replace(/^["'](.*)["']$/, '$1');
  }
  return { frontmatter: fm, body: m[2] };
}

function readPerson(slug) {
  const path = resolve(GHOSTWHEEL, 'data/people', `${slug}.md`);
  if (!existsSync(path)) return null;
  return parseFrontmatter(readFileSync(path, 'utf-8'));
}

function listPersonSlugs() {
  const dir = resolve(GHOSTWHEEL, 'data/people');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.md') && f !== '_index.md')
    .map(f => f.replace(/\.md$/, ''));
}

function readPref(name) {
  const path = resolve(GHOSTWHEEL, 'data/preferences', `${name}.md`);
  return existsSync(path) ? readFileSync(path, 'utf-8') : '';
}

export function loadTravelContext({ travelers = DEFAULT_TRAVELERS } = {}) {
  const members = [];
  const friend_profiles = {};

  for (const slug of travelers) {
    const person = readPerson(slug);
    if (!person) continue;
    const { frontmatter: fm, body } = person;
    const role = fm.role || 'unknown';
    const name = fm.name || slug;
    const member = { name, role, notes: body.trim() };
    if (fm.age) member.age = Number(fm.age);
    if (FAMILY_ROLES.has(role)) members.push(member);
    else if (FRIEND_ROLES.has(role)) friend_profiles[name] = { notes: body.trim() };
  }

  // Pull in any other friends (so scoring tools have context on people we might meet up with)
  for (const slug of listPersonSlugs()) {
    if (travelers.includes(slug)) continue;
    const person = readPerson(slug);
    if (!person) continue;
    if (FRIEND_ROLES.has(person.frontmatter.role)) {
      const name = person.frontmatter.name || slug;
      if (!friend_profiles[name]) friend_profiles[name] = { notes: person.body.trim() };
    }
  }

  return {
    family: {
      members,
      home_airport: 'PIT',
      home_city: 'Pittsburgh, PA',
    },
    friend_profiles,
    travel_md: readPref('travel'),
    food_md: readPref('food'),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const ctx = loadTravelContext(args.length ? { travelers: args } : {});
  console.log(JSON.stringify(ctx, null, 2));
}
