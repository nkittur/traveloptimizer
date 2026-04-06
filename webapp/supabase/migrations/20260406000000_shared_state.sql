CREATE TABLE shared_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by text,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE shared_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON shared_state FOR ALL USING (true) WITH CHECK (true);
