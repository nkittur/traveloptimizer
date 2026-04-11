-- Multi-tenant refactor: introduce "groups" as the tenant.
-- A group = {shareable token, city, criteria, members, restaurants, votes, comments}.
-- Every existing row is backfilled into one legacy San Diego group.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 8-char URL-safe, unambiguous, unguessable token (32^8 ≈ 1.1T combinations).
-- Alphabet omits 0/1/l/o to avoid confusion when shared verbally.
CREATE OR REPLACE FUNCTION gen_group_token() RETURNS text AS $$
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

-- ── New tables ──

CREATE TABLE groups (
  id            text PRIMARY KEY DEFAULT gen_group_token(),
  name          text NOT NULL,
  city_name     text NOT NULL,
  city_slug     text NOT NULL,
  country       text,
  criteria      jsonb DEFAULT '{}'::jsonb,
  target_area   jsonb,
  default_center jsonb,
  default_zoom  int DEFAULT 11,
  created_by_name text,
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE group_restaurants (
  group_id       text NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  restaurant_id  text NOT NULL,
  data           jsonb NOT NULL,
  first_seen_run text,
  last_seen_run  text,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  created_at     timestamptz DEFAULT now(),
  PRIMARY KEY (group_id, restaurant_id)
);

CREATE TABLE discovery_runs (
  id              text PRIMARY KEY,
  group_id        text NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  started_at      timestamptz DEFAULT now(),
  completed_at    timestamptz,
  places_added    int DEFAULT 0,
  places_removed  int DEFAULT 0,
  places_still_present int DEFAULT 0,
  summary         jsonb
);

CREATE TABLE group_visits (
  group_id       text NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_name      text NOT NULL,
  last_seen_run  text,
  last_visited_at timestamptz DEFAULT now(),
  PRIMARY KEY (group_id, user_name)
);

CREATE INDEX idx_group_restaurants_active ON group_restaurants(group_id, status);
CREATE INDEX idx_discovery_runs_group ON discovery_runs(group_id, started_at DESC);

-- ── Add group_id to existing tables (nullable first, then backfill, then NOT NULL) ──

ALTER TABLE restaurant_state    ADD COLUMN group_id text;
ALTER TABLE comments            ADD COLUMN group_id text;
ALTER TABLE custom_restaurants  ADD COLUMN group_id text;
ALTER TABLE shared_state        ADD COLUMN group_id text;

-- ── Bootstrap the legacy SD group + backfill ──

DO $$
DECLARE
  legacy_id text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM groups) THEN
    INSERT INTO groups (name, city_name, city_slug, country, created_by_name)
    VALUES ('San Diego — Family', 'San Diego', 'san-diego', 'USA', 'naveen')
    RETURNING id INTO legacy_id;

    UPDATE restaurant_state   SET group_id = legacy_id WHERE group_id IS NULL;
    UPDATE comments           SET group_id = legacy_id WHERE group_id IS NULL;
    UPDATE custom_restaurants SET group_id = legacy_id WHERE group_id IS NULL;
    UPDATE shared_state       SET group_id = legacy_id WHERE group_id IS NULL;

    RAISE NOTICE 'Legacy SD group created: id=%', legacy_id;
  END IF;
END $$;

-- ── Lock in group_id and repoint primary keys ──

ALTER TABLE restaurant_state   ALTER COLUMN group_id SET NOT NULL;
ALTER TABLE comments           ALTER COLUMN group_id SET NOT NULL;
ALTER TABLE custom_restaurants ALTER COLUMN group_id SET NOT NULL;
ALTER TABLE shared_state       ALTER COLUMN group_id SET NOT NULL;

ALTER TABLE restaurant_state   ADD CONSTRAINT restaurant_state_group_fk   FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;
ALTER TABLE comments           ADD CONSTRAINT comments_group_fk           FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;
ALTER TABLE custom_restaurants ADD CONSTRAINT custom_restaurants_group_fk FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;
ALTER TABLE shared_state       ADD CONSTRAINT shared_state_group_fk       FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;

-- restaurant_state: PK becomes (group_id, restaurant_id, user_name)
ALTER TABLE restaurant_state DROP CONSTRAINT restaurant_state_pkey;
ALTER TABLE restaurant_state ADD  CONSTRAINT restaurant_state_pkey PRIMARY KEY (group_id, restaurant_id, user_name);

-- shared_state: PK becomes (group_id, key)
ALTER TABLE shared_state DROP CONSTRAINT shared_state_pkey;
ALTER TABLE shared_state ADD  CONSTRAINT shared_state_pkey PRIMARY KEY (group_id, key);

-- Helpful secondary indexes for query paths
CREATE INDEX idx_restaurant_state_group ON restaurant_state(group_id, restaurant_id);
CREATE INDEX idx_comments_group         ON comments(group_id, restaurant_id);
CREATE INDEX idx_custom_group           ON custom_restaurants(group_id);

-- ── RLS (permissive — access control is "know the token") ──

ALTER TABLE groups            ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovery_runs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_visits      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all" ON groups            FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON group_restaurants FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON discovery_runs    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON group_visits      FOR ALL USING (true) WITH CHECK (true);
