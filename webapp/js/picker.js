// picker.js — Pre-screen: list my groups, browse public groups, join via link, create new.
import * as db from './supabase.js?v=1776965114';
import * as groupCtx from './group.js?v=1776965114';

const $root = document.getElementById('picker-root');
$root.hidden = false;

let _publicGroups = [];
let _publicCounts = {};
let _publicTrips = [];
let _publicItineraries = [];
let _products = [];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

function render() {
  const myGroups = groupCtx.getMyGroups();
  const myIds = new Set(myGroups.map(g => g.id));
  // Don't show a public group in "Discover" if it's already in "Your groups"
  const discover = _publicGroups.filter(g => !myIds.has(g.id));

  $root.innerHTML = `
    <div class="picker-page">
      <header class="picker-header">
        <h1>Restaurants</h1>
        <p class="picker-subtitle">Pick a city group to browse, vote, and comment on.</p>
      </header>
      <main class="picker-main">
        ${myGroups.length ? `
          <section class="picker-section">
            <h2 class="picker-section-title">Your groups</h2>
            <ul class="picker-list">
              ${myGroups.map(g => `
                <li class="picker-card" data-action="open" data-id="${esc(g.id)}">
                  <div class="picker-card-main">
                    <div class="picker-card-title">${esc(g.name || g.cityName || 'Group')}</div>
                    <div class="picker-card-sub">${esc(g.cityName || '')} · ${esc(g.myName ? 'as ' + g.myName : 'no name yet')} · ${timeAgo(g.lastVisitedAt)}</div>
                  </div>
                  <div class="picker-card-actions">
                    <button class="picker-icon-btn" data-action="share" data-id="${esc(g.id)}" aria-label="Copy share link">🔗</button>
                    <button class="picker-icon-btn" data-action="forget" data-id="${esc(g.id)}" aria-label="Remove from list">×</button>
                  </div>
                </li>
              `).join('')}
            </ul>
          </section>
        ` : ''}

        ${_publicTrips.length ? `
          <section class="picker-section">
            <h2 class="picker-section-title">Trips</h2>
            <p class="picker-section-sub">Vacation-planning trips with ranked destinations, scorecards, and visual itineraries.</p>
            <ul class="picker-list">
              ${_publicTrips.map(t => {
                const dates = (t.dates_start && t.dates_end)
                  ? new Date(t.dates_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                    + ' – '
                    + new Date(t.dates_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                  : (t.duration_days ? t.duration_days + ' days' : '');
                return `
                <li class="picker-card picker-card-public" data-action="open-trip" data-id="${esc(t.id)}">
                  <div class="picker-card-main">
                    <div class="picker-card-title">${esc(t.name || 'Trip')}</div>
                    <div class="picker-card-sub">
                      ${esc(dates)}${t.origin_airport ? ' · from ' + esc(t.origin_airport) : ''}
                    </div>
                  </div>
                  <div class="picker-card-actions">
                    <span class="picker-pill-public">Trip</span>
                  </div>
                </li>
                `;
              }).join('')}
            </ul>
          </section>
        ` : ''}

        ${_publicItineraries.length ? `
          <section class="picker-section">
            <h2 class="picker-section-title">Itineraries</h2>
            <p class="picker-section-sub">Locked plans — day-by-day briefs, bookings, atmospheric picks.</p>
            <ul class="picker-list">
              ${_publicItineraries.map(it => {
                const dates = (it.dates_start && it.dates_end)
                  ? new Date(it.dates_start + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                    + ' – '
                    + new Date(it.dates_end + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                  : (it.duration_days ? it.duration_days + ' days' : '');
                return `
                <li class="picker-card picker-card-public" data-action="open-itinerary" data-id="${esc(it.id)}">
                  <div class="picker-card-main">
                    <div class="picker-card-title">${esc(it.name || 'Itinerary')}</div>
                    <div class="picker-card-sub">
                      ${esc(dates)}${it.origin_airport ? ' · from ' + esc(it.origin_airport) : ''}
                    </div>
                  </div>
                  <div class="picker-card-actions">
                    <span class="picker-pill-public">Plan</span>
                  </div>
                </li>
                `;
              }).join('')}
            </ul>
          </section>
        ` : ''}

        ${_products.length ? `
          <section class="picker-section">
            <h2 class="picker-section-title">Buying guides</h2>
            <p class="picker-section-sub">Researched product picks — sources, tradeoffs, and a clear recommendation you can act on.</p>
            <ul class="picker-list">
              ${_products.map(p => `
                <li class="picker-card picker-card-public" data-action="open-product" data-id="${esc(p.id)}">
                  <div class="picker-card-main">
                    <div class="picker-card-title">${esc(p.title || 'Buying guide')}</div>
                    <div class="picker-card-sub">
                      Pick: ${esc(p.pick || '—')}${p.pick_price_usd ? ' · ~$' + esc(p.pick_price_usd) : ''}
                    </div>
                  </div>
                  <div class="picker-card-actions">
                    <span class="picker-pill-public">Guide</span>
                  </div>
                </li>
              `).join('')}
            </ul>
          </section>
        ` : ''}

        ${discover.length ? `
          <section class="picker-section">
            <h2 class="picker-section-title">Discover</h2>
            <p class="picker-section-sub">Public groups anyone can browse, vote, and comment on.</p>
            <ul class="picker-list">
              ${discover.map(g => {
                const count = _publicCounts[g.id];
                return `
                <li class="picker-card picker-card-public" data-action="open" data-id="${esc(g.id)}">
                  <div class="picker-card-main">
                    <div class="picker-card-title">${esc(g.name || g.city_name || 'Group')}</div>
                    <div class="picker-card-sub">
                      ${esc(g.city_name || '')}${g.country ? ', ' + esc(g.country) : ''}
                      ${count ? ` · ${count} restaurants` : ''}
                    </div>
                  </div>
                  <div class="picker-card-actions">
                    <span class="picker-pill-public">Public</span>
                  </div>
                </li>
                `;
              }).join('')}
            </ul>
          </section>
        ` : ''}

        ${!myGroups.length && !discover.length ? `
          <div class="picker-empty">
            <p>No groups here yet.</p>
            <p class="picker-hint">Paste a share link from someone to join a private group.</p>
          </div>
        ` : ''}

        <div class="picker-actions">
          <button class="picker-btn" data-action="join">Join via link</button>
        </div>
      </main>
    </div>
  `;
}

async function openGroup(id) {
  location.href = `/?g=${encodeURIComponent(id)}`;
}

async function copyShareLink(id) {
  const url = `${location.origin}/?g=${encodeURIComponent(id)}`;
  try {
    await navigator.clipboard.writeText(url);
    flash('Link copied');
  } catch {
    prompt('Copy this link:', url);
  }
}

function flash(msg) {
  const el = document.createElement('div');
  el.className = 'picker-toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

function showJoinModal() {
  const modal = document.createElement('div');
  modal.className = 'picker-modal-overlay';
  modal.innerHTML = `
    <div class="picker-modal">
      <h2>Join a group</h2>
      <form class="picker-form" id="join-form">
        <label>
          <span>Paste a share link or token</span>
          <input type="text" name="link" placeholder="https://…?g=xxxxxxxx  or  xxxxxxxx" required autofocus>
        </label>
        <div class="picker-modal-actions">
          <button type="button" class="picker-btn" data-action="close-modal">Cancel</button>
          <button type="submit" class="picker-btn picker-btn-primary">Open</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.dataset.action === 'close-modal') modal.remove();
  });
  modal.querySelector('#join-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = e.target.link.value.trim();
    let token = raw;
    const m = raw.match(/[?&]g=([^&\s]+)/);
    if (m) token = decodeURIComponent(m[1]);
    if (!token) return;
    // Verify the group exists before saving it
    const g = await db.loadGroup(token);
    if (!g) { flash('No group with that token'); return; }
    groupCtx.rememberGroup(g, null);
    location.href = `/?g=${encodeURIComponent(token)}`;
  });
}

$root.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  if (action === 'open') { openGroup(id); return; }
  if (action === 'open-trip') { location.href = `/?t=${encodeURIComponent(id)}`; return; }
  if (action === 'open-itinerary') { location.href = `/?i=${encodeURIComponent(id)}`; return; }
  if (action === 'open-product') { location.href = `/products/${encodeURIComponent(id)}.html`; return; }
  if (action === 'share') { e.stopPropagation(); copyShareLink(id); return; }
  if (action === 'forget') {
    e.stopPropagation();
    groupCtx.forgetGroup(id);
    render();
    return;
  }
  if (action === 'join') { showJoinModal(); return; }
});

// Initial render with whatever we know synchronously, then hydrate with public groups.
render();

(async () => {
  const [groups, trips, itineraries, products] = await Promise.all([
    db.loadPublicGroups(),
    db.loadPublicTrips(),
    db.loadPublicItineraries(),
    // Buying guides are static files (no Supabase) — tolerate absence.
    fetch('/products/index.json').then(r => r.ok ? r.json() : []).catch(() => []),
  ]);
  _publicGroups = groups;
  _publicTrips = trips;
  _publicItineraries = itineraries;
  _products = Array.isArray(products) ? products : [];
  if (_publicGroups.length) {
    _publicCounts = await db.countActiveRestaurants(_publicGroups.map(g => g.id));
  }
  render();
})();
