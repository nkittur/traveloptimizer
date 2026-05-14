#!/usr/bin/env node
// _apply-aug2026-hotel-picks.mjs
// Override hotel_pick on each finalist with an in-budget pick (≤$600/night) and
// approx_nightly_usd populated. Replaces some auto-picks from the recomposer
// that were wrong (e.g., "Orient" picked as a Hamptons hotel — Orient is a town,
// not a hotel) or over budget (Fairmont Pacific Rim ~$700).

import { selectMany, pg } from './_db.mjs';

const TRIP = 'cg7pgj64';

// All under the family's $500-600/night cap. neighborhood + summary + source_url.
// On-Edit / on-Hyatt where applicable (cross-references operational.loyalty_perks).
const PICKS = {
  'cortina-italy': {
    name: 'Hotel de la Poste',
    neighborhood: 'Cortina town center',
    approx_nightly_usd: 450,
    summary: '1804 historic hotel right on Corso Italia. Family-run, antique-filled rooms, the famed Bar del Posta. Walk to gondolas. Books out fast — reserve months ahead.',
    source_url: 'https://delaposte.it/',
    on_edit: false, on_hyatt: false,
  },
  'newport-rhode-island': {
    name: 'Hammetts Hotel',
    neighborhood: 'Newport waterfront',
    approx_nightly_usd: 480,
    summary: '84-room boutique on Newport Harbor with marina views. Walk to Bowen\'s Wharf, the Cliff Walk trailhead, and the Sailing Museum. Edit-eligible — $100/stay credit + breakfast.',
    source_url: 'https://www.hammettshotel.com/',
    on_edit: true, on_hyatt: false,
  },
  'hamptons-newyork': {
    name: 'Greenporter Hotel',
    neighborhood: 'Greenport (North Fork)',
    approx_nightly_usd: 350,
    summary: 'Mid-century-modern motel-turned-boutique in Greenport — North Fork base. Far quieter than the South Fork crowd, walking-distance to Greenport waterfront, ferry to Shelter Island. The Hamptons Edit hotels (Topping Rose, Marram Montauk) are above the family $600/night cap.',
    source_url: 'https://thegreenporter.com/',
    on_edit: false, on_hyatt: false,
  },
  'slovenia-bled-ljubljana': {
    name: 'Vila Bled',
    neighborhood: 'Lake Bled',
    approx_nightly_usd: 280,
    summary: 'Tito\'s former summer residence on Lake Bled — 30 rooms, lakefront lawns, Yugoslav-era grand atmosphere. For a Ljubljana split, pair with Hotel Cubo (~$200) downtown.',
    source_url: 'https://www.vila-bled.com/',
    on_edit: false, on_hyatt: false,
  },
  'copenhagen-denmark': {
    name: 'Hotel Sanders',
    neighborhood: 'Indre By (Old Town)',
    approx_nightly_usd: 470,
    summary: '54 rooms behind the Royal Danish Theatre, designed by ex-ballet dancer Alexander Kølpin. Green velvet, brass, courtyard breakfast. Walk to Nyhavn. Edit-eligible — $100/stay credit + breakfast on top of an already-fitting rate.',
    source_url: 'https://hotelsanders.com/',
    on_edit: true, on_hyatt: false,
  },
  'quebec-city-canada': {
    name: 'Auberge Saint-Antoine',
    neighborhood: 'Lower Town quay',
    approx_nightly_usd: 350,
    summary: '96 rooms in a converted 18th-century maritime warehouse on the St. Lawrence quay. Glass-floored archaeology in the lobby. River-facing rooms with private balconies. Chez Muffy on the food list. Edit-eligible.',
    source_url: 'https://saint-antoine.com/',
    on_edit: true, on_hyatt: false,
  },
  'asturias-spain': {
    name: 'Parador de Cangas de Onís',
    neighborhood: 'Cangas de Onís (gateway to Picos de Europa)',
    approx_nightly_usd: 220,
    summary: '12th-century monastery on the Sella river. State-run parador with gardens, vaulted breakfast room, and Picos de Europa hiking from the door. Pair with a coastal night at the Parador de Gijón or a small Llanes inn.',
    source_url: 'https://www.parador.es/en/paradores/parador-de-cangas-de-onis',
    on_edit: false, on_hyatt: false,
  },
  'azores-portugal': {
    name: 'Furnas Boutique Hotel',
    neighborhood: 'Furnas valley, São Miguel',
    approx_nightly_usd: 280,
    summary: 'Geothermal hot-springs town on São Miguel. The hotel\'s thermal pools tap directly into the volcanic spring. Great-room breakfast, walk to the Furnas Lake cooking pits. Edit-eligible at this rate.',
    source_url: 'https://www.furnasboutiquehotel.com/',
    on_edit: true, on_hyatt: false,
  },
  'vancouver-tofino': {
    name: 'The Loden Hotel (Vancouver) + Long Beach Lodge (Tofino)',
    neighborhood: 'Coal Harbour + Cox Bay',
    approx_nightly_usd: 420,
    summary: 'Loden: 77 rooms downtown Vancouver, walk to Stanley Park, contemporary-classic, Edit-eligible. Long Beach Lodge: log-and-stone Pacific lodge directly on Cox Bay, no Wickaninnish-tier price tag (~$400). Split the trip 3-and-3. Wickaninnish is the dream pick but exceeds the family $600/night cap.',
    source_url: 'https://www.theloden.com/',
    on_edit: true, on_hyatt: false,
  },
  'acadia-maine': {
    name: 'The Salt Cottages',
    neighborhood: 'Bar Harbor',
    approx_nightly_usd: 380,
    summary: 'Twelve restored 1920s shingled cottages in sea-foam and butter-yellow. Outdoor showers, private decks, walk to the village. Cottages sleep 3–5; the family fits in one. Books out by April for August.',
    source_url: 'https://www.thesaltcottages.com/',
    on_edit: false, on_hyatt: false,
  },
  'stockholm-sweden': {
    name: 'Hotel Skeppsholmen',
    neighborhood: 'Skeppsholmen island (walk to Gamla Stan)',
    approx_nightly_usd: 410,
    summary: '1699 naval barracks converted into 81 rooms on its own car-free island. Harbor-facing rooms, walk-to-Gamla-Stan, the Moderna Museet next door. Ett Hem is the legendary Edit pick but at ~$950/night exceeds the family cap.',
    source_url: 'https://www.hotelskeppsholmen.com/',
    on_edit: false, on_hyatt: false,
  },
  'marthas-vineyard': {
    name: 'Edgartown Inn',
    neighborhood: 'Edgartown',
    approx_nightly_usd: 400,
    summary: '1798 sea-captain\'s house, 16 rooms, walking-distance to Edgartown harbor and the Vineyard\'s most photogenic streets. The Charlotte Inn (Edit) is the dream-grade upgrade but at $750+ exceeds the family cap.',
    source_url: 'https://www.edgartowninn.com/',
    on_edit: false, on_hyatt: false,
  },
  'costa-brava-spain': {
    name: 'La Malcontenta',
    neighborhood: 'Palamós',
    approx_nightly_usd: 380,
    summary: 'Coastal boutique near the Empordà food region (El Celler de Can Roca, Compartir, Disfrutar alums). Within budget AND Edit-eligible. Mas de Torrent (Edit) is the splurge alternative at ~$550 — also fits the family cap.',
    source_url: 'https://www.lamalcontentahotel.com/',
    on_edit: true, on_hyatt: false,
  },
  'magdalen-islands-quebec': {
    name: 'Hôtel Château Madelinot',
    neighborhood: 'Cap-aux-Meules (main island)',
    approx_nightly_usd: 220,
    summary: '120 rooms on the main Magdalen island. Family-run, walk to fishing harbor. Trip overall flagged as 2-stop unviable per family rule — included for reference only.',
    source_url: 'https://www.hotelsaccents.com/en/hotels/chateau-madelinot/',
    on_edit: false, on_hyatt: false,
  },
  'san-diego-california': {
    name: 'Andaz San Diego',
    neighborhood: 'Gaslamp Quarter',
    approx_nightly_usd: 380,
    summary: '159-room Hyatt Andaz in the heart of Gaslamp. Rooftop pool with Coronado view. Hyatt Cat 4 at ~15k pts/night off-peak — excellent points play with Chase UR. Hotel Del Coronado is iconic but $850+/night exceeds the family cap.',
    source_url: 'https://www.hyatt.com/en-US/hotel/california/andaz-san-diego',
    on_edit: false, on_hyatt: true,
  },
  'lisbon-portugal': {
    name: 'Memmo Alfama',
    neighborhood: 'Alfama',
    approx_nightly_usd: 320,
    summary: '42 rooms in a converted 17th-century palace in the old Moorish quarter. Plunge pool with city view. Walk to Lisbon Cathedral in 5 min. Edit-eligible — $100 credit + breakfast on an already-fitting rate.',
    source_url: 'https://www.memmoalfama.com/',
    on_edit: true, on_hyatt: false,
  },
  'banff-canada': {
    name: 'Buffalo Mountain Lodge',
    neighborhood: 'Tunnel Mountain (10 min walk to Banff Ave)',
    approx_nightly_usd: 380,
    summary: 'Hand-hewn log-and-stone lodge with stone fireplaces. Quieter alternative to the Banff Springs (Marriott, ~$900+). Sky Bistro restaurant atop the gondola is a 10-min drive.',
    source_url: 'https://www.crmr.com/buffalo-mountain-lodge/',
    on_edit: false, on_hyatt: false,
  },
  'montreal-canada': {
    name: 'Hotel Le Germain Montreal',
    neighborhood: 'Downtown',
    approx_nightly_usd: 240,
    summary: 'Boutique 101-room Hotel Le Germain — JdV by Hyatt (Cat 4 ~15k pts). Walking-distance to Plateau, Mile End. Excellent both on cash and Hyatt points.',
    source_url: 'https://www.hyatt.com/jdv/yulgm-le-germain-hotel-montreal',
    on_edit: false, on_hyatt: true,
  },
  'reykjavik-iceland': {
    name: 'Sand Hotel by Keahotels',
    neighborhood: 'Laugavegur, downtown Reykjavík',
    approx_nightly_usd: 360,
    summary: '67 rooms on Reykjavík\'s main shopping street. Design-forward (Icelandic art, oak millwork, slate bathrooms) without ostentation. Walk to Hallgrímskirkja, Sky Lagoon shuttle stops outside. Boutique-not-luxury, well-priced for the location.',
    source_url: 'https://www.sandhotel.is/',
    on_edit: false, on_hyatt: false,
  },
  'halifax-cape-breton': {
    name: 'The Lord Nelson Hotel & Suites',
    neighborhood: 'Halifax downtown',
    approx_nightly_usd: 280,
    summary: 'Historic 1928 hotel facing the Public Gardens. Walking-distance to the harbor and Citadel. For Cape Breton, pair with Inverary Resort on Baddeck Bay (~$350) — independent, lakeside, near Cabot Trail.',
    source_url: 'https://lordnelsonhotel.ca/',
    on_edit: false, on_hyatt: false,
  },
  'bergen-fjords-norway': {
    name: 'Hotel Frogner House Bergen',
    neighborhood: 'Bergen city center',
    approx_nightly_usd: 320,
    summary: 'Boutique apartment-hotel in central Bergen. Kitchenettes (helpful for high-cost Norway food). Walk to the Bryggen wharf and the funicular to Mt. Fløyen. For the fjord legs, shift to small fjord-side inns (Union Geiranger ~$280).',
    source_url: 'https://www.frognerhouse.no/en/bergen',
    on_edit: false, on_hyatt: false,
  },
  'irvine-orange-county': {
    name: 'Hyatt Regency Newport Beach',
    neighborhood: 'Newport Beach (15 min from Irvine)',
    approx_nightly_usd: 280,
    summary: 'Hyatt Regency on Back Bay. Cat 3 (~12k pts/night) — one of the best Hyatt points values on the West Coast. Walk-to-beach not quite, but close. Pendry Newport Beach is the splurge ($850) but exceeds family cap.',
    source_url: 'https://www.hyatt.com/en-US/hotel/california/hyatt-regency-john-wayne-airport-newport-beach',
    on_edit: false, on_hyatt: true,
  },
};

const dests = await selectMany('trip_destinations', { trip_id: TRIP },
  'select=id,slug&status=eq.finalist');

let updated = 0;
for (const d of dests) {
  const p = PICKS[d.slug];
  if (!p) { console.error(`! ${d.slug}: no entry`); continue; }
  await pg(`/trip_destinations?id=eq.${d.id}`, {
    method: 'PATCH', body: JSON.stringify({ hotel_pick: p }),
  });
  console.log(`  ✓ ${d.slug.padEnd(28)}  ${p.name.padEnd(40)} ~$${p.approx_nightly_usd}/n${p.on_edit ? ' [EDIT]' : ''}${p.on_hyatt ? ' [HYATT]' : ''}`);
  updated++;
}
console.log(`\n✓ Updated ${updated} of ${dests.length}`);
