#!/usr/bin/env node
// score-places: Score nearby places against family preferences, output interactive HTML
// Usage: node tools/score-places.mjs <places.json>
//    or: node tools/nearby-places.mjs "query" "location" | node tools/score-places.mjs
//
// Reads profile/family.json for preference matching.
// Outputs a mobile-first HTML with interactive map + scored cards with query-specific insights.

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// --- Load API key ---
let API_KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!API_KEY) {
  try {
    const envFile = readFileSync(resolve(REPO_ROOT, '.env'), 'utf-8');
    const match = envFile.match(/GOOGLE_MAPS_API_KEY=(.+)/);
    if (match) API_KEY = match[1].trim();
  } catch {}
}

// --- Load profile ---
let profile;
try {
  profile = JSON.parse(readFileSync(resolve(REPO_ROOT, 'profile/family.json'), 'utf-8'));
} catch {
  console.error('Warning: Could not read profile/family.json');
  profile = {};
}

// --- Read input ---
let input;
const inputFile = process.argv[2];
if (inputFile) {
  input = readFileSync(inputFile, 'utf-8');
} else {
  input = readFileSync('/dev/stdin', 'utf-8');
}

const data = JSON.parse(input);
if (!data.places || !Array.isArray(data.places)) {
  console.error('Invalid input: expected { places: [...] }');
  process.exit(1);
}

// --- Parse query intent ---
// Extract what the user is actually looking for from the query
function parseQueryIntent(query) {
  const q = (query || '').toLowerCase();
  const intents = [];

  const intentMap = [
    { keywords: ['outdoor', 'patio', 'outside', 'terrace', 'garden'], intent: 'outdoor', label: 'Outdoor seating', field: 'outdoor_seating' },
    { keywords: ['beer', 'brew', 'tap', 'draft', 'ale', 'ipa'], intent: 'beer', label: 'Beer', field: 'serves_beer' },
    { keywords: ['coffee', 'cafe', 'café', 'espresso', 'latte'], intent: 'coffee', label: 'Coffee', field: 'serves_coffee' },
    { keywords: ['cocktail', 'drinks', 'bar', 'mixology'], intent: 'cocktails', label: 'Cocktails', field: 'serves_cocktails' },
    { keywords: ['wine', 'vineyard', 'vino'], intent: 'wine', label: 'Wine', field: 'serves_wine' },
    { keywords: ['music', 'live', 'entertainment', 'band'], intent: 'music', label: 'Live music', field: 'live_music' },
    { keywords: ['dog', 'pet'], intent: 'dogs', label: 'Dog-friendly', field: 'allows_dogs' },
    { keywords: ['food', 'eat', 'restaurant', 'dinner', 'lunch', 'brunch', 'bite'], intent: 'food', label: 'Food', field: null },
  ];

  for (const im of intentMap) {
    if (im.keywords.some(kw => q.includes(kw))) {
      intents.push(im);
    }
  }

  return intents;
}

// --- Score and annotate each place ---
function haversine(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat/2)**2 + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}

function scorePlaces(places, locationBias, intents) {
  const distances = places.map(p => haversine(locationBias, p.location));
  const maxDist = Math.max(...distances.filter(d => d < Infinity)) || 1;

  const ratings = places.map(p => p.rating).filter(r => r != null);
  const minRating = Math.min(...ratings) || 0;
  const maxRating = Math.max(...ratings) || 5;

  return places.map((p, i) => {
    const dist = distances[i];
    const distKm = dist < Infinity ? Math.round(dist * 10) / 10 : null;
    const driveMin = distKm != null ? Math.round(distKm * 1.5) : null;

    // Score each intent (what the user asked for)
    const intentResults = [];
    let intentScore = 0;
    let intentCount = 0;

    for (const intent of intents) {
      if (intent.field) {
        const val = p[intent.field];
        const hit = val === true;
        const miss = val === false;
        const unknown = val === null || val === undefined;
        intentResults.push({ ...intent, hit, miss, unknown });
        intentScore += hit ? 1 : miss ? 0 : 0.3;
        intentCount++;
      }
    }

    const intentMatch = intentCount > 0 ? intentScore / intentCount : 0.5;

    // Quality score (rating normalized)
    const ratingNorm = p.rating != null ? (p.rating - minRating) / ((maxRating - minRating) || 1) : 0.3;

    // Proximity score (inverse distance)
    const proxScore = dist < Infinity ? Math.max(0, 1 - dist / maxDist) : 0;

    // Overall weighted: intent match matters most (50%), proximity (30%), rating (20%)
    const overall = intentMatch * 0.5 + proxScore * 0.3 + ratingNorm * 0.2;

    // Categorize match type
    const hitCount = intentResults.filter(r => r.hit).length;
    const missCount = intentResults.filter(r => r.miss).length;
    let matchType, matchLabel;
    if (hitCount === intentResults.length) {
      matchType = 'perfect'; matchLabel = 'Exactly what you want';
    } else if (missCount === 0) {
      matchType = 'likely'; matchLabel = 'Probably good';
    } else if (hitCount > missCount) {
      matchType = 'partial'; matchLabel = 'Partial match';
    } else {
      matchType = 'alternative'; matchLabel = 'Different vibe';
    }

    // Build WHY lines (specific to query)
    const pros = [];
    const cons = [];

    // Distance insight
    if (distKm != null) {
      if (distKm < 2) pros.push(driveMin <= 1 ? 'Walking distance' : driveMin + ' min drive');
      else if (distKm < 5) pros.push(driveMin + ' min drive');
      else cons.push(driveMin + ' min away');
    }

    // Intent-specific insights
    for (const ir of intentResults) {
      if (ir.hit) pros.push(ir.label);
      else if (ir.miss) cons.push('No ' + ir.label.toLowerCase());
    }

    // Rating insight
    if (p.rating >= 4.6) pros.push('Highly rated (' + p.rating + ')');
    else if (p.rating && p.rating < 4.0) cons.push('Lower rated (' + p.rating + ')');

    // Description-based insight (use the editorial summary if it adds color)
    if (p.description) {
      // Extract the most interesting phrase from description
      const desc = p.description;
      if (desc.length < 80) pros.push(desc);
    }

    // Open/closed
    if (p.open_now === false) cons.push('Currently closed');
    if (p.open_now === true && p.today_hours) {
      // Extract closing time
      const closeMatch = p.today_hours.match(/(\d+:\d+\s*(?:AM|PM))\s*$/i);
      if (closeMatch) pros.push('Open until ' + closeMatch[1]);
    }

    return {
      ...p,
      _distKm: distKm,
      _driveMin: driveMin,
      _overall: overall,
      _matchType: matchType,
      _matchLabel: matchLabel,
      _pros: pros,
      _cons: cons,
      _intentResults: intentResults,
    };
  }).sort((a, b) => b._overall - a._overall);
}

const intents = parseQueryIntent(data.query);
const scored = scorePlaces(data.places, data.location_bias, intents);

// --- Build embedded data ---
const embeddedData = {
  scored,
  query: data.query,
  locationBias: data.location_bias,
  intents: intents.map(i => ({ intent: i.intent, label: i.label, field: i.field })),
  apiKey: API_KEY,
};

// --- Generate HTML ---
function generateHTML(embedded) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Scored: ${(embedded.query || 'Places').replace(/"/g, '')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{font-family:'Inter',system-ui,sans-serif;background:#f0f4f8;color:#1a2332;line-height:1.5;overflow-x:hidden}

.header{background:linear-gradient(135deg,#1a3a5c 0%,#2a6496 50%,#3a85c4 100%);color:#fff;padding:16px 16px 12px;position:sticky;top:0;z-index:100}
.header h1{font-size:15px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.header .sub{font-size:12px;color:#a8cce8;margin-top:2px}
.intent-chips{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
.intent-chip{font-size:11px;font-weight:600;padding:3px 10px;border-radius:10px;background:rgba(255,255,255,0.15);color:#e0ecf5;border:1px solid rgba(255,255,255,0.25)}

#map{width:100%;height:35vh;min-height:180px;background:#dde6ed}

.section-label{padding:12px 12px 4px;font-size:13px;font-weight:700;color:#1a3a5c;text-transform:uppercase;letter-spacing:0.5px}
.section-label .count{font-weight:400;color:#5a6b7d;text-transform:none;letter-spacing:0}

.card{background:#fff;border-radius:14px;padding:14px;margin:0 10px 10px;box-shadow:0 1px 3px rgba(0,0,0,0.06),0 2px 8px rgba(0,0,0,0.04);border:2px solid transparent;transition:border-color 0.15s;cursor:pointer}
.card.selected{border-color:#2a6496}
.card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.card-name{font-size:15px;font-weight:700;color:#1a2332;flex:1}
.card-score{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0}
.card-meta{font-size:12px;color:#5a6b7d;margin-top:2px;display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.card-meta .dot{color:#d1d5db}
.card-meta .open{color:#059669;font-weight:600}
.card-meta .closed{color:#991b1b;font-weight:600}

.match-tag{display:inline-block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;padding:2px 8px;border-radius:6px;margin-top:6px}
.match-tag.perfect{background:#ecfdf5;color:#059669}
.match-tag.likely{background:#eff6ff;color:#1e40af}
.match-tag.partial{background:#fef9ee;color:#b45309}
.match-tag.alternative{background:#f3f4f6;color:#6b7280}

.insights{margin-top:8px;font-size:12px;line-height:1.6}
.pro{color:#059669}
.pro::before{content:'+';font-weight:700;margin-right:4px}
.con{color:#b45309}
.con::before{content:'-';font-weight:700;margin-right:4px}

.card-addr{font-size:11px;color:#94a3b8;margin-top:6px}

.footer{text-align:center;padding:24px;font-size:11px;color:#94a3b8}

@media(min-width:641px){
  .card{margin:0 auto 10px;max-width:600px}
  .section-label{max-width:600px;margin:0 auto}
}
</style>
</head>
<body>

<div class="header">
  <h1 id="hTitle"></h1>
  <div class="sub" id="hSub"></div>
  <div class="intent-chips" id="hChips"></div>
</div>
<div id="map"></div>
<div id="content"></div>
<div class="footer">TravelOptimizer &middot; Scored via Google Places API</div>

<script>
const DATA = ${JSON.stringify(embedded, null, 0)};

// === INIT HEADER ===
document.getElementById('hTitle').textContent = DATA.query || 'Scored Places';
document.getElementById('hSub').textContent = DATA.scored.length + ' places scored';
const chips = document.getElementById('hChips');
DATA.intents.forEach(function(intent) {
  const c = document.createElement('span');
  c.className = 'intent-chip';
  c.textContent = intent.label;
  chips.appendChild(c);
});

// === HELPERS ===
function esc(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function scoreColor(s) { return 'hsl(' + (s * 120) + ',75%,42%)'; }
function haversine(a, b) {
  if (!a || !b) return Infinity;
  var R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  var x = Math.pow(Math.sin(dLat/2),2) + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.pow(Math.sin(dLng/2),2);
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}

var selectedIndex = 0;
var map = null;
var markers = [];

// === RENDER CARDS ===
function render() {
  var content = document.getElementById('content');
  content.innerHTML = '';

  // Group by match type
  var groups = { perfect: [], likely: [], partial: [], alternative: [] };
  DATA.scored.forEach(function(p, i) { (groups[p._matchType] || groups.alternative).push({ p: p, i: i }); });

  var labels = {
    perfect: 'Exactly what you asked for',
    likely: 'Probably a good fit',
    partial: 'Partial match',
    alternative: 'Different vibe but interesting'
  };

  var order = ['perfect', 'likely', 'partial', 'alternative'];
  var globalRank = 0;

  order.forEach(function(type) {
    var items = groups[type];
    if (!items.length) return;

    var label = document.createElement('div');
    label.className = 'section-label';
    label.innerHTML = labels[type] + ' <span class="count">(' + items.length + ')</span>';
    content.appendChild(label);

    items.forEach(function(item) {
      globalRank++;
      var p = item.p;
      var i = item.i;
      var card = document.createElement('div');
      card.className = 'card' + (selectedIndex === i ? ' selected' : '');
      card.id = 'place-' + i;
      card.onclick = function() { selectPlace(i); };

      var distStr = '';
      if (p._distKm != null) {
        distStr = p._distKm < 1 ? Math.round(p._distKm * 1000) + 'm' : p._distKm + 'km';
      }

      var insightsHtml = '';
      p._pros.forEach(function(pro) { insightsHtml += '<div class="pro">' + esc(pro) + '</div>'; });
      p._cons.forEach(function(con) { insightsHtml += '<div class="con">' + esc(con) + '</div>'; });

      card.innerHTML =
        '<div class="card-top">' +
          '<div>' +
            '<div class="card-name">' + globalRank + '. ' + esc(p.name) + '</div>' +
            '<div class="card-meta">' +
              (p.rating ? '<span style="font-weight:600">\\u2605 ' + p.rating + '</span><span class="dot">\\u00b7</span>' : '') +
              (p.review_count ? '<span>' + p.review_count.toLocaleString() + '</span><span class="dot">\\u00b7</span>' : '') +
              (distStr ? '<span>' + distStr + '</span><span class="dot">\\u00b7</span>' : '') +
              (p.type ? '<span>' + esc(p.type) + '</span>' : '') +
              (p.open_now === true ? '<span class="dot">\\u00b7</span><span class="open">Open</span>' : '') +
              (p.open_now === false ? '<span class="dot">\\u00b7</span><span class="closed">Closed</span>' : '') +
            '</div>' +
          '</div>' +
          '<div class="card-score" style="background:' + scoreColor(p._overall) + '">' + Math.round(p._overall * 100) + '</div>' +
        '</div>' +
        '<div class="insights">' + insightsHtml + '</div>' +
        (p.address ? '<div class="card-addr">' + esc(p.address) + '</div>' : '');

      content.appendChild(card);
    });
  });
}

function selectPlace(i) {
  selectedIndex = i;
  var p = DATA.scored[i];
  if (map && p.location) {
    map.panTo({ lat: p.location.lat, lng: p.location.lng });
    map.setZoom(15);
  }
  updateMarkers();
  render();
  var el = document.getElementById('place-' + i);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// === MAP ===
function initMap() {
  if (!DATA.apiKey || !DATA.locationBias) return;
  map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: DATA.locationBias.lat, lng: DATA.locationBias.lng },
    zoom: 13, disableDefaultUI: true, zoomControl: true, gestureHandling: 'greedy'
  });
  var bounds = new google.maps.LatLngBounds();
  DATA.scored.forEach(function(p, i) {
    if (!p.location) return;
    var pos = { lat: p.location.lat, lng: p.location.lng };
    bounds.extend(pos);
    var marker = new google.maps.Marker({
      position: pos, map: map, title: p.name,
      icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: scoreColor(p._overall), fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2, scale: 10 },
      label: { text: String(i + 1), color: '#fff', fontSize: '11px', fontWeight: '700' },
      zIndex: Math.round(p._overall * 100)
    });
    marker.addListener('click', function() { selectPlace(i); });
    markers[i] = marker;
  });
  if (DATA.scored.length > 1) map.fitBounds(bounds, 40);
}

function updateMarkers() {
  markers.forEach(function(marker, i) {
    if (!marker) return;
    var p = DATA.scored[i];
    marker.setIcon({
      path: google.maps.SymbolPath.CIRCLE,
      fillColor: scoreColor(p._overall), fillOpacity: 1,
      strokeColor: selectedIndex === i ? '#1a3a5c' : '#fff',
      strokeWeight: selectedIndex === i ? 3 : 2,
      scale: selectedIndex === i ? 14 : 10
    });
    marker.setZIndex(selectedIndex === i ? 999 : Math.round(p._overall * 100));
  });
}

// === GO ===
try { render(); } catch(e) {
  document.getElementById('content').innerHTML = '<div style="padding:20px;color:red">' + e.message + '<br><pre>' + e.stack + '</pre></div>';
}
</script>
${API_KEY ? `<script>
function onMapsLoaded() { try { initMap(); updateMarkers(); } catch(e) { console.error(e); } }
</script>
<script src="https://maps.googleapis.com/maps/api/js?key=${API_KEY}&callback=onMapsLoaded" async defer></script>` : ''}
</body>
</html>`;
}

// --- Output ---
const html = generateHTML(embeddedData);
const outFile = resolve(REPO_ROOT, 'trips', 'scored-places.html');
writeFileSync(outFile, html);
console.error(`Written: ${outFile}`);

try {
  if (process.platform === 'darwin') execSync(`open "${outFile}"`);
  else execSync(`xdg-open "${outFile}"`);
  console.error('Opened in browser.');
} catch {}
