#!/usr/bin/env node
// _apply-aug2026-loyalty-perks.mjs
// Patch operational.loyalty_perks per finalist with Chase Edit + Hyatt matches
// the family would actually consider. Hand-curated from knowledge of both
// programs as of early 2026 — every entry includes a "verify" link to confirm
// before booking since both programs evolve quickly.

import { selectMany, pg } from './_db.mjs';

const TRIP = 'cg7pgj64';

// Per-destination loyalty data. Keys:
//   edit:    [{ name, neighborhood, why }]   The Edit by Chase Travel hotels
//   hyatt:   [{ name, category, why }]        Hyatt brand hotels (UR transfers 1:1)
//   anchor:  string|null                       short text if loyalty value is strong enough to anchor a trip choice
//   verify:  string                            URL the user should check before booking
const PERKS = {
  'cortina-italy': {
    edit: [],
    hyatt: [],
    anchor: null,
    note: 'Cortina is dominated by Italian boutique mountain hotels (Cristallo, Rosapetra, Lajadira). No Edit or Hyatt presence in town. Loyalty-neutral.',
    verify: 'https://chase.com/travel/the-edit',
  },
  'newport-rhode-island': {
    edit: [
      { name: 'Hammetts Hotel', neighborhood: 'Newport waterfront', why: 'Boutique 84-room property on Newport Harbor; Edit-eligible; walkable to Bowen\'s + Bannister\'s wharves.' },
    ],
    hyatt: [
      { name: 'Gurney\'s Newport Resort', category: 'Destination by Hyatt', why: 'Goat Island peninsula resort with marina + spa. ~25-30k Hyatt pts/night off-peak.' },
    ],
    anchor: 'Decent. Hammetts via Edit gives $100 credit + breakfast — a good but not dealbreaking match.',
    verify: 'https://chase.com/travel/the-edit and https://hyatt.com',
  },
  'hamptons-newyork': {
    edit: [
      { name: 'Topping Rose House', neighborhood: 'Bridgehampton', why: '22-room Greek Revival inn with Tom Colicchio restaurant. Long-standing Edit/Tablet anchor. One of the best Edit values in the Hamptons — $100 credit + breakfast on a $1k+/night room is meaningful.' },
      { name: 'Marram Montauk', neighborhood: 'Montauk', why: 'Beach-side boutique; Edit-eligible. Lower-key alternative to The Surf Lodge.' },
    ],
    hyatt: [],
    anchor: '★ STRONG. Topping Rose House on Edit alone justifies leaning toward Hamptons. Stack with the JFK nonstop convenience and this is a "deal anchors the trip" candidate.',
    verify: 'https://chase.com/travel/the-edit',
  },
  'slovenia-bled-ljubljana': {
    edit: [],
    hyatt: [],
    anchor: null,
    note: 'Slovenia has essentially no Edit or Hyatt presence. The boutique scene is local (Vila Bled, Hotel Triglav, Hotel Cubo). Loyalty-neutral.',
    verify: 'https://chase.com/travel/the-edit',
  },
  'san-diego-california': {
    edit: [
      { name: 'Hotel Del Coronado, Curio Collection', neighborhood: 'Coronado', why: '1888 beachfront landmark, Curio (Hilton) but periodically appears on Edit lists. Family-friendly.' },
      { name: 'Pendry San Diego', neighborhood: 'Gaslamp', why: 'Edit-eligible boutique downtown.' },
    ],
    hyatt: [
      { name: 'Park Hyatt Aviara', category: 'Cat 7 (~30k pts off-peak, ~45k peak)', why: '40 min north of SD in Carlsbad. Family resort with kids program. Strong Hyatt value if Stefi can make the drive.' },
      { name: 'Andaz San Diego', category: 'Cat 4 (~15k pts off-peak)', why: 'Gaslamp, walkable, design-forward. Excellent points value.' },
      { name: 'Manchester Grand Hyatt', category: 'Cat 4', why: 'Marina view, big property, family-friendly.' },
    ],
    anchor: '★ STRONG. Multiple Park Hyatts/Andaz at very good point values + Pendry on Edit. Could justify leaning SD even at the family-cooldown demotion.',
    verify: 'https://chase.com/travel/the-edit and https://hyatt.com',
  },
  'copenhagen-denmark': {
    edit: [
      { name: 'Hotel Sanders', neighborhood: 'Indre By', why: 'Already our top pick — and it\'s Edit-eligible. $100/night credit + breakfast + the room we wanted. Big stack.' },
      { name: 'Nimb Hotel', neighborhood: 'Tivoli Gardens', why: 'Moorish-revival landmark inside Tivoli. Edit-eligible.' },
    ],
    hyatt: [],
    anchor: '★ MEDIUM-STRONG. Hotel Sanders being on Edit means the existing top pick is also a loyalty win — easy synergy.',
    verify: 'https://chase.com/travel/the-edit',
  },
  'quebec-city-canada': {
    edit: [
      { name: 'Auberge Saint-Antoine', neighborhood: 'Lower Town quay', why: 'Already our top pick — Relais & Châteaux property, Edit-eligible. River-facing, archaeology-lobby. $100/night credit + breakfast.' },
    ],
    hyatt: [
      { name: 'Le Germain Hotel Quebec', category: 'JdV by Hyatt (Cat 4)', why: 'Old Town boutique, design-forward. Excellent Hyatt-side value.' },
    ],
    anchor: '★ STRONG. Auberge Saint-Antoine on Edit + Le Germain in Hyatt JdV is a double-loyalty match for the destination.',
    verify: 'https://chase.com/travel/the-edit and https://hyatt.com',
  },
  'asturias-spain': {
    edit: [],
    hyatt: [],
    anchor: null,
    note: 'Asturias is dominated by paradores (state-run historic hotels) and small private inns — no Edit or Hyatt presence. Loyalty-neutral.',
    verify: 'https://chase.com/travel/the-edit',
  },
  'azores-portugal': {
    edit: [
      { name: 'Furnas Boutique Hotel', neighborhood: 'Furnas valley', why: 'Hot-springs-adjacent boutique; sometimes Edit-eligible.' },
    ],
    hyatt: [],
    anchor: null,
    note: 'Limited international hotel presence. Most Azores boutiques are independent (White Exclusive, Pedras do Mar).',
    verify: 'https://chase.com/travel/the-edit',
  },
  'vancouver-tofino': {
    edit: [
      { name: 'Wickaninnish Inn', neighborhood: 'Tofino, Cox Bay', why: 'Iconic Relais & Châteaux Pacific cliff lodge. Edit-eligible. $100/night credit + breakfast on already-pricey rooms is meaningful.' },
      { name: 'The Loden', neighborhood: 'Coal Harbour, Vancouver', why: 'Already our Vancouver pick. Edit-eligible.' },
    ],
    hyatt: [
      { name: 'Hyatt Regency Vancouver', category: 'Cat 4', why: 'Downtown, walkable. Decent Hyatt value but generic.' },
    ],
    anchor: '★ STRONG. Wickaninnish on Edit might bring the price into reach (was previously listed as "outside our lane" — Edit benefits change that calculus).',
    verify: 'https://chase.com/travel/the-edit',
  },
  'acadia-maine': {
    edit: [
      { name: 'Bar Harbor Inn', neighborhood: 'Bar Harbor', why: 'Historic-grand option; sometimes Edit-eligible.' },
    ],
    hyatt: [],
    anchor: null,
    note: 'Bar Harbor / Acadia is mostly small independent inns (our top pick Salt Cottages is one). No Hyatt presence on Mount Desert Island.',
    verify: 'https://chase.com/travel/the-edit',
  },
  'stockholm-sweden': {
    edit: [
      { name: 'Ett Hem', neighborhood: 'Östermalm', why: '12-room Arts-and-Crafts townhouse — one of Europe\'s most-photographed boutique hotels. Edit-eligible. The $100 credit + breakfast on a $700-1000/night room is real value.' },
    ],
    hyatt: [],
    anchor: '★ MEDIUM. Ett Hem on Edit is the headline. Our existing pick (Hotel Skeppsholmen) wasn\'t Edit; switching to Ett Hem would be a loyalty + experience upgrade.',
    verify: 'https://chase.com/travel/the-edit',
  },
  'marthas-vineyard': {
    edit: [
      { name: 'The Charlotte Inn', neighborhood: 'Edgartown', why: 'Relais & Châteaux 25-room antique-filled inn. Edit-eligible.' },
      { name: 'The Outermost Inn', neighborhood: 'Aquinnah', why: 'James Taylor\'s family inn on the cliffs. Sometimes Edit.' },
    ],
    hyatt: [],
    anchor: 'Decent — Charlotte Inn on Edit is a nice match for the destination.',
    verify: 'https://chase.com/travel/the-edit',
  },
  'costa-brava-spain': {
    edit: [
      { name: 'Mas de Torrent', neighborhood: 'Torrent (inland Empordà)', why: 'Relais & Châteaux 11th-century farmhouse-resort. Edit-eligible.' },
      { name: 'La Malcontenta', neighborhood: 'Palamós', why: 'Coastal boutique near the Empordà food region. Sometimes Edit.' },
    ],
    hyatt: [],
    anchor: '★ MEDIUM-STRONG. Mas de Torrent is a destination unto itself + on Edit.',
    verify: 'https://chase.com/travel/the-edit',
  },
  'lisbon-portugal': {
    edit: [
      { name: 'Memmo Alfama', neighborhood: 'Alfama', why: 'Already our top pick. Edit-eligible. $100 credit + breakfast on a $300/night room.' },
      { name: 'Santa Clara 1728', neighborhood: 'Graça', why: 'Pristine 6-room townhouse near São Vicente. Edit-eligible.' },
      { name: 'The Vintage House Lisbon', neighborhood: 'Avenida da Liberdade', why: 'Edit-eligible.' },
    ],
    hyatt: [
      { name: 'Hyatt Regency Lisbon', category: 'Cat 4 (~15k pts off-peak)', why: 'Belém district. Decent Hyatt value, but less central than the Alfama Edit picks.' },
    ],
    anchor: '★ STRONG. Memmo Alfama (already our top pick) on Edit + good Hyatt option = double match.',
    verify: 'https://chase.com/travel/the-edit and https://hyatt.com',
  },
  'banff-canada': {
    edit: [
      { name: 'Post Hotel & Spa', neighborhood: 'Lake Louise', why: 'Relais & Châteaux alpine lodge. Edit-eligible.' },
    ],
    hyatt: [],
    anchor: null,
    note: 'Fairmont dominates Banff (Banff Springs, Chateau Lake Louise) — those are Marriott Bonvoy. No Hyatt presence in Banff.',
    verify: 'https://chase.com/travel/the-edit',
  },
  'montreal-canada': {
    edit: [
      { name: 'Hotel Le Germain Montreal', neighborhood: 'Downtown', why: 'JdV by Hyatt; sometimes also Edit-eligible.' },
    ],
    hyatt: [
      { name: 'Hotel Le Germain Montreal', category: 'JdV by Hyatt (Cat 4)', why: 'Boutique downtown, design-forward, walkable to Plateau.' },
    ],
    anchor: 'Decent. Le Germain via Hyatt at Cat 4 is a solid points play.',
    verify: 'https://hyatt.com',
  },
  'reykjavik-iceland': {
    edit: [
      { name: 'The Reykjavík Edition', neighborhood: 'Old Harbour', why: 'Marriott\'s Edition brand — sometimes appears on Chase Travel, but not always Edit. Verify.' },
      { name: 'ION Adventure Hotel', neighborhood: 'Þingvellir lava field', why: 'Iconic mid-century-modern lodge. Edit-eligible (as Design Hotels member).' },
    ],
    hyatt: [],
    anchor: 'Decent. ION via Edit could justify a Golden Circle overnight there.',
    verify: 'https://chase.com/travel/the-edit',
  },
  'halifax-cape-breton': {
    edit: [],
    hyatt: [],
    anchor: null,
    note: 'Atlantic Canada has limited Edit/Hyatt presence. Independent inns dominate (Inverary Resort on Cape Breton, etc.).',
    verify: 'https://chase.com/travel/the-edit',
  },
  'bergen-fjords-norway': {
    edit: [],
    hyatt: [],
    anchor: null,
    note: 'Nordic boutique scene is mostly independent or local chains. No Edit/Hyatt anchors in Bergen.',
    verify: 'https://chase.com/travel/the-edit',
  },
  'irvine-orange-county': {
    edit: [
      { name: 'Pendry Newport Beach', neighborhood: 'Newport Beach', why: 'Edit-eligible boutique near the coast.' },
    ],
    hyatt: [
      { name: 'Park Hyatt Aviara', category: 'Cat 7 (~30k pts off-peak)', why: '20 min south in Carlsbad. Family resort with kids program. Strong Hyatt value.' },
      { name: 'Andaz Newport Beach', category: 'Cat 4', why: 'Lifestyle Hyatt on the coast. Solid value.' },
      { name: 'Hyatt Regency Newport Beach', category: 'Cat 3 (~12k pts)', why: 'Best pure points-value option in OC.' },
    ],
    anchor: '★ STRONG. Multiple excellent Hyatt properties at low point values + Pendry on Edit. With parents in Irvine, this is a "use the trip for Hyatt cleanup" possibility.',
    verify: 'https://hyatt.com',
  },
  'magdalen-islands-quebec': {
    edit: [],
    hyatt: [],
    anchor: null,
    note: 'Tiny independent inns only. Loyalty programs irrelevant.',
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
  const editCt = (p.edit || []).length;
  const hyattCt = (p.hyatt || []).length;
  const anchor = p.anchor?.startsWith('★') ? ' ★' : '';
  console.log(`  ✓ ${d.slug.padEnd(28)}  Edit:${editCt} Hyatt:${hyattCt}${anchor}`);
  updated++;
}
console.log(`\n✓ Updated ${updated} of ${dests.length}`);
