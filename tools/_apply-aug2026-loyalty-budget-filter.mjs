#!/usr/bin/env node
// _apply-aug2026-loyalty-budget-filter.mjs
// Re-apply loyalty perks but with the family's $500-600/night cap honored.
// Each hotel now has est_nightly_usd; status is one of:
//   'in_budget'           — paid rate ≤ $600/night, recommend as-is
//   'edit_brings_in'      — paid rate ~$600-800, Edit credit/discount may bring under
//   'points_only'         — paid rate well over budget, but Hyatt points play works
//   'over_budget'         — excluded
// Renderer filters out_of_budget entries unless points_only path applies.

import { selectMany, pg } from './_db.mjs';

const TRIP = 'cg7pgj64';

// Per-destination loyalty data with budget filtering applied.
// Notes capture rough Aug 2026 nightly rates.
const PERKS = {
  'cortina-italy': {
    edit: [], hyatt: [],
    anchor: null,
    note: 'Cortina dominated by Italian boutique mountain hotels; most fit budget but no Edit/Hyatt presence. Loyalty-neutral.',
    verify: 'https://chase.com/travel/the-edit',
  },
  'newport-rhode-island': {
    edit: [
      { name: 'Hammetts Hotel', neighborhood: 'Newport waterfront', est_nightly_usd: 480, status: 'in_budget',
        why: 'Boutique 84-room property on Newport Harbor; Edit-eligible; walkable to Bowen\'s + Bannister\'s wharves.' },
    ],
    hyatt: [
      { name: 'Gurney\'s Newport Resort', category: 'Destination by Hyatt', est_nightly_usd: 900, status: 'points_only',
        points: '~30k Hyatt pts/night off-peak', why: 'Goat Island peninsula resort. Cash rate above family cap; Hyatt-points play (~$450 UR-equivalent) is the only sane way in.' },
    ],
    anchor: 'Decent. Hammetts is in budget; Gurney\'s only on points.',
    verify: 'https://chase.com/travel/the-edit and https://hyatt.com',
  },
  'hamptons-newyork': {
    edit: [
      { name: 'Topping Rose House', neighborhood: 'Bridgehampton', est_nightly_usd: 1800, status: 'over_budget',
        why: 'Tom Colicchio restaurant + 22 rooms. Edit credit ($100/stay) doesn\'t close the gap on a $1800/night room. EXCLUDED.' },
      { name: 'Marram Montauk', neighborhood: 'Montauk', est_nightly_usd: 950, status: 'over_budget',
        why: 'Beach-side boutique; Edit credit can\'t bring this into the $600 cap. EXCLUDED.' },
    ],
    hyatt: [],
    anchor: '⚠ Loyalty hotels exceed budget cap. Hamptons stays would need to be smaller, non-loyalty inns (Greenport, Shelter Island B&Bs).',
    verify: 'https://chase.com/travel/the-edit',
  },
  'slovenia-bled-ljubljana': {
    edit: [], hyatt: [],
    anchor: null,
    note: 'No Edit or Hyatt presence. Local boutiques (Vila Bled, Hotel Cubo) typically run $250-450/night — well within budget without loyalty needed.',
    verify: 'https://chase.com/travel/the-edit',
  },
  'san-diego-california': {
    edit: [
      { name: 'Pendry San Diego', neighborhood: 'Gaslamp', est_nightly_usd: 580, status: 'in_budget',
        why: 'Edit-eligible boutique; Edit credit + breakfast brings effective ~$540/night. Right at the cap.' },
      { name: 'Hotel Del Coronado, Curio', neighborhood: 'Coronado', est_nightly_usd: 850, status: 'over_budget',
        why: 'Iconic but $850/night summer; Edit credit insufficient. EXCLUDED.' },
    ],
    hyatt: [
      { name: 'Andaz San Diego', category: 'Cat 4 (~15k pts off-peak)', est_nightly_usd: 380, status: 'in_budget',
        why: 'Gaslamp, design-forward. Cash within budget; points play even better at ~$225 UR-equiv.' },
      { name: 'Manchester Grand Hyatt', category: 'Cat 4', est_nightly_usd: 350, status: 'in_budget',
        why: 'Marina view, family-friendly. ✓' },
      { name: 'Park Hyatt Aviara', category: 'Cat 7 (~30k pts off-peak)', est_nightly_usd: 600, status: 'in_budget',
        why: '40 min north in Carlsbad. Right at cap on cash; clear win on points (~$450 UR-equiv).' },
    ],
    anchor: '★ STRONG. Pendry just-in-budget on Edit, three solid Hyatts (two Cat 4 well under cap, Park Hyatt Aviara good on points). Loyalty value remains real even after budget filter.',
    verify: 'https://chase.com/travel/the-edit and https://hyatt.com',
  },
  'copenhagen-denmark': {
    edit: [
      { name: 'Hotel Sanders', neighborhood: 'Indre By', est_nightly_usd: 470, status: 'in_budget',
        why: 'Already our top pick. Edit credit + breakfast on a $470/night room — pure win.' },
      { name: 'Nimb Hotel', neighborhood: 'Tivoli Gardens', est_nightly_usd: 950, status: 'over_budget',
        why: 'Moorish-revival landmark inside Tivoli. Above cap; Edit credit insufficient. EXCLUDED.' },
    ],
    hyatt: [],
    anchor: '★ Hotel Sanders within budget AND on Edit — clean win.',
    verify: 'https://chase.com/travel/the-edit',
  },
  'quebec-city-canada': {
    edit: [
      { name: 'Auberge Saint-Antoine', neighborhood: 'Lower Town quay', est_nightly_usd: 350, status: 'in_budget',
        why: 'Already our top pick. Relais & Châteaux + Edit-eligible. $350/night CAD-rate well under cap.' },
    ],
    hyatt: [
      { name: 'Hotel Le Germain Quebec', category: 'JdV by Hyatt (Cat 4)', est_nightly_usd: 280, status: 'in_budget',
        why: 'Old Town boutique, design-forward. Both cash and points work.' },
    ],
    anchor: '★ STRONG. Both hotels well within budget AND in loyalty programs. Cleanest match in the trip.',
    verify: 'https://chase.com/travel/the-edit and https://hyatt.com',
  },
  'asturias-spain': {
    edit: [], hyatt: [],
    anchor: null,
    note: 'No Edit or Hyatt presence. Paradores + small inns dominate; most run $150-350/night, well within budget.',
    verify: 'https://chase.com/travel/the-edit',
  },
  'azores-portugal': {
    edit: [
      { name: 'Furnas Boutique Hotel', neighborhood: 'Furnas valley', est_nightly_usd: 280, status: 'in_budget',
        why: 'Hot-springs-adjacent boutique; sometimes Edit-eligible. ✓' },
    ],
    hyatt: [],
    anchor: 'Light. Furnas is in budget if Edit-eligible — a small bonus.',
    verify: 'https://chase.com/travel/the-edit',
  },
  'vancouver-tofino': {
    edit: [
      { name: 'The Loden', neighborhood: 'Coal Harbour, Vancouver', est_nightly_usd: 420, status: 'in_budget',
        why: 'Already our Vancouver pick. Edit credit a clean bonus on the $420 rate.' },
      { name: 'Wickaninnish Inn', neighborhood: 'Tofino, Cox Bay', est_nightly_usd: 1400, status: 'over_budget',
        why: 'Iconic but $1400+/night peak summer. Edit credit ($100/stay) doesn\'t close the gap. EXCLUDED.' },
    ],
    hyatt: [
      { name: 'Hyatt Regency Vancouver', category: 'Cat 4 (~15k pts)', est_nightly_usd: 290, status: 'in_budget',
        why: 'Downtown, walkable. Cash and points both work.' },
    ],
    anchor: '★ MEDIUM. Loden + Hyatt Regency both in budget; Wickaninnish is the dream-but-too-pricey downgrade vs. Long Beach Lodge ($400) which isn\'t on Edit but fits the family profile.',
    verify: 'https://chase.com/travel/the-edit',
  },
  'acadia-maine': {
    edit: [
      { name: 'Bar Harbor Inn', neighborhood: 'Bar Harbor', est_nightly_usd: 420, status: 'in_budget',
        why: 'Historic-grand option; sometimes Edit-eligible. Within budget either way.' },
    ],
    hyatt: [],
    anchor: 'Light. Bar Harbor Inn fits budget; our existing pick (Salt Cottages, ~$380) isn\'t loyalty-eligible but already cheaper.',
    verify: 'https://chase.com/travel/the-edit',
  },
  'stockholm-sweden': {
    edit: [
      { name: 'Ett Hem', neighborhood: 'Östermalm', est_nightly_usd: 950, status: 'over_budget',
        why: 'Iconic 12-room boutique but $950/night. Edit credit insufficient. EXCLUDED — keep our Hotel Skeppsholmen pick instead ($410, no loyalty).' },
    ],
    hyatt: [],
    anchor: '⚠ Ett Hem is the legendary Edit hotel here but exceeds budget. Hotel Skeppsholmen (our existing pick) is the practical choice and still within budget.',
    verify: 'https://chase.com/travel/the-edit',
  },
  'marthas-vineyard': {
    edit: [
      { name: 'The Charlotte Inn', neighborhood: 'Edgartown', est_nightly_usd: 750, status: 'over_budget',
        why: 'Relais & Châteaux, antique-filled. Above cap; Edit credit insufficient. EXCLUDED.' },
      { name: 'The Outermost Inn', neighborhood: 'Aquinnah', est_nightly_usd: 950, status: 'over_budget',
        why: 'Cliff-top, James Taylor family inn. EXCLUDED.' },
    ],
    hyatt: [],
    anchor: '⚠ Both Edit hotels exceed budget. MV stays would need a non-loyalty inn (Edgartown Inn ~$400, Kelley House ~$500).',
    verify: 'https://chase.com/travel/the-edit',
  },
  'costa-brava-spain': {
    edit: [
      { name: 'Mas de Torrent', neighborhood: 'Torrent (inland Empordà)', est_nightly_usd: 550, status: 'in_budget',
        why: 'Relais & Châteaux 11th-century farmhouse. At the upper end of budget; Edit credit makes it comfortably in.' },
      { name: 'La Malcontenta', neighborhood: 'Palamós', est_nightly_usd: 380, status: 'in_budget',
        why: 'Coastal boutique. Well within budget. ✓' },
    ],
    hyatt: [],
    anchor: '★ MEDIUM. Both Edit options within budget — Mas de Torrent is the destination-unto-itself pick.',
    verify: 'https://chase.com/travel/the-edit',
  },
  'lisbon-portugal': {
    edit: [
      { name: 'Memmo Alfama', neighborhood: 'Alfama', est_nightly_usd: 320, status: 'in_budget',
        why: 'Already our top pick. Edit credit pure bonus on $320/night. ✓' },
      { name: 'Santa Clara 1728', neighborhood: 'Graça', est_nightly_usd: 480, status: 'in_budget',
        why: '6-room townhouse. Within budget; Edit credit pure bonus.' },
      { name: 'The Vintage House Lisbon', neighborhood: 'Avenida da Liberdade', est_nightly_usd: 380, status: 'in_budget',
        why: 'Edit-eligible. ✓' },
    ],
    hyatt: [
      { name: 'Hyatt Regency Lisbon', category: 'Cat 4 (~15k pts off-peak)', est_nightly_usd: 250, status: 'in_budget',
        why: 'Belém district, less central than the Edit picks but excellent points value.' },
    ],
    anchor: '★ STRONG. All four loyalty hotels well within budget — Memmo (top pick) is Edit + cheap. Cleanest loyalty match in the trip.',
    verify: 'https://chase.com/travel/the-edit and https://hyatt.com',
  },
  'banff-canada': {
    edit: [
      { name: 'Post Hotel & Spa', neighborhood: 'Lake Louise', est_nightly_usd: 650, status: 'edit_brings_in',
        why: 'Relais & Châteaux alpine lodge. Just above cap on cash but Edit credit may bring under for a 5-7 night stay.' },
    ],
    hyatt: [],
    anchor: 'Light. Post is borderline on budget; Banff stays mostly Fairmont (Marriott) which we don\'t prioritize.',
    verify: 'https://chase.com/travel/the-edit',
  },
  'montreal-canada': {
    edit: [],
    hyatt: [
      { name: 'Hotel Le Germain Montreal', category: 'JdV by Hyatt (Cat 4)', est_nightly_usd: 240, status: 'in_budget',
        why: 'Boutique downtown, design-forward, walkable to Plateau. Cash and points both work.' },
    ],
    anchor: 'Decent. Le Germain on Hyatt JdV at Cat 4 is a solid points play.',
    verify: 'https://hyatt.com',
  },
  'reykjavik-iceland': {
    edit: [
      { name: 'ION Adventure Hotel', neighborhood: 'Þingvellir lava field', est_nightly_usd: 580, status: 'in_budget',
        why: 'Iconic mid-century-modern lodge — at the upper end but in budget. Could justify a Golden Circle overnight there.' },
      { name: 'The Reykjavík Edition', neighborhood: 'Old Harbour', est_nightly_usd: 850, status: 'over_budget',
        why: 'Marriott Edition. Above cap. EXCLUDED.' },
    ],
    hyatt: [],
    anchor: 'Light. ION at $580 is the only loyalty option in budget; could use for one night of the trip.',
    verify: 'https://chase.com/travel/the-edit',
  },
  'halifax-cape-breton': {
    edit: [], hyatt: [],
    anchor: null,
    note: 'No loyalty presence. Independent inns dominate at $200-400/night.',
    verify: 'https://chase.com/travel/the-edit',
  },
  'bergen-fjords-norway': {
    edit: [], hyatt: [],
    anchor: null,
    note: 'Nordic boutiques mostly independent. Most fit budget but no loyalty stack.',
    verify: 'https://chase.com/travel/the-edit',
  },
  'irvine-orange-county': {
    edit: [
      { name: 'Pendry Newport Beach', neighborhood: 'Newport Beach', est_nightly_usd: 850, status: 'over_budget',
        why: 'Above cap on cash. Edit credit insufficient. EXCLUDED.' },
    ],
    hyatt: [
      { name: 'Hyatt Regency Newport Beach', category: 'Cat 3 (~12k pts)', est_nightly_usd: 280, status: 'in_budget',
        why: 'Best pure points-value option in OC. Cash within budget.' },
      { name: 'Andaz Newport Beach', category: 'Cat 4 (~15k pts)', est_nightly_usd: 380, status: 'in_budget',
        why: 'Lifestyle Hyatt on the coast. Solid value either way.' },
      { name: 'Park Hyatt Aviara', category: 'Cat 7 (~30k pts off-peak)', est_nightly_usd: 600, status: 'in_budget',
        why: '20 min south in Carlsbad. Right at cap on cash; clear win on points.' },
    ],
    anchor: '★ STRONG. Three Hyatts, all in budget on cash AND great on points. Best Hyatt cluster in the trip even after budget filter. With parents in Irvine, this is a "use the trip for Hyatt cleanup" play.',
    verify: 'https://hyatt.com',
  },
  'magdalen-islands-quebec': {
    edit: [], hyatt: [],
    anchor: null,
    note: 'Tiny independent inns only. Loyalty programs irrelevant. (Trip already flagged as 2-stop unviable.)',
    verify: '',
  },
};

const dests = await selectMany('trip_destinations', { trip_id: TRIP },
  'select=id,slug,operational&status=eq.finalist');

let updated = 0;
for (const d of dests) {
  const p = PERKS[d.slug];
  if (!p) { console.error(`! ${d.slug}: no entry`); continue; }
  const newOp = { ...(d.operational || {}), loyalty_perks: p };
  await pg(`/trip_destinations?id=eq.${d.id}`, {
    method: 'PATCH', body: JSON.stringify({ operational: newOp }),
  });
  const inBudget = (h) => h.status === 'in_budget' || h.status === 'edit_brings_in' || h.status === 'points_only';
  const editIn = (p.edit || []).filter(inBudget).length;
  const editOut = (p.edit || []).length - editIn;
  const hyattIn = (p.hyatt || []).filter(inBudget).length;
  const hyattOut = (p.hyatt || []).length - hyattIn;
  const anchor = p.anchor?.startsWith('★') ? ' ★' : (p.anchor?.startsWith('⚠') ? ' ⚠' : '');
  console.log(`  ✓ ${d.slug.padEnd(28)}  Edit: ${editIn} in/${editOut} out · Hyatt: ${hyattIn} in/${hyattOut} out${anchor}`);
  updated++;
}
console.log(`\n✓ Updated ${updated} of ${dests.length}`);
