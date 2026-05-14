#!/usr/bin/env node
// enrich-group-constraints.mjs — For each active row, compute `constraintEvidence`
// for every constraint declared on group.criteria.constraints[].
//
// Per-constraint evidence:
//   placesAnswer: the row's placesField value (true | false | null)
//   mentions:    list of { source, author?, rating?, text } snippets from the
//                row's highlights + googleReviews that literally mention any
//                of the constraint's keywords (case-insensitive, whole-word).
//
// The webapp detail view renders one collapsible card per constraint using this
// data. Running the tool is idempotent — it overwrites `data.constraintEvidence`.
//
// Usage: node tools/enrich-group-constraints.mjs <group-id>
import { selectOne, selectMany, upsert } from './_db.mjs';

const groupId = process.argv[2];
if (!groupId) { console.error('Usage: enrich-group-constraints.mjs <group-id>'); process.exit(1); }

const group = await selectOne('groups', { id: groupId });
if (!group) { console.error(`No group ${groupId}`); process.exit(2); }

const constraints = group?.criteria?.constraints || [];
if (!constraints.length) {
  console.log(`No constraints declared on group.criteria.constraints — nothing to do.`);
  process.exit(0);
}
console.log(`Group ${group.name} — computing evidence for ${constraints.length} constraint(s):`);
for (const c of constraints) console.log(`  · ${c.label} (places=${c.placesField || '—'}, kw=${(c.keywords||[]).length})`);

const rows = await selectMany('group_restaurants',
  { group_id: groupId, status: 'active' },
  'select=group_id,restaurant_id,data');

// Compile per-constraint keyword regex. Word boundaries prevent "outdoor"
// matching inside unrelated words; allow multi-word phrases like "al fresco".
function makeRegex(keywords) {
  const escaped = keywords.map(k => k.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // Use \b only at the ASCII boundary ends; phrases with spaces are fine.
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'gi');
}

// Extract the first sentence around the first match (or a ~140-char window).
function snippetAround(text, regex) {
  regex.lastIndex = 0;
  const m = regex.exec(text);
  if (!m) return null;
  const i = m.index;
  // Try to expand to sentence boundaries
  let start = Math.max(0, text.lastIndexOf('.', i - 1) + 1);
  let end = text.indexOf('.', i + m[0].length);
  if (end === -1) end = Math.min(text.length, i + m[0].length + 100);
  else end = Math.min(end + 1, text.length);
  // Shrink if too long
  if (end - start > 220) {
    start = Math.max(0, i - 60);
    end = Math.min(text.length, i + m[0].length + 60);
  }
  return text.slice(start, end).trim();
}

let updated = 0;
for (const row of rows) {
  const d = row.data || {};
  const evidence = {};
  for (const c of constraints) {
    const regex = makeRegex(c.keywords || []);
    const placesAnswer = c.placesField ? (d[c.placesField] ?? null) : null;
    const mentions = [];
    // 1. highlights
    if (d.highlights) {
      const snip = snippetAround(d.highlights, regex);
      if (snip) mentions.push({ source: 'highlights', text: snip });
    }
    // 2. Google reviews
    if (Array.isArray(d.googleReviews)) {
      for (const rev of d.googleReviews) {
        if (!rev?.text) continue;
        const snip = snippetAround(rev.text, regex);
        if (snip) mentions.push({
          source: 'google_review',
          author: rev.author || null,
          rating: rev.rating ?? null,
          text: snip,
        });
      }
    }
    evidence[c.key] = { label: c.label || c.key, placesField: c.placesField || null, placesAnswer, mentions };
  }
  d.constraintEvidence = evidence;
  await upsert('group_restaurants', {
    group_id: row.group_id,
    restaurant_id: row.restaurant_id,
    data: d,
  }, { onConflict: 'group_id,restaurant_id' });
  updated++;
  const summary = constraints.map(c => {
    const e = evidence[c.key];
    const flag = e.placesAnswer === true ? '✓' : e.placesAnswer === false ? '✗' : '?';
    return `${c.key}=${flag}+${e.mentions.length}m`;
  }).join(' ');
  console.log(`  ${d.name.padEnd(34)} | ${summary}`);
}
console.log(`\nUpdated ${updated} rows.`);
