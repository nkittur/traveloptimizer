// data.js — Data loading, merge, filtering
import * as local from './storage.js';
import * as db from './supabase.js';

let _restaurants = [];
let _customRestaurants = [];

export async function loadRestaurants() {
  const res = await fetch('./data/restaurants.json');
  _restaurants = await res.json();

  // Load custom restaurants from Supabase or localStorage
  if (db.isConfigured()) {
    _customRestaurants = await db.loadCustomRestaurants();
  } else {
    _customRestaurants = local.loadCustomRestaurants();
  }

  return getAllRestaurants();
}

export function getAllRestaurants() {
  return [..._restaurants, ..._customRestaurants];
}

export function yelpUrl(name, neighborhood) {
  const loc = (neighborhood || '') + ' San Diego CA';
  return `https://www.yelp.com/search?find_desc=${encodeURIComponent(name)}&find_loc=${encodeURIComponent(loc)}`;
}

export function mapsUrl(name, address) {
  const q = address ? `${name} ${address}` : name + ' San Diego CA';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export function generateId() {
  return 'custom-' + Date.now();
}
