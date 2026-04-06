// supabase.js — Supabase backend for shared state
// Config is loaded from window.__SUPABASE_URL and window.__SUPABASE_KEY
// set in index.html or via env

let _sb = null;

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

// ── User identification ──

export function getUser() {
  return localStorage.getItem('sd-user-name');
}

export function setUser(name) {
  localStorage.setItem('sd-user-name', name);
}

// ── Restaurant State (votes, shortlist, trash) ──

export async function loadAllState() {
  const { data, error } = await sb()
    .from('restaurant_state')
    .select('*');
  if (error) { console.error('loadAllState:', error); return {}; }

  // Group by restaurant_id, then by user
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
  const { error } = await sb()
    .from('restaurant_state')
    .upsert({
      restaurant_id: restaurantId,
      user_name: userName,
      ...updates,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'restaurant_id,user_name' });
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

// ── Comments (shared) ──

export async function loadAllComments() {
  const { data, error } = await sb()
    .from('comments')
    .select('*')
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
  const id = 'c' + Date.now();
  const { error } = await sb()
    .from('comments')
    .insert({
      id,
      restaurant_id: restaurantId,
      user_name: userName,
      text,
      parent_id: parentId,
    });
  if (error) console.error('addComment:', error);
  return id;
}

// ── Custom Restaurants (shared) ──

export async function loadCustomRestaurants() {
  const { data, error } = await sb()
    .from('custom_restaurants')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) { console.error('loadCustom:', error); return []; }
  return data.map(row => ({ ...row.data, id: row.id, _createdBy: row.created_by }));
}

// ── Shared State (map filter, etc.) ──

export async function loadSharedState(key) {
  const { data, error } = await sb()
    .from('shared_state')
    .select('value')
    .eq('key', key)
    .single();
  if (error) return null;
  return data?.value;
}

export async function saveSharedState(key, value, userName) {
  const { error } = await sb()
    .from('shared_state')
    .upsert({
      key,
      value,
      updated_by: userName,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
  if (error) console.error('saveSharedState:', error);
}

export async function deleteSharedState(key) {
  const { error } = await sb()
    .from('shared_state')
    .delete()
    .eq('key', key);
  if (error) console.error('deleteSharedState:', error);
}

export async function addCustomRestaurant(restaurant, userName) {
  const { id, ...rest } = restaurant;
  const { error } = await sb()
    .from('custom_restaurants')
    .insert({
      id,
      data: restaurant,
      created_by: userName,
    });
  if (error) console.error('addCustom:', error);
}
