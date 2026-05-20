// supabase.js — Supabase backend for shared state, scoped per group.
// Config is loaded from window.__SUPABASE_URL and window.__SUPABASE_KEY (index.html).

let _sb = null;
let _groupId = null;

function getClient() {
  if (_sb) return _sb;
  const url = window.__SUPABASE_URL;
  const key = window.__SUPABASE_KEY;
  if (!url || !key) return null;
  _sb = window.supabase.createClient(url, key);
  return _sb;
}

function sb() {
  const client = getClient();
  if (!client) throw new Error('Supabase not configured');
  return client;
}

export function isConfigured() {
  return !!(window.__SUPABASE_URL && window.__SUPABASE_KEY);
}

// ── Group context ──

export function setGroupId(id) {
  _groupId = id;
}

export function getGroupId() {
  return _groupId;
}

function requireGroup() {
  if (!_groupId) throw new Error('No group set. Call setGroupId() first.');
  return _groupId;
}

// ── Groups ──

export async function loadGroup(id) {
  const { data, error } = await sb()
    .from('groups')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) { console.error('loadGroup:', error); return null; }
  return data;
}

export async function loadGroups(ids) {
  if (!ids?.length) return [];
  const { data, error } = await sb()
    .from('groups')
    .select('*')
    .in('id', ids);
  if (error) { console.error('loadGroups:', error); return []; }
  return data;
}

export async function createGroup({ name, cityName, citySlug, country, criteria, createdByName, isPublic = false }) {
  const { data, error } = await sb()
    .from('groups')
    .insert({
      name,
      city_name: cityName,
      city_slug: citySlug,
      country,
      criteria: criteria || {},
      created_by_name: createdByName || null,
      is_public: !!isPublic,
    })
    .select()
    .single();
  if (error) { console.error('createGroup:', error); return null; }
  return data;
}

// Public groups — shown in the picker's "Discover" section.
export async function loadPublicGroups() {
  const { data, error } = await sb()
    .from('groups')
    .select('id,name,city_name,country,created_at')
    .eq('is_public', true)
    .order('created_at', { ascending: true });
  if (error) { console.error('loadPublicGroups:', error); return []; }
  return data;
}

// Count the active restaurants in a batch of groups (single query).
export async function countActiveRestaurants(groupIds) {
  if (!groupIds?.length) return {};
  const { data, error } = await sb()
    .from('group_restaurants')
    .select('group_id')
    .in('group_id', groupIds)
    .eq('status', 'active');
  if (error) { console.error('countActiveRestaurants:', error); return {}; }
  const counts = {};
  for (const row of data) counts[row.group_id] = (counts[row.group_id] || 0) + 1;
  return counts;
}

// ── Trips (destinations-level) ──

const TRIP_PHOTO_BASE = (() => {
  const url = window.__SUPABASE_URL;
  return url ? `${url}/storage/v1/object/public/trip-photos/` : '';
})();

export function tripPhotoUrl(storagePath) {
  if (!storagePath) return '';
  if (storagePath.startsWith('http')) return storagePath;
  return TRIP_PHOTO_BASE + storagePath;
}

export async function loadTrip(id) {
  const { data, error } = await sb()
    .from('trips').select('*').eq('id', id).maybeSingle();
  if (error) { console.error('loadTrip:', error); return null; }
  return data;
}

export async function loadPublicTrips() {
  const { data, error } = await sb()
    .from('trips')
    .select('id,name,dates_start,dates_end,duration_days,origin_airport,traveler_slugs,created_at')
    .eq('is_public', true)
    .order('created_at', { ascending: false });
  if (error) { console.error('loadPublicTrips:', error); return []; }
  return data;
}

export async function loadTripDestinations(tripId) {
  const { data, error } = await sb()
    .from('trip_destinations')
    .select('*')
    .eq('trip_id', tripId)
    .order('ranking', { ascending: true, nullsLast: true })
    .order('composite_score', { ascending: false, nullsLast: true });
  if (error) { console.error('loadTripDestinations:', error); return []; }
  return data;
}

// ── Itineraries (locked single-trip briefs) ──

export async function loadItinerary(id) {
  const { data, error } = await sb()
    .from('itineraries').select('*').eq('id', id).maybeSingle();
  if (error) { console.error('loadItinerary:', error); return null; }
  return data;
}

export async function loadTripPhotos(destinationIds) {
  if (!destinationIds?.length) return [];
  const { data, error } = await sb()
    .from('trip_destination_photos')
    .select('*')
    .in('trip_destination_id', destinationIds)
    .order('rank', { ascending: true, nullsLast: true });
  if (error) { console.error('loadTripPhotos:', error); return []; }
  return data;
}

// ── Restaurants (per-group) ──

export async function loadGroupRestaurants() {
  const groupId = requireGroup();
  const { data, error } = await sb()
    .from('group_restaurants')
    .select('*')
    .eq('group_id', groupId)
    .eq('status', 'active');
  if (error) { console.error('loadGroupRestaurants:', error); return []; }
  // Merge the jsonb data payload with top-level metadata so existing UI shape is preserved
  return data.map(row => ({
    ...row.data,
    id: row.restaurant_id,
    _firstSeenRun: row.first_seen_run,
    _lastSeenRun: row.last_seen_run,
  }));
}

// ── User identification ──

export function getUser() {
  const gid = _groupId;
  if (!gid) return null;
  return localStorage.getItem(`user-name:${gid}`);
}

export function setUser(name) {
  const gid = requireGroup();
  localStorage.setItem(`user-name:${gid}`, name);
}

// ── Restaurant State (votes, shortlist, trash) ──

export async function loadAllState() {
  const groupId = requireGroup();
  const { data, error } = await sb()
    .from('restaurant_state')
    .select('*')
    .eq('group_id', groupId);
  if (error) { console.error('loadAllState:', error); return {}; }

  const result = {};
  for (const row of data) {
    if (!result[row.restaurant_id]) result[row.restaurant_id] = {};
    result[row.restaurant_id][row.user_name] = {
      vote: row.vote,
      status: row.status,
      shortlistPosition: row.shortlist_position,
    };
  }
  return result;
}

export async function upsertState(restaurantId, userName, updates) {
  const groupId = requireGroup();
  const { error } = await sb()
    .from('restaurant_state')
    .upsert({
      group_id: groupId,
      restaurant_id: restaurantId,
      user_name: userName,
      ...updates,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'group_id,restaurant_id,user_name' });
  if (error) console.error('upsertState:', error);
}

export async function setVote(restaurantId, userName, vote) {
  await upsertState(restaurantId, userName, { vote });
}

export async function setStatus(restaurantId, userName, status, shortlistPosition = 0) {
  await upsertState(restaurantId, userName, { status, shortlist_position: shortlistPosition });
}

export async function updateShortlistPositions(userName, orderedIds) {
  const promises = orderedIds.map((id, i) =>
    upsertState(id, userName, { status: 'shortlisted', shortlist_position: i })
  );
  await Promise.all(promises);
}

// ── Comments (shared within group) ──

export async function loadAllComments() {
  const groupId = requireGroup();
  const { data, error } = await sb()
    .from('comments')
    .select('*')
    .eq('group_id', groupId)
    .order('created_at', { ascending: true });
  if (error) { console.error('loadComments:', error); return {}; }

  const result = {};
  for (const row of data) {
    if (!result[row.restaurant_id]) result[row.restaurant_id] = [];
    result[row.restaurant_id].push({
      id: row.id,
      text: row.text,
      author: row.user_name,
      timestamp: new Date(row.created_at).getTime(),
      parentId: row.parent_id,
    });
  }
  return result;
}

export async function addComment(restaurantId, userName, text, parentId = null) {
  const groupId = requireGroup();
  const id = 'c' + Date.now();
  const { error } = await sb()
    .from('comments')
    .insert({
      id,
      group_id: groupId,
      restaurant_id: restaurantId,
      user_name: userName,
      text,
      parent_id: parentId,
    });
  if (error) console.error('addComment:', error);
  return id;
}

// ── Custom Restaurants (shared within group) ──

export async function loadCustomRestaurants() {
  const groupId = requireGroup();
  const { data, error } = await sb()
    .from('custom_restaurants')
    .select('*')
    .eq('group_id', groupId)
    .order('created_at', { ascending: true });
  if (error) { console.error('loadCustom:', error); return []; }
  return data.map(row => ({ ...row.data, id: row.id, _createdBy: row.created_by }));
}

export async function addCustomRestaurant(restaurant, userName) {
  const groupId = requireGroup();
  const { id, ...rest } = restaurant;
  const { error } = await sb()
    .from('custom_restaurants')
    .insert({
      id,
      group_id: groupId,
      data: restaurant,
      created_by: userName,
    });
  if (error) console.error('addCustom:', error);
}

// ── Shared State (map filter, etc.) ──

export async function loadSharedState(key) {
  const groupId = requireGroup();
  const { data, error } = await sb()
    .from('shared_state')
    .select('value')
    .eq('group_id', groupId)
    .eq('key', key)
    .maybeSingle();
  if (error) return null;
  return data?.value;
}

export async function saveSharedState(key, value, userName) {
  const groupId = requireGroup();
  const { error } = await sb()
    .from('shared_state')
    .upsert({
      group_id: groupId,
      key,
      value,
      updated_by: userName,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'group_id,key' });
  if (error) console.error('saveSharedState:', error);
}

export async function deleteSharedState(key) {
  const groupId = requireGroup();
  const { error } = await sb()
    .from('shared_state')
    .delete()
    .eq('group_id', groupId)
    .eq('key', key);
  if (error) console.error('deleteSharedState:', error);
}
