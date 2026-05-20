-- Itineraries: locked single-trip plans rendered as long-form markdown briefs.
-- Sibling of `trips` (multi-destination comparison) and `groups` (city restaurants).
-- Used when the trip shape is decided and we just want to surface the day-by-day
-- + stays + bookings + tradeoffs as a mobile-readable page at /?i=<token>.
--
-- Single table, single column for the brief (markdown). The webapp parses
-- section headers (## H2 / ### H3) to build the sticky in-page nav. No
-- per-day relational shape — the markdown is the source of truth.

CREATE TABLE itineraries (
  id              text PRIMARY KEY DEFAULT gen_trip_token(),
  name            text NOT NULL,
  brief_md        text NOT NULL,
  dates_start     date,
  dates_end       date,
  duration_days   int,
  origin_airport  text,
  traveler_slugs  text[] NOT NULL DEFAULT '{}'::text[],
  is_public       boolean NOT NULL DEFAULT false,
  created_by_name text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_itineraries_public ON itineraries(is_public) WHERE is_public = true;

ALTER TABLE itineraries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON itineraries FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER itineraries_touch BEFORE UPDATE ON itineraries
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
