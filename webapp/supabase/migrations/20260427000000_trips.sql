-- Trips: top-level "where should we go for this vacation" planning artifact.
-- Sibling of `groups` (which scopes restaurants/activities for one city). A trip
-- considers many candidate cities, scores them against family preferences from
-- ghostwheel, picks finalists, and ships a visual report (scorecard + masonry +
-- visual itinerary) at /?t=<token>.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Reuse the same 8-char unguessable-token alphabet as gen_group_token().
CREATE OR REPLACE FUNCTION gen_trip_token() RETURNS text AS $$
DECLARE
  alphabet text := 'abcdefghijkmnpqrstuvwxyz23456789';
  result text := '';
  rand_byte int;
  i int;
BEGIN
  FOR i IN 1..8 LOOP
    rand_byte := get_byte(gen_random_bytes(1), 0);
    result := result || substr(alphabet, 1 + (rand_byte % 32), 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ── trips ──
-- One row per trip. The trip declares constraints (dates, origin, travelers)
-- and accumulates candidate destinations. `traveler_slugs` references
-- ghostwheel/data/people/<slug>.md (e.g., ['niki','carissa','ashi']).
CREATE TABLE trips (
  id              text PRIMARY KEY DEFAULT gen_trip_token(),
  name            text NOT NULL,
  dates_start     date,
  dates_end       date,
  duration_days   int,
  origin_airport  text,
  traveler_slugs  text[] NOT NULL DEFAULT '{}'::text[],
  criteria        jsonb DEFAULT '{}'::jsonb,
  hard_filters    jsonb DEFAULT '{}'::jsonb,    -- e.g. {"climate_max_F":85,"exclude_cities":["seattle",...]}
  is_public       boolean NOT NULL DEFAULT false,
  created_by_name text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_trips_public ON trips(is_public) WHERE is_public = true;

-- ── trip_destinations ──
-- One row per candidate destination. `status='active'` means included in the
-- ranking; `status='rejected'` means filtered out (kept for audit, with reason).
-- Composition fields (`report_md`, `itinerary`, `hotel_pick`) are populated only
-- for finalists (top N).
CREATE TABLE trip_destinations (
  id                 bigserial PRIMARY KEY,
  trip_id            text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  slug               text NOT NULL,            -- 'lisbon-portugal'
  name               text NOT NULL,            -- 'Lisbon'
  country            text,
  region             text,                     -- coast/mountain/etc tag
  lat                double precision,
  lng                double precision,
  status             text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('candidate','active','finalist','rejected','removed')),
  rejection_reason   text,                     -- short label when status='rejected'
  ranking            int,                      -- 1 = top pick (only set on finalists)
  composite_score    numeric(4,2),             -- 0.00–5.00
  scores             jsonb DEFAULT '{}'::jsonb,    -- per-bucket: {"natural_beauty":4.5,...}
  operational        jsonb DEFAULT '{}'::jsonb,    -- {"flights":{...},"climate":{...},"visa":{...}}
  sources            jsonb DEFAULT '[]'::jsonb,    -- [{"type":"nyt36hours","url":"...","title":"..."}, ...]
  report_md          text,                     -- long-form composed report
  itinerary          jsonb,                    -- [{day:1,slots:[{type:'morning',name:'Pena Park',text:'…',photo_ids:[…]}]}, …]
  hotel_pick         jsonb,                    -- {"name":"Memmo Alfama","summary":"…","photo_ids":[…]}
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now(),
  UNIQUE (trip_id, slug)
);

CREATE INDEX idx_trip_destinations_trip   ON trip_destinations(trip_id, status);
CREATE INDEX idx_trip_destinations_rank   ON trip_destinations(trip_id, ranking) WHERE ranking IS NOT NULL;

-- ── trip_destination_photos ──
-- Image manifest. Photos live in Supabase Storage (bucket `trip-photos`); this
-- table holds the metadata + bucket assignment + caption needed to render the
-- visual scorecard, hero masonry, and visual itinerary.
--
-- bucket values (used by the renderer to slot images):
--   'hero'              — top masonry; not a scorecard dimension
--   'natural-beauty'    — landscape/water/mountain shots
--   'city-aesthetic'    — streetscape/architecture/design moments
--   'foodie'            — restaurant/market/dish shots
--   'boutique-stay'     — hotel lobby/room/exterior shots
--   'climate-feel'      — weather-vibe shots (sunny coast, alpine, etc.)
--   'itinerary-slot'    — keyed to a specific itinerary slot (see itinerary_slot_key)
CREATE TABLE trip_destination_photos (
  id                  bigserial PRIMARY KEY,
  trip_destination_id bigint NOT NULL REFERENCES trip_destinations(id) ON DELETE CASCADE,
  storage_path        text NOT NULL,           -- 'trip-photos/<token>/<slug>/<bucket>-<n>.jpg'
  source_url          text,                    -- where we scraped it from
  source_name         text,                    -- 'NYT 36 Hours' / 'CNT' / 'AFAR' / 'Lonely Planet'
  caption             text,
  alt_text            text,
  section             text,                    -- editorial section in the source ('Where to Eat', 'Day 2', etc.)
  bucket              text NOT NULL CHECK (bucket IN
    ('hero','natural-beauty','city-aesthetic','foodie','boutique-stay','climate-feel','itinerary-slot')),
  itinerary_slot_key  text,                    -- when bucket='itinerary-slot': '<day>-<slot>' (e.g., '1-morning')
  place_mentions      text[] DEFAULT '{}'::text[],   -- named places found in caption (for itinerary linkage)
  width               int,
  height              int,
  perceptual_hash     text,                    -- for cross-photo dedupe
  attribution         text,                    -- 'Photo: <photographer> / <source>' for renderer
  rank                int,                     -- ordering within its bucket; lower = featured
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX idx_photos_destination     ON trip_destination_photos(trip_destination_id, bucket, rank);
CREATE INDEX idx_photos_phash           ON trip_destination_photos(perceptual_hash);
CREATE INDEX idx_photos_itinerary_slot  ON trip_destination_photos(trip_destination_id, itinerary_slot_key)
  WHERE bucket = 'itinerary-slot';

-- ── RLS (permissive — same model as groups; access control is "know the token") ──

ALTER TABLE trips                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_destinations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_destination_photos  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all" ON trips                    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON trip_destinations        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON trip_destination_photos  FOR ALL USING (true) WITH CHECK (true);

-- updated_at triggers (keep it simple)
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trips_touch                 BEFORE UPDATE ON trips                   FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trip_destinations_touch     BEFORE UPDATE ON trip_destinations       FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
