// storage.js — localStorage abstraction with debounced saves
const KEYS = {
  userState: 'sd-user-state',
  shortlistOrder: 'sd-shortlist-order',
  customRestaurants: 'sd-custom-restaurants',
};

let _saveTimer = null;

function _debounce(fn, ms = 100) {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(fn, ms);
}

export function loadUserState() {
  try {
    return JSON.parse(localStorage.getItem(KEYS.userState)) || {};
  } catch { return {}; }
}

export function saveUserState(state) {
  _debounce(() => localStorage.setItem(KEYS.userState, JSON.stringify(state)));
}

export function loadShortlistOrder() {
  try {
    return JSON.parse(localStorage.getItem(KEYS.shortlistOrder)) || [];
  } catch { return []; }
}

export function saveShortlistOrder(order) {
  localStorage.setItem(KEYS.shortlistOrder, JSON.stringify(order));
}

export function loadCustomRestaurants() {
  try {
    return JSON.parse(localStorage.getItem(KEYS.customRestaurants)) || [];
  } catch { return []; }
}

export function saveCustomRestaurants(list) {
  localStorage.setItem(KEYS.customRestaurants, JSON.stringify(list));
}
