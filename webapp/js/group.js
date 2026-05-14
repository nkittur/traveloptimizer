// group.js — Group context: resolve current group from URL, manage my-groups list.
// The group token is the credential. ?g=<token> in the URL = "I'm in this group".

import * as db from './supabase.js?v=1776965114';

const MY_GROUPS_KEY = 'my-groups'; // localStorage: [{id,name,city,lastVisitedAt,myName}]

let _current = null; // the full groups row for the active session

export function getGroupIdFromUrl() {
  return new URLSearchParams(location.search).get('g');
}

export function currentGroup() {
  return _current;
}

export function currentGroupId() {
  return _current?.id || null;
}

export async function resolveCurrentGroup() {
  const id = getGroupIdFromUrl();
  if (!id) return null;
  const g = await db.loadGroup(id);
  if (!g) return null;
  _current = g;
  db.setGroupId(id);
  return g;
}

// ── My groups (per-device list, stored in localStorage) ──

export function getMyGroups() {
  try {
    return JSON.parse(localStorage.getItem(MY_GROUPS_KEY)) || [];
  } catch { return []; }
}

export function rememberGroup(group, myName) {
  const list = getMyGroups();
  const existing = list.find(g => g.id === group.id);
  const entry = {
    id: group.id,
    name: group.name,
    cityName: group.city_name,
    lastVisitedAt: Date.now(),
    myName: myName || existing?.myName || null,
  };
  const next = [entry, ...list.filter(g => g.id !== group.id)];
  localStorage.setItem(MY_GROUPS_KEY, JSON.stringify(next));
}

export function forgetGroup(groupId) {
  const list = getMyGroups().filter(g => g.id !== groupId);
  localStorage.setItem(MY_GROUPS_KEY, JSON.stringify(list));
}

// ── Per-group user identity ──

export function getMyName(groupId) {
  const entry = getMyGroups().find(g => g.id === groupId);
  return entry?.myName || null;
}

export function setMyName(groupId, name) {
  const list = getMyGroups();
  const existing = list.find(g => g.id === groupId);
  if (existing) {
    existing.myName = name;
    existing.lastVisitedAt = Date.now();
    localStorage.setItem(MY_GROUPS_KEY, JSON.stringify(list));
  }
}
