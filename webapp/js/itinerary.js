// itinerary.js — Renders a locked single-trip itinerary at /?i=<token>.
// Reads brief_md from the `itineraries` table and renders it as a mobile-friendly
// long-form trip page with a sticky section nav and auto-tappable phone numbers.
// All writes happen via tools/upsert-itinerary.mjs; this view is read-only.

import * as db from './supabase.js?v=1779000000';

const $root = document.getElementById('itinerary-root');
$root.hidden = false;

const params = new URLSearchParams(location.search);
const itinId = params.get('i');

const MARKED_CDN = 'https://cdn.jsdelivr.net/npm/marked@12.0.0/marked.min.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function loadMarked() {
  return new Promise((resolve, reject) => {
    if (window.marked) return resolve(window.marked);
    const s = document.createElement('script');
    s.src = MARKED_CDN;
    s.onload = () => resolve(window.marked);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Wrap phone-number patterns into tel: links so they're tappable on mobile.
// Matches: "760-648-7575", "(760) 934-3800", "760.914.0962", "+1 760 648 7575"
function linkifyPhones(html) {
  // Skip already-anchored content. Conservative pattern: 3-3-4 with - or . or space
  // optionally inside parens for area code.
  const re = /(\+?\d[\d ()\-. ]{8,})/g;
  return html.replace(/(<a [^>]*>[\s\S]*?<\/a>)|(?:(?<![\w>])([(]?\b\d{3}[)]?[\s.\- ]\d{3}[\s.\- ]\d{4}\b)(?!\w))/g,
    (m, anchor, phone) => {
      if (anchor) return anchor;
      if (!phone) return m;
      const digits = phone.replace(/[^\d+]/g, '');
      if (digits.length < 10) return m;
      return `<a class="i-phone" href="tel:${esc(digits.startsWith('+') ? digits : '+1' + digits)}">${esc(phone)}</a>`;
    });
}

// Format an ISO date as "Sat Aug 1".
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function renderShell(it) {
  const dates = it.dates_start && it.dates_end
    ? `${fmtDate(it.dates_start)} – ${fmtDate(it.dates_end)}`
    : '';
  const travelers = (it.traveler_slugs || []).map(s => s[0].toUpperCase() + s.slice(1)).join(' · ');
  const origin = it.origin_airport ? ` · from ${esc(it.origin_airport)}` : '';
  const sub = [dates, travelers].filter(Boolean).join(' · ') + origin;

  return `
    <div class="i-page">
      <header class="i-header">
        <div class="i-header-inner">
          <h1 class="i-title">${esc(it.name)}</h1>
          ${sub ? `<p class="i-sub">${esc(sub)}</p>` : ''}
        </div>
      </header>
      <nav class="i-nav" id="i-nav"><div class="i-nav-track" id="i-nav-track"></div></nav>
      <main class="i-content" id="i-content"></main>
      <footer class="i-footer">
        <a href="/" class="i-footer-link">← All groups</a>
        ${it.created_by_name ? `<span class="i-footer-by">curated by ${esc(it.created_by_name)}</span>` : ''}
      </footer>
    </div>
  `;
}

// Walk rendered DOM, assign ids to h2/h3, and build a pill list for the sticky nav.
// Strategy: H2 sections all get pills (short label). For the "Locked Day-by-Day"
// H2, ALSO promote the H3 "Day N — ..." headings to their own pills.
function buildNav(contentEl, navTrack) {
  const pills = [];
  const dayByDayHeaderText = /day[- ]by[- ]day/i;
  let insideDayByDay = false;

  contentEl.querySelectorAll('h2, h3').forEach((h) => {
    const text = h.textContent.trim();
    if (!h.id) h.id = slugify(text);

    if (h.tagName === 'H2') {
      insideDayByDay = dayByDayHeaderText.test(text);
      pills.push({ id: h.id, label: shortLabel(text), kind: 'h2' });
    } else if (h.tagName === 'H3' && insideDayByDay) {
      // E.g. "Day 1 — Sat Aug 1 · Pittsburgh → Irvine"
      const m = text.match(/^Day\s*(\d+)/i);
      const label = m ? `D${m[1]}` : shortLabel(text);
      pills.push({ id: h.id, label, kind: 'day' });
    }
  });

  navTrack.innerHTML = pills.map(p =>
    `<a class="i-pill i-pill-${p.kind}" data-target="${p.id}" href="#${p.id}">${esc(p.label)}</a>`
  ).join('');

  // Smooth-scroll + offset for sticky header
  navTrack.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const tgt = document.getElementById(a.dataset.target);
      if (!tgt) return;
      const top = tgt.getBoundingClientRect().top + window.scrollY - getNavOffset();
      window.scrollTo({ top, behavior: 'smooth' });
      history.replaceState(null, '', '#' + a.dataset.target);
    });
  });

  // Highlight the current section as the user scrolls
  setupScrollSpy(contentEl, navTrack);
}

function shortLabel(text) {
  // Collapse common verbose section names to compact pills.
  const map = {
    'tl;dr': 'TL;DR',
    'locked day-by-day': 'Days',
    'stays — top 3': 'Stays',
    'loyalty verdict — skip the play': 'Loyalty',
    'oc omakase shortlist (sat aug 1 milestone meal)': 'Omakase',
    'booking-urgency punch list': 'Bookings',
    'hero activities (the 6 to anchor everything)': 'Heroes',
    'aesthetic moments for ashi (instagram)': 'Aesthetic',
    'honest tradeoffs': 'Tradeoffs',
    'sources': 'Sources',
  };
  const key = text.toLowerCase().replace(/\s+/g, ' ').trim();
  return map[key] || text.split(/[—·:|]/)[0].trim();
}

function getNavOffset() {
  const nav = document.getElementById('i-nav');
  return (nav?.offsetHeight || 0) + 8;
}

function setupScrollSpy(contentEl, navTrack) {
  const headers = Array.from(contentEl.querySelectorAll('h2, h3'));
  const pills = Array.from(navTrack.querySelectorAll('a'));
  const byId = new Map(pills.map(p => [p.dataset.target, p]));
  if (!headers.length) return;

  const obs = new IntersectionObserver((entries) => {
    const visible = entries.filter(e => e.isIntersecting)
      .sort((a, b) => a.target.getBoundingClientRect().top - b.target.getBoundingClientRect().top);
    if (!visible.length) return;
    const id = visible[0].target.id;
    pills.forEach(p => p.classList.toggle('i-pill-active', p.dataset.target === id));
    const active = byId.get(id);
    if (active) {
      const trackRect = navTrack.getBoundingClientRect();
      const pillRect = active.getBoundingClientRect();
      if (pillRect.left < trackRect.left || pillRect.right > trackRect.right) {
        active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, { rootMargin: `-${getNavOffset() + 4}px 0px -65% 0px`, threshold: 0 });

  headers.forEach(h => obs.observe(h));
}

async function main() {
  if (!itinId) {
    $root.innerHTML = `<div class="i-empty">No itinerary id — try <code>?i=&lt;token&gt;</code>.</div>`;
    return;
  }
  if (!db.isConfigured()) {
    $root.innerHTML = `<div class="i-empty">Database not configured.</div>`;
    return;
  }

  $root.innerHTML = `<div class="i-loading">Loading itinerary…</div>`;
  const [it, marked] = await Promise.all([db.loadItinerary(itinId), loadMarked()]);

  if (!it) {
    $root.innerHTML = `<div class="i-empty">Itinerary <code>${esc(itinId)}</code> not found.</div>`;
    return;
  }

  document.title = it.name + ' · Itinerary';
  $root.innerHTML = renderShell(it);

  // Render the markdown body
  marked.setOptions({ gfm: true, breaks: false, mangle: false, headerIds: false });
  const rawHtml = marked.parse(it.brief_md || '');
  const html = linkifyPhones(rawHtml);
  const contentEl = document.getElementById('i-content');
  contentEl.innerHTML = html;

  // Build nav from rendered DOM
  buildNav(contentEl, document.getElementById('i-nav-track'));

  // If URL has a hash, scroll to it after layout settles
  if (location.hash) {
    requestAnimationFrame(() => {
      const tgt = document.getElementById(location.hash.slice(1));
      if (tgt) window.scrollTo({ top: tgt.getBoundingClientRect().top + window.scrollY - getNavOffset(), behavior: 'auto' });
    });
  }
}

main().catch(err => {
  console.error(err);
  $root.innerHTML = `<div class="i-empty">Failed to load itinerary: ${esc(err.message || err)}</div>`;
});
