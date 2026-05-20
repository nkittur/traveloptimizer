#!/usr/bin/env node
// upsert-itinerary.mjs — Operator-side CLI: create or update an itineraries row.
// The webapp's `?i=<token>` view reads from this table and renders the brief_md
// markdown as a mobile-friendly long-form trip page.
//
// Usage (create):
//   node tools/upsert-itinerary.mjs \
//     --md trips/california-mammoth-aug2026.md \
//     --name "California — Mammoth Aug 2026" \
//     --start 2026-08-01 --end 2026-08-06 \
//     --travelers niki,carissa,ashi \
//     --origin PIT \
//     --by Niki
//
// Usage (update existing):
//   node tools/upsert-itinerary.mjs --md trips/california-mammoth-aug2026.md --update <token>
//
// Prints the share URL to stdout (token + URL), everything else to stderr so
// the URL can be piped.
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { pg } from './_db.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--public') { args.public = true; continue; }
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

if (args.help || !args.md || (!args.name && !args.update)) {
  console.error(`Usage: upsert-itinerary.mjs --md <path.md> --name "<title>" [opts]

Required:
  --md         Path to the markdown brief file (will be stored verbatim)
  --name       Display title (required for create; optional on update)

Optional:
  --start      Start date (YYYY-MM-DD)
  --end        End date (YYYY-MM-DD)
  --travelers  Comma-separated ghostwheel slugs (e.g. "niki,carissa,ashi")
  --origin     Origin airport IATA code
  --by         Your name (stamped as created_by_name)
  --public     Flag is_public = true
  --update     Existing itinerary token to update in place

Prints the share URL (token + full URL) to stdout.`);
  process.exit(args.help ? 0 : 1);
}

const mdPath = resolve(process.cwd(), String(args.md));
const briefMd = readFileSync(mdPath, 'utf-8');
if (!briefMd.trim()) {
  console.error(`Markdown file ${mdPath} is empty.`);
  process.exit(2);
}

const travelerSlugs = args.travelers
  ? String(args.travelers).split(',').map(s => s.trim()).filter(Boolean)
  : null;

const startDate = args.start ? String(args.start) : null;
const endDate = args.end ? String(args.end) : null;
let durationDays = null;
if (startDate && endDate) {
  const ms = new Date(endDate) - new Date(startDate);
  if (!Number.isNaN(ms)) durationDays = Math.round(ms / 86400000) + 1;
}

const payload = {
  brief_md: briefMd,
  ...(args.name ? { name: String(args.name) } : {}),
  ...(startDate ? { dates_start: startDate } : {}),
  ...(endDate ? { dates_end: endDate } : {}),
  ...(durationDays != null ? { duration_days: durationDays } : {}),
  ...(args.origin ? { origin_airport: String(args.origin) } : {}),
  ...(travelerSlugs ? { traveler_slugs: travelerSlugs } : {}),
  ...(args.by ? { created_by_name: String(args.by) } : {}),
  ...(args.public ? { is_public: true } : {}),
};

let row;
if (args.update) {
  const token = String(args.update);
  const rows = await pg(`/itineraries?id=eq.${encodeURIComponent(token)}`, {
    method: 'PATCH',
    headers: { 'Prefer': 'return=representation' },
    body: JSON.stringify(payload),
  });
  row = rows?.[0];
  if (!row?.id) {
    console.error(`No itinerary with id=${token} (or update returned no row).`);
    process.exit(3);
  }
  process.stderr.write(`✓ Updated itinerary "${row.name}" (${row.id})\n`);
} else {
  const rows = await pg('/itineraries', {
    method: 'POST',
    headers: { 'Prefer': 'return=representation' },
    body: JSON.stringify(payload),
  });
  row = rows?.[0];
  if (!row?.id) {
    console.error('Insert succeeded but no row returned. Check Supabase.');
    process.exit(2);
  }
  process.stderr.write(`✓ Created itinerary "${row.name}" (${row.id})\n`);
}

const url = `https://webapp-rust-phi.vercel.app/?i=${row.id}`;
process.stderr.write(`  dates:     ${row.dates_start || '—'} → ${row.dates_end || '—'} (${row.duration_days || '?'} days)\n`);
process.stderr.write(`  travelers: ${(row.traveler_slugs || []).join(', ') || '—'}\n`);
process.stderr.write(`  public:    ${row.is_public}\n`);
process.stderr.write(`  brief:     ${briefMd.length} chars\n`);
process.stderr.write(`\nShare URL:\n`);
process.stdout.write(`${url}\n`);
