#!/usr/bin/env node
// generate-pareto.mjs — render a price-vs-performance Pareto chart (SVG) from products.json.
// Performance (y) = weighted NON-price score. Price (x) = live price.
// Plots every shortlisted finalist; the non-dominated frontier is drawn as a dashed line.
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const DIR = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(resolve(DIR, 'products.json'), 'utf8'));

function shortLabel(p) {
  const cap = p.specs?.capacity_pint_day_doe;
  if (/cube 20/i.test(p.name)) return 'Cube 20';
  if (/cube 35/i.test(p.name)) return 'Cube 35';
  if (/traditional/i.test(p.name)) return `Midea ${cap}`;
  return `${p.brand}${cap ? ' ' + cap : ''}`;
}

const pts = data.products
  .filter(p => p.status && p.status.startsWith('finalist') && p.price?.amount_usd && p.performance_score)
  .map(p => ({
    short: shortLabel(p), x: p.price.amount_usd, y: p.performance_score,
    pick: p.status === 'finalist-pick', runner: p.status === 'finalist-runner-up',
    frontier: !!p.pareto_frontier
  }))
  .sort((a, b) => a.x - b.x);

const W = 760, H = 520, M = { l: 60, r: 116, t: 54, b: 58 };
const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
const xMin = Math.min(...xs) - 12, xMax = Math.max(...xs) + 12;
const yMin = Math.min(...ys) - 0.12, yMax = Math.max(...ys) + 0.14;
const px = x => M.l + (x - xMin) / (xMax - xMin) * (W - M.l - M.r);
const py = y => H - M.b - (y - yMin) / (yMax - yMin) * (H - M.t - M.b);

const frontier = pts.filter(p => p.frontier).sort((a, b) => a.x - b.x);

const grid = [];
for (let gx = 160; gx <= xMax; gx += 20) grid.push(`<line x1="${px(gx)}" y1="${M.t}" x2="${px(gx)}" y2="${H - M.b}" stroke="#eef1f5"/><text x="${px(gx)}" y="${H - M.b + 18}" font-size="11" fill="#94a3b8" text-anchor="middle">$${gx}</text>`);
for (let gy = 3.6; gy <= yMax; gy += 0.2) grid.push(`<line x1="${M.l}" y1="${py(gy)}" x2="${W - M.r}" y2="${py(gy)}" stroke="#eef1f5"/><text x="${M.l - 8}" y="${py(gy) + 4}" font-size="11" fill="#94a3b8" text-anchor="end">${gy.toFixed(1)}</text>`);

const frontierPath = frontier.map((p, i) => `${i ? 'L' : 'M'}${px(p.x)},${py(p.y)}`).join(' ');

// Label placement: highlighted points label to the right; others alternate to reduce overlap.
const dots = pts.map((p, i) => {
  const color = p.pick ? '#16a34a' : p.runner ? '#2563eb' : p.frontier ? '#0891b2' : '#94a3b8';
  const r = p.pick ? 9 : p.runner ? 7 : p.frontier ? 6 : 5;
  const big = p.pick || p.runner || p.frontier;
  const lc = p.pick ? '#15803d' : p.runner ? '#1d4ed8' : p.frontier ? '#0e7490' : '#64748b';
  // place label: pick/frontier to the right; alternate others up/down-left to de-clutter
  let lx = px(p.x) + r + 5, ly = py(p.y) + 4, anchor = 'start';
  if (!big) { const up = i % 2 === 0; ly = py(p.y) + (up ? -9 : 15); lx = px(p.x); anchor = 'middle'; }
  const star = p.pick ? ' ★' : '';
  return `<circle cx="${px(p.x)}" cy="${py(p.y)}" r="${r}" fill="${color}" stroke="#fff" stroke-width="2"/>
    <text x="${lx}" y="${ly}" font-size="${big ? 12 : 11}" font-weight="${big ? 700 : 400}" fill="${lc}" text-anchor="${anchor}">${p.short}${star} <tspan fill="#94a3b8" font-weight="400">$${p.x}</tspan></text>`;
}).join('\n');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
  <rect width="${W}" height="${H}" fill="#fff"/>
  <text x="${M.l}" y="26" font-size="17" font-weight="700" fill="#0f172a">Price vs. Performance — ${pts.length} shortlisted of ${data.considered_count}</text>
  <text x="${M.l}" y="44" font-size="11" fill="#94a3b8">Performance = weighted non-price score (noise·2 + reliability·2 + energy·1.3 + capacity + drainage…). Up-and-left is better.</text>
  ${grid.join('\n')}
  <line x1="${M.l}" y1="${H - M.b}" x2="${W - M.r}" y2="${H - M.b}" stroke="#334155"/>
  <line x1="${M.l}" y1="${M.t}" x2="${M.l}" y2="${H - M.b}" stroke="#334155"/>
  <path d="${frontierPath}" fill="none" stroke="#16a34a" stroke-width="2" stroke-dasharray="6 4" opacity="0.6"/>
  ${dots}
  <text x="${(M.l + W - M.r) / 2}" y="${H - 12}" font-size="13" fill="#334155" text-anchor="middle">Live price (USD) → cheaper is left</text>
  <text transform="translate(18,${(M.t + H - M.b) / 2}) rotate(-90)" font-size="13" fill="#334155" text-anchor="middle">Performance (non-price)</text>
  <g transform="translate(${W - M.r + 10},${M.t + 8})" font-size="11">
    <circle cx="5" cy="4" r="6" fill="#16a34a"/><text x="16" y="8" fill="#0f172a" font-weight="700">Pick</text>
    <circle cx="5" cy="26" r="6" fill="#2563eb"/><text x="16" y="30" fill="#0f172a">Runner-up</text>
    <circle cx="5" cy="48" r="5" fill="#0891b2"/><text x="16" y="52" fill="#475569">Frontier</text>
    <circle cx="5" cy="70" r="4.5" fill="#94a3b8"/><text x="16" y="74" fill="#475569">Dominated</text>
  </g>
</svg>`;

writeFileSync(resolve(DIR, 'pareto.svg'), svg);
console.error(`✓ wrote pareto.svg (${pts.length} plotted, ${frontier.length} on frontier)`);
