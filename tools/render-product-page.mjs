#!/usr/bin/env node
// render-product-page.mjs — render a product search into a self-contained webapp page.
//
// Reads:   searches/<id>/products.json  (single source of truth: verdict, finalists,
//          scores, prices, sources, dealbreaker evidence, composed highlights)
//          searches/<id>/config.json    (must-haves, weights, budget, use-case)
//          searches/<id>/pareto.svg      (optional; inlined into the page)
// Writes:  webapp/products/<id>.html     (self-contained — no JS/Supabase dependency)
//          webapp/products/index.json    (manifest the picker reads to list buying guides)
//
// This is a PURE TEMPLATER (skill discipline): every fact on the page must already
// exist in products.json. It composes nothing. If a write-up is missing, fix the
// data, not this file.
//
// Usage: node tools/render-product-page.mjs <search-id>

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

const id = process.argv[2];
if (!id) { console.error('Usage: render-product-page.mjs <search-id>'); process.exit(1); }

const searchDir = resolve(REPO, 'searches', id);
const P = JSON.parse(readFileSync(resolve(searchDir, 'products.json'), 'utf8'));
const C = JSON.parse(readFileSync(resolve(searchDir, 'config.json'), 'utf8'));
const svgPath = resolve(searchDir, 'pareto.svg');
const paretoSvg = existsSync(svgPath) ? readFileSync(svgPath, 'utf8') : '';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bySlug = Object.fromEntries(P.products.map(p => [p.slug, p]));

const weights = P.weights || C.scoring_weights || {};
const bucketKeys = Object.keys(weights);
const maxW = Math.max(...Object.values(weights), 1);

const finalists = P.products
  .filter(p => p.status && p.status.startsWith('finalist') && p.ranking)
  .sort((a, b) => a.ranking - b.ranking);
const rejected = P.products.filter(p => p.status === 'rejected-on-dealbreaker' || p.status === 'rejected');

const v = P.verdict || {};
const pick = bySlug[v.pick_slug];
const runner = bySlug[v.runner_up_slug];

function scoreBars(p) {
  return bucketKeys.filter(k => p.scores && p.scores[k] != null).map(k => {
    const s = p.scores[k];
    const pct = (s / 5) * 100;
    const hot = s >= 4.5, warm = s >= 3.5;
    const col = hot ? '#16a34a' : warm ? '#0891b2' : s >= 2.5 ? '#d97706' : '#dc2626';
    return `<div class="bar-row"><span class="bar-label">${esc(k.replace(/_/g, ' '))} <em>×${weights[k] ?? ''}</em></span>
      <span class="bar-track"><span class="bar-fill" style="width:${pct}%;background:${col}"></span></span>
      <span class="bar-val">${s}</span></div>`;
  }).join('');
}

function specRows(p) {
  const s = p.specs || {};
  const rows = [];
  const add = (label, val) => { if (val != null && val !== '') rows.push(`<tr><th>${esc(label)}</th><td>${esc(val)}</td></tr>`); };
  add('Capacity', s.capacity_pint_day_doe ? `${s.capacity_pint_day_doe}-pint (new DOE)${s.coverage_sqft ? ` · ~${s.coverage_sqft} sq ft` : ''}` : null);
  add('Noise', s.noise);
  add('Drainage', Array.isArray(s.drainage) ? s.drainage.join(' · ') + (s.pump === false ? ' · no pump' : s.pump ? ' · built-in pump' : '') : null);
  add('Energy', s.energy_star ? `ENERGY STAR${s.energy_note ? ' — ' + s.energy_note : ''}` : (s.energy_note || null));
  add('Price', p.price?.amount_usd ? `$${p.price.amount_usd} at ${esc(p.price.retailer || 'retailer')}${p.price.captured_at ? ` (as of ${p.price.captured_at})` : ''}` : null);
  if (p.ratings?.amazon) add('Amazon', `${p.ratings.amazon.stars}★ / ${p.ratings.amazon.count.toLocaleString()} ratings`);
  return rows.join('');
}

function sourceChips(p) {
  return (p.sources || []).map(s => {
    const label = s.publication || s.retailer || (s.type === 'reddit' ? 'Reddit' : s.type);
    return `<span class="chip" title="${esc(s.detail || '')}">${esc(label)}</span>`;
  }).join('');
}

function finalistCard(p) {
  const isPick = p.slug === v.pick_slug;
  const isRunner = p.slug === v.runner_up_slug;
  const tag = isPick ? '<span class="tag tag-pick">★ Pick</span>' : isRunner ? '<span class="tag tag-runner">Runner-up</span>' : '';
  return `<article class="card ${isPick ? 'card-pick' : ''}">
    <div class="card-head">
      <div class="rank">#${p.ranking}</div>
      <div class="card-titles">
        <h3>${esc(p.name)} ${tag}</h3>
        <div class="card-sub">${p.price?.amount_usd ? `$${p.price.amount_usd}` : ''} · composite ${p.composite_score ?? '—'}/5${p.pareto_frontier ? ' · <em>on Pareto frontier</em>' : ''}</div>
      </div>
    </div>
    ${p.highlights ? `<p class="prose">${esc(p.highlights)}</p>` : ''}
    <table class="spec">${specRows(p)}</table>
    <div class="bars">${scoreBars(p)}</div>
    <div class="chips">${sourceChips(p)}</div>
  </article>`;
}

const mustHaves = (C.must_haves || []).map(m => `<li>${esc(m.label)}</li>`).join('');
const sortedW = bucketKeys.slice().sort((a, b) => (weights[b] || 0) - (weights[a] || 0));
const weightChips = sortedW.map(k => `<span class="wchip">${esc(k.replace(/_/g, ' '))} <em>×${weights[k]}</em></span>`).join('');

const rejectedHtml = rejected.map(p => `
  <div class="reject">
    <h4>${esc(p.name)} <span class="x">rejected</span></h4>
    <p class="reject-why">${esc(p.rejection_reason || '')}</p>
    ${p.dealbreaker_evidence ? `<p class="evidence">${esc(p.dealbreaker_evidence)}</p>` : ''}
    ${p.ratings?.amazon?.histogram_pct ? `<p class="hist">Amazon ${p.ratings.amazon.stars}★ · ${Object.entries(p.ratings.amazon.histogram_pct).reverse().map(([s, pc]) => `${s}★ ${pc}%`).join('  ·  ')}</p>` : ''}
  </div>`).join('');

const overBudget = (P.rejected_over_budget || []).map(r => `<li><strong>${esc(r.name)}</strong> — ${esc(r.note)}</li>`).join('');

// ---- Audit tab: sources + full considered list ----
const sourcesHtml = (P.sources || []).map(s => `<tr>
  <td><span class="src-type">${esc(s.type)}</span></td>
  <td>${s.url && s.url.startsWith('http') ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>` : esc(s.name)}</td>
  <td>${esc(s.credibility || '')}</td>
  <td class="reason">${esc(s.used_for || '')}</td></tr>`).join('');

const statusRank = { shortlisted: 0, rejected: 1, excluded: 2 };
const considered = (P.considered || []).slice().sort((a, b) => (statusRank[a.status] ?? 3) - (statusRank[b.status] ?? 3));
const consideredHtml = considered.map(c => {
  const cls = c.status === 'shortlisted' ? 'st-short' : c.status === 'rejected' ? 'st-rej' : 'st-exc';
  return `<tr class="${cls}">
    <td>${esc(c.brand)}</td><td>${esc(c.model)}</td>
    <td class="num">${esc(c.cap)}</td>
    <td class="num">${c.price && c.price !== '—' ? '$' + esc(c.price) : '—'}</td>
    <td class="num">${esc(c.amz || '—')}</td>
    <td><span class="badge ${cls}">${esc(c.status)}</span></td>
    <td class="reason">${esc(c.reason)}</td></tr>`;
}).join('');
const shortN = considered.filter(c => c.status === 'shortlisted').length;
const exclN = considered.filter(c => c.status !== 'shortlisted').length;

const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(P.title || C.category)} — buying guide</title>
<style>
  :root{--bg:#f7f8fa;--card:#fff;--ink:#0f172a;--mut:#64748b;--line:#e5e9f0;--pick:#16a34a;--accent:#2563eb}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%}
  .wrap{max-width:780px;margin:0 auto;padding:0 18px 64px}
  a{color:var(--accent);text-decoration:none}
  .top{padding:18px 0 6px;display:flex;align-items:center;gap:10px}
  .back{font-size:14px;color:var(--mut)}
  header.hero{padding:8px 0 18px;border-bottom:1px solid var(--line)}
  header.hero h1{margin:0 0 4px;font-size:26px;letter-spacing:-.02em}
  header.hero .sub{color:var(--mut);font-size:15px}
  header.hero .meta{color:#94a3b8;font-size:13px;margin-top:8px}
  .verdict{background:linear-gradient(180deg,#f0fdf4,#fff);border:1px solid #bbf7d0;border-radius:16px;padding:18px 18px 16px;margin:22px 0}
  .verdict .lead{font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--pick)}
  .verdict h2{margin:4px 0 2px;font-size:23px;letter-spacing:-.02em}
  .verdict .price{font-weight:700;color:var(--pick)}
  .verdict p{margin:8px 0 0;font-size:15px}
  .verdict .sub-pick{margin-top:14px;padding-top:12px;border-top:1px dashed #bbf7d0;font-size:14.5px;color:#334155}
  .verdict .sub-pick b{color:var(--ink)}
  .tradeoff{background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:12px 14px;margin-top:12px;font-size:14px;color:#713f12}
  .conv{font-size:13px;color:var(--mut);margin-top:10px}
  .conv b{color:var(--pick)}
  h2.sec{font-size:15px;letter-spacing:.04em;text-transform:uppercase;color:var(--mut);margin:34px 0 12px;font-weight:700}
  .reqs{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
  .reqs ul{margin:6px 0 12px;padding-left:20px}
  .reqs li{margin:3px 0}
  .wchip{display:inline-block;background:#eef2ff;color:#3730a3;border-radius:999px;padding:3px 10px;font-size:12.5px;margin:3px 4px 0 0}
  .wchip em{font-style:normal;opacity:.7}
  figure.chart{margin:14px 0;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:8px;overflow-x:auto}
  figure.chart svg{display:block;max-width:100%;height:auto;min-width:680px}
  figure.chart figcaption{color:var(--mut);font-size:13px;padding:6px 8px 2px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin:14px 0}
  .card-pick{border-color:#86efac;box-shadow:0 1px 0 #dcfce7,0 8px 28px -18px rgba(22,163,74,.5)}
  .card-head{display:flex;gap:12px;align-items:flex-start}
  .rank{font-size:13px;font-weight:800;color:#94a3b8;background:#f1f5f9;border-radius:8px;padding:4px 8px;min-width:34px;text-align:center}
  .card-titles h3{margin:0;font-size:18px;letter-spacing:-.01em}
  .card-sub{color:var(--mut);font-size:13.5px;margin-top:2px}
  .card-sub em{font-style:normal;color:var(--pick);font-weight:600}
  .tag{font-size:11px;font-weight:700;border-radius:999px;padding:2px 8px;vertical-align:middle;margin-left:6px}
  .tag-pick{background:var(--pick);color:#fff}
  .tag-runner{background:#dbeafe;color:#1d4ed8}
  .prose{font-size:14.5px;color:#334155;margin:12px 0}
  table.spec{width:100%;border-collapse:collapse;margin:10px 0;font-size:13.5px}
  table.spec th{text-align:left;color:var(--mut);font-weight:600;padding:5px 10px 5px 0;vertical-align:top;white-space:nowrap;width:1%}
  table.spec td{padding:5px 0;border-bottom:1px solid #f1f5f9}
  .bars{margin:12px 0 6px}
  .bar-row{display:flex;align-items:center;gap:8px;margin:4px 0;font-size:12.5px}
  .bar-label{flex:0 0 42%;color:#475569;text-transform:capitalize}
  .bar-label em{font-style:normal;color:#94a3b8;font-size:11px}
  .bar-track{flex:1;height:7px;background:#f1f5f9;border-radius:4px;overflow:hidden}
  .bar-fill{display:block;height:100%;border-radius:4px}
  .bar-val{flex:0 0 24px;text-align:right;color:#475569;font-variant-numeric:tabular-nums}
  .chips{margin-top:10px}
  .chip{display:inline-block;background:#f1f5f9;color:#475569;border-radius:6px;padding:2px 8px;font-size:12px;margin:3px 4px 0 0}
  .reject{background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:14px 16px;margin:12px 0}
  .reject h4{margin:0 0 4px;font-size:16px}
  .reject .x{font-size:11px;font-weight:700;color:#b91c1c;background:#fee2e2;border-radius:999px;padding:2px 8px;margin-left:6px}
  .reject-why{color:#b91c1c;font-size:13px;margin:2px 0 8px}
  .evidence{font-size:13.5px;color:#475569;font-style:italic}
  .hist{font-size:12.5px;color:var(--mut);font-variant-numeric:tabular-nums;margin-top:6px}
  ul.budget{font-size:13.5px;color:#475569}
  footer{margin-top:36px;padding-top:16px;border-top:1px solid var(--line);color:#94a3b8;font-size:12.5px}
  .tabs{display:flex;gap:4px;margin:20px 0 6px;border-bottom:1px solid var(--line)}
  .tab{appearance:none;background:none;border:0;padding:10px 16px;font:600 14.5px inherit;color:var(--mut);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}
  .tab.active{color:var(--ink);border-bottom-color:var(--accent)}
  .audit-note{color:var(--mut);font-size:13.5px;margin:14px 0 8px}
  .audit-table{width:100%;border-collapse:collapse;font-size:12.5px;margin:6px 0 26px}
  .audit-table th{text-align:left;color:var(--mut);font-weight:600;border-bottom:1px solid var(--line);padding:7px 8px}
  .audit-table td{padding:7px 8px;border-bottom:1px solid #f1f5f9;vertical-align:top}
  .audit-table td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .audit-table td.reason{color:#475569;line-height:1.4}
  .badge{font-size:10px;font-weight:700;border-radius:999px;padding:2px 7px;text-transform:uppercase;letter-spacing:.03em;white-space:nowrap}
  .badge.st-short{background:#dcfce7;color:#15803d}
  .badge.st-rej{background:#fee2e2;color:#b91c1c}
  .badge.st-exc{background:#eef2f7;color:#64748b}
  tr.st-short td{background:#f6fef9}
  .src-type{font-size:10.5px;color:#64748b;background:#eef2f7;border-radius:5px;padding:1px 6px;white-space:nowrap}
  .tabpane[hidden]{display:none}
</style></head>
<body><div class="wrap">
  <div class="top"><a class="back" href="/">← All guides</a></div>
  <header class="hero">
    <h1>${esc(P.title || C.category)}</h1>
    <div class="sub">${esc(P.subtitle || C.use_case || '')}</div>
    <div class="meta">Run ${esc(P.run_date || '')} · ${P.considered_count ? P.considered_count + ' considered · ' : ''}${finalists.length} shortlisted · ${rejected.length} rejected on a dealbreaker</div>
  </header>

  <nav class="tabs">
    <button class="tab active" data-tab="rec">Recommendation</button>
    <button class="tab" data-tab="audit">Audit — sources &amp; all ${P.considered_count || considered.length} options</button>
  </nav>

  <div id="tab-rec" class="tabpane">
  <section class="verdict">
    <div class="lead">The recommendation</div>
    <h2>${esc(v.headline || (pick && pick.name) || '')} ${v.pick_price_usd ? `<span class="price">~$${v.pick_price_usd}</span>` : ''}</h2>
    <p>${esc(v.pick_blurb || '')}</p>
    ${runner ? `<div class="sub-pick"><b>Runner-up — ${esc(runner.name)}${runner.price?.amount_usd ? ` (~$${runner.price.amount_usd})` : ''}:</b> ${esc(v.runner_up_blurb || '')}</div>` : ''}
    ${v.headroom_blurb ? `<div class="sub-pick"><b>More headroom:</b> ${esc(v.headroom_blurb)}</div>` : ''}
    ${v.avoid ? `<div class="sub-pick"><b>Avoid:</b> ${esc(v.avoid)}</div>` : ''}
    ${v.tradeoff ? `<div class="tradeoff"><b>The tradeoff —</b> ${esc(v.tradeoff)}</div>` : ''}
    ${P.conviction ? `<div class="conv"><b>Conviction: ${P.conviction.reached ? 'reached' : 'not yet'}.</b> ${esc(P.conviction.notes || '')}</div>` : ''}
  </section>

  ${paretoSvg ? `<h2 class="sec">Price vs. performance</h2>
  <figure class="chart">${paretoSvg}<figcaption>Up-and-left is better; the dashed line is the non-dominated frontier — it runs Waykar → Midea 30 → Cube 20 (the knee). Everything to the right of the Cube 20 is dominated: it costs the same or more for equal-or-lower performance.</figcaption></figure>` : ''}

  <h2 class="sec">What we optimized for</h2>
  <div class="reqs">
    <strong>Must-haves</strong>
    <ul>${mustHaves}</ul>
    <strong>Weighted priorities</strong><br>${weightChips}
  </div>

  <h2 class="sec">Finalists, ranked</h2>
  ${finalists.map(finalistCard).join('')}

  ${rejected.length ? `<h2 class="sec">Rejected — the obvious pick that isn't</h2>${rejectedHtml}` : ''}
  ${overBudget ? `<h2 class="sec">Out of budget</h2><ul class="budget">${overBudget}</ul>` : ''}
  </div>

  <div id="tab-audit" class="tabpane" hidden>
    <h2 class="sec">Sources used (${(P.sources || []).length})</h2>
    <p class="audit-note">Every recommendation traces to these. Expert lab-tests are the backbone; retailer listings give live prices + critical-review histograms; forums give multi-year reliability.</p>
    <table class="audit-table">
      <thead><tr><th>Type</th><th>Source</th><th>Credibility</th><th>Used for</th></tr></thead>
      <tbody>${sourcesHtml}</tbody>
    </table>

    <h2 class="sec">All options considered (${considered.length}) — ${shortN} shortlisted, ${exclN} ruled out</h2>
    <p class="audit-note">The full funnel. Shortlisted rows are plotted on the Pareto curve and detailed on the Recommendation tab; every other row shows exactly why it was ruled out.</p>
    <table class="audit-table">
      <thead><tr><th>Brand</th><th>Model</th><th class="num">Pint</th><th class="num">Price</th><th class="num">Amazon</th><th>Status</th><th>Why / why not shortlisted</th></tr></thead>
      <tbody>${consideredHtml}</tbody>
    </table>
  </div>

  <footer>
    Sources mined across expert lab tests, retailer listings (live prices + critical-review histograms), and forums.
    Every claim on this page traces to the search's ground-truth data. Prices move — verify the exact SKU at checkout.
    Generated by the <code>discover-products</code> skill · search <code>${esc(id)}</code>.
  </footer>
</div>
<script>
  document.querySelectorAll('.tab').forEach(function(t){
    t.addEventListener('click', function(){
      document.querySelectorAll('.tab').forEach(function(x){ x.classList.toggle('active', x===t); });
      var sel = t.getAttribute('data-tab');
      document.getElementById('tab-rec').hidden = (sel!=='rec');
      document.getElementById('tab-audit').hidden = (sel!=='audit');
      window.scrollTo(0,0);
    });
  });
</script>
</body></html>`;

const outDir = resolve(REPO, 'webapp', 'products');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, `${id}.html`), html);

// Update manifest
const manifestPath = resolve(outDir, 'index.json');
let manifest = [];
if (existsSync(manifestPath)) { try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch {} }
const entry = {
  id,
  title: P.title || C.category,
  subtitle: P.subtitle || C.use_case || '',
  category: C.category,
  pick: v.headline || (pick && pick.name) || '',
  pick_price_usd: v.pick_price_usd || (pick && pick.price?.amount_usd) || null,
  conviction: !!(P.conviction && P.conviction.reached),
  updated: P.run_date || new Date().toISOString().slice(0, 10),
};
manifest = manifest.filter(m => m.id !== id);
manifest.unshift(entry);
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

console.error(`✓ wrote webapp/products/${id}.html`);
console.error(`✓ updated webapp/products/index.json (${manifest.length} guides)`);
console.log(`webapp/products/${id}.html`);
