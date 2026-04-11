-- Make groups optionally public (discoverable from the picker's "Discover" section).
-- Write access is already permissive via RLS; this flag only controls whether
-- a group shows up in the pre-screen's public list.

ALTER TABLE groups ADD COLUMN is_public boolean NOT NULL DEFAULT false;

CREATE INDEX idx_groups_public ON groups(is_public) WHERE is_public = true;

-- Flag the existing legacy groups as public so they're discoverable.
UPDATE groups SET is_public = true WHERE city_slug IN ('san-diego', 'barcelona');
