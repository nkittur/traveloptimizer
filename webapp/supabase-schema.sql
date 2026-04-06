-- Run this in Supabase SQL Editor to create the tables

-- Per-user state on each restaurant (vote, shortlist, trash)
CREATE TABLE restaurant_state (
  restaurant_id text NOT NULL,
  user_name text NOT NULL,
  vote integer DEFAULT 0,
  status text DEFAULT 'default' CHECK (status IN ('default', 'shortlisted', 'trashed')),
  shortlist_position integer DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (restaurant_id, user_name)
);

-- Threaded comments (shared across all users)
CREATE TABLE comments (
  id text PRIMARY KEY,
  restaurant_id text NOT NULL,
  user_name text NOT NULL,
  text text NOT NULL,
  parent_id text,
  created_at timestamptz DEFAULT now()
);

-- Custom restaurants added by users (shared)
CREATE TABLE custom_restaurants (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Enable Row Level Security but allow all access (family tool, anon key)
ALTER TABLE restaurant_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_restaurants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all" ON restaurant_state FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON comments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON custom_restaurants FOR ALL USING (true) WITH CHECK (true);

-- Indexes for performance
CREATE INDEX idx_state_restaurant ON restaurant_state(restaurant_id);
CREATE INDEX idx_comments_restaurant ON comments(restaurant_id);
CREATE INDEX idx_comments_parent ON comments(parent_id);
