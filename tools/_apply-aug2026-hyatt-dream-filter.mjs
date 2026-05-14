#!/usr/bin/env node
// _apply-aug2026-hyatt-dream-filter.mjs
// Filter loyalty_perks.hyatt[] down to dream-tier only. Update hotel_picks
// where the prior pick was a "boring" Hyatt that we're now removing.

import { selectMany, pg } from './_db.mjs';

const TRIP = 'cg7pgj64';

// Dream-tier Hyatts only — empty arrays mean "we used to list a boring Hyatt; remove it."
const HYATT_OVERRIDES = {
  'newport-rhode-island': [
    { name: 'Gurney\'s Newport Resort', category: 'Destination by Hyatt (~30k pts off-peak)', est_nightly_usd: 900, status: 'points_only',
      points: '~30k pts/night', why: 'Goat Island peninsula resort with private beach, marina, spa. Dream-tier destination resort — cash rate well above family cap, but the points play turns it into a $300-equivalent stay. The kind of place that justifies a Hyatt point cleanup.' },
  ],
  'san-diego-california': [
    { name: 'Park Hyatt Aviara', category: 'Cat 7 (~30k pts off-peak, ~45k peak)', est_nightly_usd: 600, status: 'in_budget',
      points: '~30k pts off-peak', why: '40 min north in Carlsbad. Dream-tier Park Hyatt with kids program, two pools, golf, spa. Cash right at family cap; on points it\'s a luxury room for ~$300 UR-equivalent. The dream Hyatt of the trip.' },
  ],
  'quebec-city-canada': [],          // was Le Germain JdV — boring, removed
  'vancouver-tofino':    [],          // was Hyatt Regency Vancouver — boring, removed
  'lisbon-portugal':     [],          // was Hyatt Regency Lisbon — boring, removed
  'montreal-canada':     [],          // was Le Germain JdV — boring, removed
  'irvine-orange-county': [
    { name: 'Park Hyatt Aviara', category: 'Cat 7 (~30k pts off-peak)', est_nightly_usd: 600, status: 'in_budget',
      points: '~30k pts off-peak', why: '20 min south in Carlsbad. Dream-tier Park Hyatt, family-friendly. Same property as the SD pick — if you do an OC + parents-visit trip, this is the points-anchor stay.' },
  ],
};

// Hotel pick overrides — destinations where the prior pick was a now-removed boring Hyatt.
// (Or in cases where another in-budget non-Hyatt is genuinely the right call now.)
const HOTEL_OVERRIDES = {
  'irvine-orange-county': {
    name: 'Lido House, Autograph Collection',
    neighborhood: 'Newport Beach (15 min from Irvine)',
    approx_nightly_usd: 480,
    summary: 'Coastal Cape-Cod-style boutique on Lido Marina Village, walking-distance to Newport Harbor. Marriott Bonvoy, not Chase loyalty — but it\'s the right boutique-aesthetic in budget. Park Hyatt Aviara (south, on points) is the splurge alternative.',
    source_url: 'https://www.lidohousenewport.com/',
    on_edit: false, on_hyatt: false,
  },
};

const dests = await selectMany('trip_destinations', { trip_id: TRIP },
  'select=id,slug,operational,hotel_pick&status=eq.finalist');

let updated = 0;
for (const d of dests) {
  const newOp = { ...(d.operational || {}) };
  // Apply Hyatt filter: if this destination has an override, use it; otherwise leave as-is
  // (some destinations had no Hyatt to begin with — we don't touch those).
  if (HYATT_OVERRIDES[d.slug] !== undefined) {
    if (!newOp.loyalty_perks) newOp.loyalty_perks = { edit: [], hyatt: [], anchor: null, verify: '' };
    newOp.loyalty_perks = { ...newOp.loyalty_perks, hyatt: HYATT_OVERRIDES[d.slug] };

    // Re-evaluate anchor verdict if it referenced now-removed Hyatts
    if (d.slug === 'quebec-city-canada') {
      newOp.loyalty_perks.anchor = '★ STRONG. Auberge Saint-Antoine (our top pick) is on Edit and well within budget — the cleanest Edit match in the trip. (No dream-tier Hyatt in Quebec City.)';
    }
    if (d.slug === 'vancouver-tofino') {
      newOp.loyalty_perks.anchor = '★ MEDIUM. Loden in Vancouver is in budget AND on Edit. Wickaninnish in Tofino is the dream pick but exceeds the family cap. (No dream-tier Hyatt in BC.)';
    }
    if (d.slug === 'lisbon-portugal') {
      newOp.loyalty_perks.anchor = '★ STRONG. Three Edit hotels in budget — Memmo Alfama (top pick) is the cleanest match. No dream-tier Hyatt in Lisbon.';
    }
    if (d.slug === 'montreal-canada') {
      newOp.loyalty_perks.anchor = null;
      newOp.loyalty_perks.note = 'No dream-tier Edit or Hyatt in Montreal. Boutique scene is local (Hotel Nelligan, Hotel Le Crystal).';
    }
    if (d.slug === 'irvine-orange-county') {
      newOp.loyalty_perks.anchor = '★ MEDIUM. Park Hyatt Aviara is the only dream-tier Hyatt nearby and it\'s 20 min south in Carlsbad — viable but not in Irvine itself. Pendry Newport Beach (Edit) is over budget.';
    }
    if (d.slug === 'san-diego-california') {
      newOp.loyalty_perks.anchor = '★ STRONG. Park Hyatt Aviara is the dream-tier Hyatt (40 min north) — right at cap on cash, clear win on points. Pendry SD (Edit) is also in budget. Cousin Stefi cooldown still applies, but the loyalty value is real.';
    }
    if (d.slug === 'newport-rhode-island') {
      newOp.loyalty_perks.anchor = '★ MEDIUM. Hammetts Hotel (Edit) is in budget. Gurney\'s Newport Resort (Destination by Hyatt) is the dream-tier points play — only worth booking on UR points since the cash rate is well over cap.';
    }
  }
  // Hotel pick override (Irvine: was Hyatt Regency Newport Beach which is now off the list)
  let newHp = d.hotel_pick;
  if (HOTEL_OVERRIDES[d.slug]) newHp = HOTEL_OVERRIDES[d.slug];
  await pg(`/trip_destinations?id=eq.${d.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ operational: newOp, ...(newHp !== d.hotel_pick ? { hotel_pick: newHp } : {}) }),
  });
  const hyattCount = (newOp.loyalty_perks?.hyatt || []).length;
  console.log(`  ✓ ${d.slug.padEnd(28)}  Hyatt now: ${hyattCount}${HOTEL_OVERRIDES[d.slug] ? ' [hotel pick swapped]' : ''}`);
  updated++;
}
console.log(`\n✓ Updated ${updated} destinations`);
