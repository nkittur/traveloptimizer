// data.js — Data loading, merge, filtering
import * as db from './supabase.js?v=1776965114';

let _restaurants = [];
let _customRestaurants = [];
let _cityCtx = { name: '', country: '' };

export function setCityContext({ name, country }) {
  _cityCtx = { name: name || '', country: country || '' };
}

export async function loadRestaurants() {
  _restaurants = await db.loadGroupRestaurants();
  _customRestaurants = await db.loadCustomRestaurants();
  return getAllRestaurants();
}

export function getAllRestaurants() {
  return [..._restaurants, ..._customRestaurants];
}

function locSuffix(neighborhood) {
  const parts = [neighborhood, _cityCtx.name, _cityCtx.country].filter(Boolean);
  return parts.join(' ');
}

export function yelpUrl(name, neighborhood) {
  return `https://www.yelp.com/search?find_desc=${encodeURIComponent(name)}&find_loc=${encodeURIComponent(locSuffix(neighborhood))}`;
}

export function mapsUrl(name, address) {
  const q = address ? `${name} ${address}` : `${name} ${locSuffix(null)}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export function generateId() {
  return 'custom-' + Date.now();
}
