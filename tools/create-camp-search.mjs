#!/usr/bin/env node
// create-camp-search.mjs — Scaffold a new summer-camps search.
// Sibling of create-trip.mjs / create-group.mjs, but file-based, not Supabase.
// V1 output for `discover-summer-camps` is markdown + JSON on disk; no DB schema.
//
// Writes:
//   searches/<id>/config.json   — the query (anchors, windows, age, interests, filters)
//   searches/<id>/raw/          — empty dir for per-source raw scrape dumps
//
// Usage:
//   node tools/create-camp-search.mjs \
//     --id ashi-summer-2026 \
//     --person ashi --age 14 --rising-grade 10 \
//     --year 2026 \
//     --anchors PIT,ORD,MSN \
//     --max-drive-hours 3 \
//     --windows "2026-06-01..2026-07-10,2026-08-01..2026-08-31" \
//     --interests "creative-writing,design,coding,journalism" \
//     --format any \
//     --cost-cap 8000 \
//     --by Niki
//
// Prints the search id to stdout. Human-readable summary to stderr.

import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val == null || val.startsWith('--')) { args[key] = true; }
      else { args[key] = val; i++; }
    }
  }
  return args;
}

const args = parseArgs(process.argv);

if (args.help || !args.id) {
  console.error(`Usage: create-camp-search.mjs --id "<search-id>" [options]

Scaffolds searches/<id>/config.json + raw/ directory for a summer-camps search.

Required:
  --id              Short slug for the search (e.g. ashi-summer-2026)

Person + eligibility:
  --person          Ghostwheel slug to anchor preferences (default: ashi)
  --age             Age during the program window (default: 14)
  --rising-grade    Grade-rising in the program year (default: 10)
                    Used to filter programs that gate on "rising 11th+" etc.

Date windows:
  --year            Calendar year (default: current year + 1 if past March, else current year)
  --windows         Comma-separated YYYY-MM-DD..YYYY-MM-DD ranges; programs must
                    fit entirely inside ONE of these ranges.
                    Default: full June + early July + August of --year, excluding none.

Geo:
  --anchors         Comma-separated 3-letter anchor codes (PIT, ORD, MSN supported
                    by SOURCES.md; others = add to SOURCES.md before scoring).
                    Default: PIT,ORD,MSN
  --max-drive-hours Hard ceiling per anchor (default: 3). Programs farther than this
                    from EVERY anchor are rejected.

Preferences:
  --interests       Comma-separated topic tags (e.g. creative-writing,design,coding,
                    journalism,debate,music,art,film,business,leadership,STEM,sports).
                    Leave empty to keep search broad; the skill will ask interactively.
  --format          residential | commuter | any   (default: any)
  --cost-cap        USD cap (default: none — surface all, flag the expensive ones)

Meta:
  --by              Your name (stamped into config.json)
  --notes           Free text the skill should respect

Prints the search id to stdout.`);
  process.exit(args.help ? 0 : 1);
}

const id = String(args.id).trim().replace(/[^a-z0-9-]/gi, '-').toLowerCase();
if (!id) { console.error('--id is required and must be a slug'); process.exit(1); }

const today = new Date();
const defaultYear = today.getUTCMonth() >= 8 ? today.getUTCFullYear() + 1 : today.getUTCFullYear();
const year = args.year ? Number(args.year) : defaultYear;

const person = args.person ? String(args.person) : 'ashi';
const age = args.age ? Number(args.age) : 14;
const risingGrade = args['rising-grade'] ? Number(args['rising-grade']) : 10;

const anchors = (args.anchors ? String(args.anchors) : 'PIT,ORD,MSN')
  .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const maxDriveHours = args['max-drive-hours'] ? Number(args['max-drive-hours']) : 3;

const windows = (args.windows
  ? String(args.windows).split(',').map(s => s.trim())
  : [`${year}-06-01..${year}-07-10`, `${year}-08-01..${year}-08-31`]
).map(w => {
  const m = w.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
  if (!m) { console.error(`Bad window: "${w}". Use YYYY-MM-DD..YYYY-MM-DD`); process.exit(1); }
  return { start: m[1], end: m[2] };
});

const interests = (args.interests ? String(args.interests) : '')
  .split(',').map(s => s.trim()).filter(Boolean);
const format = (args.format ? String(args.format).toLowerCase() : 'any');
if (!['residential', 'commuter', 'any'].includes(format)) {
  console.error(`--format must be residential | commuter | any (got "${format}")`); process.exit(1);
}
const costCap = args['cost-cap'] ? Number(args['cost-cap']) : null;
const by = args.by ? String(args.by) : null;
const notes = args.notes ? String(args.notes) : null;

const searchDir = resolve(REPO_ROOT, 'searches', id);
if (existsSync(searchDir)) {
  console.error(`✗ searches/${id}/ already exists. Delete it first, or pick a new --id.`);
  process.exit(2);
}
mkdirSync(resolve(searchDir, 'raw'), { recursive: true });

const config = {
  id,
  created_at: today.toISOString(),
  created_by_name: by,
  person,
  year,
  eligibility: { age, rising_grade: risingGrade },
  anchors,
  max_drive_hours: maxDriveHours,
  available_windows: windows,
  interests,
  format,
  cost_cap_usd: costCap,
  notes,
};

writeFileSync(resolve(searchDir, 'config.json'), JSON.stringify(config, null, 2) + '\n');

process.stderr.write(`✓ Scaffolded search "${id}"\n`);
process.stderr.write(`  dir:         searches/${id}/\n`);
process.stderr.write(`  person:      ${person}  (age ${age}, rising grade ${risingGrade})\n`);
process.stderr.write(`  year:        ${year}\n`);
process.stderr.write(`  anchors:     ${anchors.join(', ')}  (≤ ${maxDriveHours}hr drive)\n`);
process.stderr.write(`  windows:     ${windows.map(w => `${w.start}..${w.end}`).join('  |  ')}\n`);
process.stderr.write(`  interests:   ${interests.length ? interests.join(', ') : '(ask interactively)'}\n`);
process.stderr.write(`  format:      ${format}\n`);
process.stderr.write(`  cost cap:    ${costCap ? `$${costCap.toLocaleString()}` : '(none)'}\n`);
process.stderr.write(`\nNext: run the discover-summer-camps skill against ${id} to populate it.\n`);

process.stdout.write(id + '\n');
