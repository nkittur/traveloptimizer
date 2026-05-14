#!/usr/bin/env node
// _apply-aug2026-curated-picks.mjs
// For destinations that didn't get the mention-driven recompose pipeline
// (no NYT article scraped, or thin scrape), hand-curate agree_picks +
// food_picks + a brief report_md. Sources marked as "curated" rather than
// "verified" — every place is from author knowledge of the destination.
//
// Run: node tools/_apply-aug2026-curated-picks.mjs

import { selectMany, pg } from './_db.mjs';

const TRIP = 'cg7pgj64';

// Helper: tag every pick with sources=['curated'] so the renderer's source pills
// show "curated" rather than NYT/CNT/etc. (we'll style 'curated' as a neutral pill).
const c = (name, category, snippet) => ({ name, category, count: 1, sources: ['curated'], snippet });

const DATA = {
  'acadia-maine': {
    intro: 'Mount Desert Island is granite-and-spruce New England at its most concentrated — Cadillac Mountain rising from the Atlantic, ringed by pink-pebble coves, hemlock trails, and a Vanderbilt-era harbor town with a working lobster fleet still tied up at the pier. Acadia National Park sprawls across most of the island, threaded by the carriage roads John D. Rockefeller Jr. built in the 1910s for horse-drawn travel — now the country\'s prettiest 45-mile cycling network.',
    natural: 'The carriage roads are the unique move — 45 miles of crushed-stone gradients with no cars, mossy stone bridges, no climbing-grade headaches. Beehive Trail is the family-friendly thrill (iron rungs above Sand Beach, 1.4 miles). Schoodic Peninsula is the quieter chunk of Acadia an hour east of Bar Harbor — same pink granite without the crowds.',
    city: 'Bar Harbor is a working-village-cum-cruise-port — arrive before 10am and after 6pm to feel the village. Northeast Harbor on the quiet side has Asticou Azalea Garden, the Thuya Garden walk, and the Beatrix Farrand-designed lawn slope above the harbor. Southwest Harbor is the lobster-and-locals alternative for dinner.',
    risks: 'Early August is peak season — the timed entry for Cadillac Mountain auto road sells out the morning it releases, and Bar Harbor on a cruise-ship day can feel like Disney. Mitigate by basing in Northeast Harbor, eating dinner in Southwest, and starting trail days before 8am. Limited city-aesthetic depth vs. the European peers — this is a nature-and-village trip, not a design-city trip.',
    agree: [
      c('Cadillac Mountain', 'park', 'First place in the U.S. to see daylight, May–October. Reservation required for the auto road; book the moment slots open.'),
      c('Jordan Pond', 'park', 'Popovers and tea on the south lawn, then a 3.3-mile loop with the Bubbles framed at the far end.'),
      c('Sand Beach', 'park', 'Cold-plunge beach in a granite cove. Pair with the Beehive Trail or Great Head Trail above.'),
      c('Beehive Trail', 'park', '1.4-mile iron-rung scramble above Sand Beach — the family-friendly thrill of Acadia.'),
      c('Bass Harbor Head Light', 'landmark', 'Maine\'s most-photographed lighthouse. Late afternoon golden hour earns it.'),
      c('Schoodic Peninsula', 'park', 'Quieter chunk of Acadia an hour east. Same pink granite, half the crowds.'),
      c('Asticou Azalea Garden', 'park', 'Japanese-influenced garden in Northeast Harbor — quiet, perfect for a slow afternoon.'),
      c('Acadia Carriage Roads', 'park', 'Rockefeller\'s 45-mile crushed-stone car-free network. Rent bikes at Acadia Bike on Cottage Street.'),
    ],
    food: [
      c('Mache Bistro', 'restaurant', 'Chef-owner Kyle Yarborough\'s small seasonal tasting menus in Bar Harbor. Book ahead.'),
      c('Havana', 'restaurant', 'Cuban-influenced date-night room in Bar Harbor — plantain mojo, grilled fish.'),
      c('Thurston\'s Lobster Pound', 'restaurant', 'Working pier in Bernard, lobster off the boat, picnic-table seating.'),
      c('Side Street Café', 'restaurant', 'Casual Bar Harbor lunch — lobster mac, lobster rolls.'),
      c('Galyn\'s', 'restaurant', 'Old-school Bar Harbor waterfront. Lobster bisque + the harbor view it\'s been there for 40 years.'),
      c('Sweet Pea\'s Café', 'cafe', 'Coffee + breakfast that won\'t disappoint a Blue Bottle bar.'),
      c('Mount Desert Ice Cream', 'cafe', 'Lavender + sea-salt-caramel scoops on Bar Harbor\'s Main Street.'),
      c('Atlantic Brewing Company', 'bar', 'Bar Harbor brewery — outdoor patio, casual food.'),
    ],
  },
  'asturias-spain': {
    intro: 'Northern Atlantic Spain — green-mountain-meets-rough-coast. The Picos de Europa rise within an hour of every coastal village; the cider houses (sidrerías) are the cultural anchor; and the cuisine is the under-rated sleeper of Spain. Almost no American tourists.',
    natural: 'The Picos de Europa is the headline — limestone massifs, alpine lakes (Covadonga), the Cares Gorge hike. The coast is rugged-cliff-with-pocket-beaches: Playa del Silencio, Gulpiyuri (a 50-meter beach in a sinkhole, fed by the sea through a cave), the entire Costa Verde. Cangas de Onís is the gateway town with its 12th-century parador and Roman bridge.',
    city: 'Oviedo is the Belle-Époque capital — pre-Romanesque churches (UNESCO), the cathedral, and a Sunday cider scene. Llanes is the eastern coastal village (port, painted breakwater cubes). Cudillero is the postcard-pastel fishing village to the west — narrow lanes climbing up from the harbor.',
    risks: 'No 1-stop direct via OVD — re-routing through Bilbao (BIO) adds a 2-hour drive. Limited international hotel infrastructure (paradores + small inns dominate). August coastal weather is mild but inland Asturias can spike. Limited English in rural areas.',
    agree: [
      c('Picos de Europa National Park', 'park', 'Limestone mountains rising from the coast. Lakes of Covadonga, Bulnes funicular, Cares Gorge hike.'),
      c('Lagos de Covadonga', 'park', 'Two glacial lakes (Enol, Ercina) above the Covadonga sanctuary. Drive up early — road closes when full.'),
      c('Playa de Gulpiyuri', 'park', 'Tiny inland beach in a sinkhole, fed by sea through a cave. 50m wide, otherworldly.'),
      c('Cudillero', 'sight', 'Pastel fishing village climbing up from the harbor — narrow lanes, postcard-perfect.'),
      c('Llanes', 'sight', 'Eastern coastal village with painted "memory cubes" breakwater (Agustín Ibarrola installation).'),
      c('Cangas de Onís', 'sight', 'Picos de Europa gateway. 12th-century Roman bridge over the Sella, parador in former monastery.'),
      c('Oviedo', 'sight', 'Belle-Époque capital. Pre-Romanesque churches (UNESCO), cathedral, Sunday cider scene.'),
      c('Playa del Silencio', 'park', 'Crescent of pebbled coves between cliffs. Walking-only access; named for the surf-only soundscape.'),
    ],
    food: [
      c('Casa Marcial', 'restaurant', 'Two-Michelin-star Picos-influenced tasting menu by the Manzano brothers. La Salgar village.'),
      c('El Corral del Indianu', 'restaurant', 'One-Michelin in Arriondas. Modernist Asturian cuisine with cider pairings.'),
      c('Sidrería Tierra Astur', 'restaurant', 'Cider house chain (Oviedo, Cangas) with the full cabrales-cheese-and-fabada experience and the high-pour cider trick.'),
      c('Casa Gerardo', 'restaurant', '4th-generation Michelin in Prendes near Gijón. The legendary fabada bean stew.'),
      c('Casa Marcelo', 'restaurant', 'Smaller-portion seafood-tasting bar in Cudillero — fresh-from-the-port octopus, percebes.'),
      c('La Botica', 'cafe', 'Llanes café-bakery for breakfast pastries before a Picos drive.'),
      c('Café Niza', 'cafe', 'Oviedo institution since 1930 — coffee + pastries + Belle-Époque interior.'),
    ],
  },
  'azores-portugal': {
    intro: 'Mid-Atlantic volcanic islands halfway between Lisbon and Boston. São Miguel is the largest and the easiest first visit — twin crater lakes, hot-springs valleys, black-sand beaches, the lowest American tourist count of any 5-hour-from-east-coast destination. Whale-watching off Pico is reliable July-September.',
    natural: 'Sete Cidades is the headline — twin crater lakes (one blue, one green) inside a 5km caldera, with viewpoints from Vista do Rei and Boca do Inferno. Furnas valley has hot springs (Caldeira Velha, Terra Nostra), the boiling-pots cooking area, and the lake. Lagoa do Fogo is the wilder crater lake (no road access — hike). Ponta da Ferraria has a thermal-spring beach where ocean meets hot water at low tide.',
    city: 'Ponta Delgada is São Miguel\'s small capital — Portuguese-cobblestone streets, two-tone churches, market hall. Furnas is the spa village, walking distance to the cooking pits. Ribeira Grande on the north coast is a quieter base.',
    risks: 'Marine layer (cloud-cover) common in summer mornings. Some inter-island activity needs ferries or short flights. Rental car essential — public transport is sparse. Restaurant bookings less critical than mainland Europe but still smart for top spots.',
    agree: [
      c('Sete Cidades', 'park', 'Twin crater lakes (Lagoa Azul, Lagoa Verde) inside a 5km caldera. Vista do Rei viewpoint at sunrise.'),
      c('Lagoa do Fogo', 'park', 'Wild crater lake — no road access, 1h hike down. Often above the cloud layer, otherworldly.'),
      c('Furnas Valley', 'park', 'Geothermal town. Cooking pits at the lake, Caldeira Velha hot-springs forest pool, Terra Nostra Park\'s iron-rich pool.'),
      c('Ponta da Ferraria', 'park', 'Thermal spring meets the Atlantic at low tide — bathe in a natural hot pool with surf rolling in.'),
      c('Caldeira Velha', 'park', 'Forest hot-springs pool above Ribeira Grande. Tropical-feeling waterfall + thermal cascade.'),
      c('Pico Mountain (Pico Island)', 'park', 'Portugal\'s highest peak (2351m), volcanic cone visible from São Miguel on clear days. Day-trip via inter-island flight.'),
      c('Ponta Delgada Old Town', 'sight', 'Portuguese-cobblestone capital — two-tone churches, market hall, harbor promenade.'),
      c('Whale watching from Ponta Delgada', 'park', 'Sperm whales, fin whales, 30+ species through summer. Half-day Zodiac trips from the marina.'),
    ],
    food: [
      c('Tasca São Pedro', 'restaurant', 'Ponta Delgada tasca — the cozido das Furnas (volcanic-cooked stew), grilled bonito.'),
      c('Restaurante Alcides', 'restaurant', 'Ponta Delgada steakhouse legend — the bife à regional cooked on stone, 50+ years.'),
      c('Restaurante Tony\'s', 'restaurant', 'Furnas institution for the cozido straight from the lake cooking pits. Lunch only.'),
      c('A Tasca', 'restaurant', 'Modern Azorean small plates in Ponta Delgada — pineapple-glazed pork, octopus rice.'),
      c('Cervejaria Toca da Lebre', 'restaurant', 'Beachfront in Mosteiros — fresh fish, sunset over the volcanic islets.'),
      c('Louvre Michaelense', 'cafe', 'Ponta Delgada concept-store-café in a 19th-century pharmacy. Excellent espresso.'),
      c('Quintal de Açores', 'cafe', 'Furnas tea house in a botanical garden. Try the Gorreana green tea (Europe\'s only tea plantation).'),
    ],
  },
  'banff-canada': {
    intro: 'The Canadian Rockies\' most-photographed valley — Bow River cutting between fang-shaped peaks, turquoise glacial lakes (Louise, Moraine, Peyto), a Vanderbilt-grade castle hotel, and a tiny mountain town with surprisingly good food.',
    natural: 'Lake Louise + Moraine Lake are the headline — both turquoise, both within a 1h drive of Banff townsite, both peak-season packed. Moraine\'s Rockpile sunrise is the iconic shot. Peyto Lake (off the Icefields Parkway) is the under-photographed alternative. Day-hikes: Plain of Six Glaciers from Lake Louise, Lake Agnes Tea House. The Banff Gondola climbs Sulphur Mountain for the valley overview.',
    city: 'Banff townsite is small (4 sq miles, ~9000 residents). Banff Avenue is the walkable spine — outdoor-gear shops, coffee, the Whyte Museum. The Cave & Basin National Historic Site marks the hot spring that started Canada\'s national park system. Drive 1h east to Canmore for a slightly less-touristed alternative.',
    risks: 'Peak crowds in early August are real — Lake Louise/Moraine require shuttle reservations or 5am parking. Forest-fire smoke a risk most summers. Wildlife encounters genuinely possible (carry spray on backcountry trails). The Canadian dollar makes it slightly easier on the wallet than nearby US national parks.',
    agree: [
      c('Lake Louise', 'park', 'Glacial-turquoise lake under Victoria Glacier. Canoes from the boathouse; Plain of Six Glaciers hike.'),
      c('Moraine Lake', 'park', 'Sunrise shot from the Rockpile — the photo on the old Canadian $20. Shuttle-only access.'),
      c('Peyto Lake', 'park', 'Off the Icefields Parkway, viewed from above. Under-photographed alternative to Louise/Moraine.'),
      c('Banff Gondola (Sulphur Mountain)', 'park', '8-min ride up Sulphur Mountain. Boardwalk to Sanson Peak for the 360° view of the Bow Valley.'),
      c('Lake Agnes Tea House', 'park', '3.4 mile hike from Lake Louise to a wood-cabin tea house at 7000 ft. Operating since 1905.'),
      c('Cave & Basin National Historic Site', 'museum', 'The hot springs that started Canada\'s national park system. Boardwalk + interpretive exhibits.'),
      c('Whyte Museum of the Canadian Rockies', 'museum', 'Banff townsite — historic photos and Group of Seven paintings of the range.'),
      c('Icefields Parkway drive', 'park', 'Hwy 93 north from Lake Louise — Bow Lake, Peyto, Saskatchewan Crossing, Athabasca Glacier. Full day.'),
    ],
    food: [
      c('Eden at the Rimrock', 'restaurant', 'Tasting-menu fine dining in the Rimrock Resort — Banff\'s most-decorated room, mountainview.'),
      c('Sky Bistro', 'restaurant', 'Top of the Banff Gondola. Window seats over the Bow Valley, Canadian-foraged tasting menus.'),
      c('Three Ravens', 'restaurant', 'Banff Centre rooftop — Indigenous-inspired plates, locally-sourced. Great patio.'),
      c('Park Distillery', 'restaurant', 'Banff Avenue rotisserie + house-distilled spirits. Casual family dinner.'),
      c('The Bison', 'restaurant', 'Canadian-Rockies cuisine over Bear Street — bison short rib, elk tartare.'),
      c('Wild Flour Bakery', 'cafe', 'Banff Avenue. Sourdough breads, pastries, lunch sandwiches. The morning stop.'),
      c('Lake Agnes Tea House', 'cafe', 'Hike to it. Cash only. Tea + sandwiches + the world\'s best ambient view.'),
    ],
  },
  'halifax-cape-breton': {
    intro: 'Atlantic Canada\'s capital city paired with Cape Breton\'s Cabot Trail — one of the world\'s most scenic drives. Halifax is harborfront-Victorian + a craft-beer-and-seafood scene; Cape Breton (4h drive northeast) is mountain-meets-sea Acadian/Scottish-Gaelic culture.',
    natural: 'The Cabot Trail loops 185 miles around Cape Breton Highlands National Park — moose-spotting, Skyline Trail headland boardwalks, hidden coves. Peggy\'s Cove (40 min from Halifax) is the iconic granite-and-lighthouse photo. Mahone Bay\'s three churches sit on the water. Lunenburg (UNESCO) is the painted-house fishing town.',
    city: 'Halifax\'s waterfront boardwalk runs 4km past restaurants and craft brewers. The Citadel hill fort dominates downtown. The Public Gardens (1867) are Victorian-perfect. Cape Breton\'s towns (Baddeck, Ingonish, Chéticamp) are tiny but each has an Acadian or Gaelic flavor.',
    risks: 'The Halifax → Cape Breton drive is 4h each way; budget 2-3 nights minimum for the loop. Cabot Trail accommodations book months ahead in summer. Atlantic Canada food scene is improving but remains thinner than Quebec or Maine. Tropical-storm risk through hurricane season.',
    agree: [
      c('Cabot Trail', 'park', '185-mile loop around Cape Breton Highlands NP. Skyline Trail boardwalk to a clifftop headland is the canonical stop.'),
      c('Peggy\'s Cove', 'landmark', 'Granite-and-lighthouse postcard 40 min from Halifax. Get there at sunrise to beat the buses.'),
      c('Lunenburg', 'sight', 'UNESCO-listed painted-house fishing town. Bluenose II schooner in the harbor.'),
      c('Halifax Citadel', 'museum', 'Star-shaped fort dominating downtown. Noon gun tradition. Views over the harbor.'),
      c('Halifax Public Gardens', 'park', 'Victorian-formal gardens (1867). Bandstand, Italian fountain, summer concerts.'),
      c('Cape Breton Highlands National Park', 'park', 'The Cabot Trail\'s scenic spine. Skyline + Middle Head + Franey trails.'),
      c('Maritime Museum of the Atlantic', 'museum', 'Halifax waterfront. Titanic exhibits + Halifax Explosion history.'),
      c('Mahone Bay', 'sight', 'Three churches in a row on the water. Drive between Halifax and Lunenburg.'),
    ],
    food: [
      c('The Bicycle Thief', 'restaurant', 'Halifax waterfront Italian — the city\'s reliable date-night room, harbor view.'),
      c('Press Gang', 'restaurant', '1759 stone building in downtown Halifax. Oysters, seafood, classic cocktails.'),
      c('Edna', 'restaurant', 'North End Halifax. Small-plates seasonal cuisine, modern feel.'),
      c('Field Guide', 'restaurant', 'North End neighborhood spot — daily-changing tasting menus, walk-in counter.'),
      c('Salty Rose', 'restaurant', 'Ingonish on the Cabot Trail. Fresh-from-the-pier seafood.'),
      c('Highwheeler Café', 'cafe', 'Baddeck (Cape Breton). Coffee + scones before a Cabot Trail drive day.'),
      c('Two If By Sea Café', 'cafe', 'Dartmouth (across the harbor from Halifax). The croissant that launched the Maritime cafe scene.'),
    ],
  },
  'bergen-fjords-norway': {
    intro: 'Western Norway\'s gateway city + the world\'s most dramatic fjord coast. Bergen itself is a colorful UNESCO Hanseatic wharf wrapped around a deep-water harbor; the fjords (Geiranger, Sognefjord, Hardangerfjord) are 1-3h drives or scenic ferries away.',
    natural: 'Geirangerfjord is the headline — 1500m cliffs, Seven Sisters Waterfall, the Stegastein viewpoint above Aurland. Sognefjord is Norway\'s longest. The Flåm Railway from Myrdal to Flåm is one of the world\'s most scenic train rides (1h, 866m descent). Mt. Fløyen funicular from central Bergen for the city overview + walks. Trolltunga (2h east) is the famous "troll\'s tongue" cliff (10-12h hike round-trip).',
    city: 'Bryggen is the colorful Hanseatic wharf — UNESCO-listed, full of small museums and craft shops. Fish Market (Torget) is touristy but the fish is fresh. KODE art museums (4 buildings) hold Munch and the Norwegian Romantics. Mount Ulriken is the higher of Bergen\'s seven mountains, accessible by gondola.',
    risks: 'Norway is expensive (food and lodging both ~50% above European average). Rain is common — Bergen averages 90"/year. To reach the deep fjords from Bergen requires car or organized tour (2-4h). PIT-BGO has no 1-stop; route via OSL + 50min Norwegian to BGO. Trolltunga and many fjord activities require advance booking.',
    agree: [
      c('Geirangerfjord', 'park', 'Norway\'s most-photographed fjord. 1500m cliffs, Seven Sisters Waterfall. Visit by car or scenic ferry.'),
      c('Sognefjord', 'park', 'Longest and deepest Norwegian fjord. The Nærøyfjord branch is the UNESCO-listed narrow stretch.'),
      c('Flåm Railway', 'park', '20-km train from Myrdal down to Flåm. 866m descent through waterfalls. Among the world\'s great rail rides.'),
      c('Bryggen', 'sight', 'Bergen\'s Hanseatic colored-wood wharf. UNESCO. Full of small museums, craft shops, narrow alleys.'),
      c('Mt. Fløyen funicular', 'park', '5-min funicular from central Bergen to a viewpoint + extensive walking trails. Great for a Bergen afternoon.'),
      c('Stegastein viewpoint', 'park', '650m cantilever above Aurland fjord. 30-min drive from the Flåm Railway endpoint.'),
      c('KODE Art Museums', 'museum', 'Four-building art complex in Bergen. Edvard Munch + the Norwegian Romantics.'),
      c('Trolltunga', 'park', 'Famous "troll\'s tongue" rock 1100m above Lake Ringedalsvatnet. 10-12h hike, summer-only. Book parking ahead.'),
    ],
    food: [
      c('Lysverket', 'restaurant', 'Bergen Michelin star inside KODE. Modern Nordic with West-Norwegian seafood emphasis.'),
      c('Bare Vestland', 'restaurant', 'Bergen — Western-Norwegian regional cuisine, smaller plates, casual setting.'),
      c('Cornelius Sjømatrestaurant', 'restaurant', 'Island restaurant 25 min by boat from Bergen. Fjord-meal experience.'),
      c('Bryggeloftet & Stuene', 'restaurant', 'Traditional Bergen institution since 1910. Reindeer, klippfisk, classic Norwegian preparations.'),
      c('Pingvinen', 'restaurant', 'Casual Bergen bar/restaurant for the basics — fish soup, raspeballer (potato dumplings).'),
      c('Det Lille Kaffekompaniet', 'cafe', 'Bergen specialty roaster on a steep cobbled street. The neighborhood\'s morning anchor.'),
      c('Kafé Spesial', 'cafe', 'Bergen — Norwegian breakfast, lunch sandwiches, kanelbulle (cinnamon buns).'),
    ],
  },
  'montreal-canada': {
    intro: 'North America\'s most European city — bilingual, walkable, food-obsessed, with a 4-mile downtown spine that hits Old Montreal\'s 18th-century stone, the design-y Plateau, and the Mile End hipster sweet spot. The food scene punches above the city\'s weight.',
    natural: 'Mount Royal Park (Olmsted-designed, the same one as Central Park) is the green heart — walks up to the Belvedere for the city + St. Lawrence view. Lachine Canal bike path runs 14km southwest from Old Port. Île Sainte-Hélène (former Expo 67 site) has Biosphère + amusement park. Day-trip: the Eastern Townships (Cantons-de-l\'Est) for vineyards + lakes.',
    city: 'Old Montreal (Vieux-Montréal) is the cobblestone-and-stone walking district — Notre-Dame Basilica\'s blue interior is the icon. The Plateau Mont-Royal has the staircase-and-iron-balcony residential aesthetic and indie boutiques. Mile End is the hipster food + Hasidic-Jewish cluster (best bagels in North America). Marché Jean-Talon is the largest farmers\' market in N. America.',
    risks: 'August is hot-and-humid (humidex often 90°F+) — afternoon AC retreats matter. Construction season is real — orange cones everywhere downtown. The food scene rewards reservations 1-2 weeks ahead. Quebec\'s French-language signage is universal but English service is fully comfortable.',
    agree: [
      c('Mount Royal Park', 'park', 'Olmsted-designed 700-acre park. Walk up to Kondiaronk Belvedere for the downtown + river view.'),
      c('Old Montreal', 'sight', '18th-century cobblestone-and-stone district. Notre-Dame Basilica\'s blue interior is the must-see.'),
      c('Plateau Mont-Royal', 'sight', 'Iron-balcony staircase residential neighborhood. Boulevard Saint-Laurent for indie shopping + cafés.'),
      c('Mile End', 'sight', 'Hipster food + Hasidic-Jewish cluster in the city\'s northwest. St-Viateur and Fairmount bagel feud here.'),
      c('Marché Jean-Talon', 'shop', 'Largest farmers\' market in N. America. Little Italy. Quebec produce, cheese, sausage.'),
      c('Notre-Dame Basilica', 'landmark', 'Cobalt-blue gold-leaf interior on Place d\'Armes. Light show "AURA" in evenings.'),
      c('Musée des Beaux-Arts de Montréal', 'museum', 'Largest art museum in Quebec. Strong Canadian + Inuit collections + temporary blockbusters.'),
      c('Biodôme', 'museum', 'Former Olympic velodrome converted into a 4-ecosystem walk-through. Family-friendly.'),
    ],
    food: [
      c('Joe Beef', 'restaurant', 'Little Burgundy. The city\'s most-famous restaurant — David McMillan + Frédéric Morin\'s legendary excessive bistro.'),
      c('L\'Express', 'restaurant', 'Plateau Parisian-bistro institution since 1980. Open till 2am. Steak frites + house cornichons.'),
      c('Schwartz\'s Deli', 'restaurant', 'Boulevard Saint-Laurent. Smoked-meat sandwich since 1928. Line up.'),
      c('St-Viateur Bagel', 'restaurant', 'Mile End. Wood-fired Montreal bagels. Open 24/7. The pilgrimage.'),
      c('Au Pied de Cochon', 'restaurant', 'Plateau, Martin Picard\'s temple of Quebec excess. Foie gras poutine. Closed Mon-Tue.'),
      c('Le Vin Papillon', 'restaurant', 'Joe Beef sister, vegetable-forward natural-wine bar. Walk-in only, line up.'),
      c('Olive et Gourmando', 'cafe', 'Old Montreal café — sandwiches + coffee + pastries. The lunch-counter standard.'),
      c('Pikolo Espresso Bar', 'cafe', 'Plateau micro-cafe. Specialty roasts.'),
    ],
  },
  'irvine-orange-county': {
    intro: 'Coastal Orange County — Newport Beach + Crystal Cove + Laguna + the Disneyland orbit. It\'s parents-visiting territory but the coast (15 min from Irvine) delivers California beach culture at its best, plus an under-rated Asian-food scene from Westminster (Little Saigon) to Garden Grove (Korean).',
    natural: 'Crystal Cove State Park is the headline — 3 miles of preserved coast, tidepools, restored 1930s beach cottages. Laguna Beach\'s 30+ pocket coves include Thousand Steps and Treasure Island. Newport Beach\'s 6-mile boardwalk runs from the wedge to Balboa Island. Inland: Joshua Tree is 2.5h east; San Diego\'s North County (Encinitas, Carlsbad) is 1h south.',
    city: 'Irvine itself is master-planned suburb (lots of parks, low density, no real downtown). Newport Beach\'s Lido Marina Village is the boutique-shopping coastal stretch. Costa Mesa\'s SoBeCa neighborhood + The Lab Antimall is the hipster pocket. South Coast Plaza is the country\'s top-grossing mall. Disneyland is 30 min north in Anaheim if Ashi wants the day-trip.',
    risks: 'Hot inland (Irvine 85°F+ in August) but coastal communities stay 75°F. Wildfire risk in late summer. Traffic is real — even short distances take 30-45 min in rush hour. Parking at coastal beaches fills by 9am on weekends.',
    agree: [
      c('Crystal Cove State Park', 'park', '3 miles of preserved coast between Newport and Laguna. Tidepools, restored 1930s cottages, swimmable beach.'),
      c('Newport Beach Boardwalk', 'park', '6-mile flat boardwalk from the Wedge to Balboa Island. Bike rentals at the pier.'),
      c('Laguna Beach coast', 'park', '30+ pocket coves between Crystal Cove and Dana Point. Thousand Steps + Treasure Island standouts.'),
      c('Balboa Island', 'sight', 'Tiny island in Newport Harbor — frozen banana stands, Cape Cod-style cottages, ferry from the peninsula.'),
      c('Lido Marina Village', 'shop', 'Newport Beach boutique shopping + harbor restaurants. Walking-distance to Lido House.'),
      c('Crystal Cove Historic District', 'sight', '46 restored 1930s beach cottages — preserved as a state park living museum. Reservations essential to stay.'),
      c('Mission San Juan Capistrano', 'museum', 'Founded 1776, the swallows-of-Capistrano church. 30 min south.'),
      c('South Coast Plaza', 'shop', 'Country\'s top-grossing mall. Costa Mesa. Ashi\'s shopping day.'),
    ],
    food: [
      c('Bear Flag Fish Co.', 'restaurant', 'Newport Beach. Fish-market-counter casual seafood — poke bowls, ceviche, swordfish tacos.'),
      c('Mastro\'s Ocean Club', 'restaurant', 'Newport Coast oceanfront — California special-occasion steakhouse with sunset view.'),
      c('Tannins', 'restaurant', 'Newport Beach Lido — wine-bar small-plates, sister to Pendry\'s casual room.'),
      c('Brodard', 'restaurant', 'Garden Grove (Little Saigon). Vietnamese spring rolls + nem nướng — the West Coast classic.'),
      c('Marination', 'restaurant', 'Costa Mesa. Korean-Hawaiian fusion small plates.'),
      c('Sidecar Doughnuts', 'cafe', 'Costa Mesa. Among the country\'s best sourdough donuts.'),
      c('Kean Coffee', 'cafe', 'Newport Beach + Tustin. Independent specialty roaster — 8oz Stumptown-tier flat whites.'),
      c('Lou\'s Records', 'shop', 'Encinitas (1h south but worth it). Among the country\'s best independent record shops.'),
    ],
  },
};

const dests = await selectMany('trip_destinations', { trip_id: TRIP },
  'select=id,slug,operational&status=eq.finalist');

let updated = 0;
for (const d of dests) {
  const e = DATA[d.slug];
  if (!e) continue;
  const reportMd = [
    `## The place\n\n${e.intro}`,
    `## The natural side\n\n${e.natural}`,
    `## The city side\n\n${e.city}`,
    `## Risks / tradeoffs\n\n${e.risks}`,
  ].join('\n\n');
  const newOp = {
    ...(d.operational || {}),
    agree_picks: e.agree,
    food_picks: e.food,
  };
  await pg(`/trip_destinations?id=eq.${d.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ report_md: reportMd, operational: newOp }),
  });
  console.log(`  ✓ ${d.slug.padEnd(28)}  agree:${e.agree.length} food:${e.food.length} report:${reportMd.length}ch`);
  updated++;
}
console.log(`\n✓ Updated ${updated} destinations.`);
