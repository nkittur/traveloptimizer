// trip.js — Renders a vacation-planning trip at /?t=<token>.
// Reads from trips, trip_destinations, trip_destination_photos.
// All write operations are owned by the discover-destinations CLI skill;
// this view is read-only.

import * as db from './supabase.js?v=1776965114';

const $root = document.getElementById('trip-root');
$root.hidden = false;

const params = new URLSearchParams(location.search);
const tripId = params.get('t');

const SCORE_BUCKETS = [
  { key: 'climate_fit',       label: 'Climate fit',          icon: '☀️' },
  { key: 'pit_accessibility', label: 'PIT accessibility',    icon: '✈️' },
  { key: 'natural_beauty',    label: 'Natural beauty',       icon: '🏔' },
  { key: 'city_aesthetic',    label: 'City / aesthetic',     icon: '🏙' },
  { key: 'foodie_light',      label: 'Foodie scene (light)', icon: '🍣' },
  { key: 'boutique_stays',    label: 'Boutique stays',       icon: '🏛' },
  { key: 'instagrammy',       label: 'Photogenic',           icon: '📸' },
];

const SLOT_ICONS = {
  morning:   '🌅',
  lunch:     '🥢',
  afternoon: '🛍',
  dinner:    '🍷',
  evening:   '🌙',
};

const SLOT_LABELS = {
  morning:   'Morning · Nature / Beauty',
  lunch:     'Lunch',
  afternoon: 'Afternoon · City / Walk',
  dinner:    'Dinner',
  evening:   'Evening · View / Bar',
};

// Source-type → display config (label + CSS class)
const SOURCE_BADGES = {
  'nyt36hours':                   { label: 'NYT 36 Hours',           cls: 'src-nyt' },
  'nyt36hours-recent':            { label: 'NYT 36 Hours',           cls: 'src-nyt' },
  'nyt36hours-archived':          { label: 'NYT 36 Hours',           cls: 'src-nyt' },
  'lonelyplanet-bit2026':         { label: 'LP Best in Travel \'26', cls: 'src-lp' },
  'lonelyplanet':                 { label: 'Lonely Planet',          cls: 'src-lp' },
  'cntraveler-bestof2026':        { label: 'CN Traveler Best 2026',  cls: 'src-cnt' },
  'cntraveler':                   { label: 'CN Traveler',            cls: 'src-cnt' },
  'travelandleisure-50best2026':  { label: 'T+L 50 Best 2026',       cls: 'src-tl' },
  'travelandleisure':             { label: 'Travel + Leisure',       cls: 'src-tl' },
  'afar-bestof2026':              { label: 'AFAR 2026',              cls: 'src-afar' },
  'afar':                         { label: 'AFAR',                   cls: 'src-afar' },
  'natgeo':                       { label: 'Nat Geo',                cls: 'src-natgeo' },
  'nationalgeographic':           { label: 'Nat Geo',                cls: 'src-natgeo' },
  'eater':                        { label: 'Eater',                  cls: 'src-eater' },
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Tiny markdown renderer for report_md. Handles: # / ## / ### headers, **bold**, *italic*,
// paragraphs, single-line blockquotes, and unordered lists. Anything fancier should be
// rendered with marked.js (loaded lazily if needed).
// Split a report_md blob into { "Section title": "section body" } pairs by ## headers.
function splitReportSections(mdText) {
  if (!mdText) return {};
  const out = {};
  const re = /^## (.+?)\s*\n([\s\S]*?)(?=\n## |$)/gm;
  let m;
  while ((m = re.exec(mdText)) !== null) {
    out[m[1].trim()] = m[2].trim();
  }
  return out;
}

function md(s) {
  if (!s) return '';
  const lines = String(s).split('\n');
  const out = [];
  let inList = false;
  for (let raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { if (inList) { out.push('</ul>'); inList = false; } continue; }
    let m;
    if ((m = line.match(/^###\s+(.*)$/))) { if (inList) { out.push('</ul>'); inList = false; } out.push(`<h4>${inline(m[1])}</h4>`); continue; }
    if ((m = line.match(/^##\s+(.*)$/)))  { if (inList) { out.push('</ul>'); inList = false; } out.push(`<h3>${inline(m[1])}</h3>`); continue; }
    if ((m = line.match(/^#\s+(.*)$/)))   { if (inList) { out.push('</ul>'); inList = false; } out.push(`<h2>${inline(m[1])}</h2>`); continue; }
    if ((m = line.match(/^[-*]\s+(.*)$/))){ if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = line.match(/^>\s+(.*)$/)))   { if (inList) { out.push('</ul>'); inList = false; } out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
    if (inList) { out.push('</ul>'); inList = false; }
    out.push(`<p>${inline(line)}</p>`);
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
  function inline(s) {
    return esc(s)
      // [#tag] → visual pill (must run before *italic* to avoid * inside [#])
      .replace(/\[#([^\]]+)\]/g, (_, t) => {
        const cls = /^(museum|park|hotel|restaurant|cafe|bar|landmark|sight|shop)$/i.test(t)
          ? 'md-tag md-tag-cat md-tag-' + t.toLowerCase()
          : 'md-tag md-tag-src';
        return `<span class="${cls}">${t}</span>`;
      })
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }
}

function fmtScore(n) { return n != null ? Number(n).toFixed(1) : '—'; }
function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s + 'T00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function photosBy(photos, dest, predicate) {
  return photos
    .filter(p => p.trip_destination_id === dest.id)
    .filter(predicate)
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
}

function renderHeader(trip) {
  const d1 = fmtDate(trip.dates_start);
  const d2 = fmtDate(trip.dates_end);
  const dates = (d1 && d2) ? `${d1} – ${d2}, ${new Date(trip.dates_start).getFullYear()}` : `${trip.duration_days || '?'} days`;
  const filters = trip.hard_filters
    ? Object.keys(trip.hard_filters).map(f => `<span class="trip-filter-pill">${esc(f.replace(/_/g, ' '))}</span>`).join('')
    : '';
  return `
    <header class="trip-header">
      <div class="trip-header-inner">
        <a href="/" class="trip-back">← All trips</a>
        <h1 class="trip-title">${esc(trip.name || 'Trip')}</h1>
        <div class="trip-meta">
          <span class="trip-meta-item">${esc(dates)}</span>
          <span class="trip-meta-sep">·</span>
          <span class="trip-meta-item">From ${esc(trip.origin_airport || 'PIT')}</span>
          <span class="trip-meta-sep">·</span>
          <span class="trip-meta-item">${(trip.traveler_slugs || []).map(s => s[0].toUpperCase() + s.slice(1)).join(', ')}</span>
        </div>
        ${trip.criteria?.freeText ? `<p class="trip-criteria">${esc(trip.criteria.freeText)}</p>` : ''}
        ${filters ? `<div class="trip-filters">${filters}</div>` : ''}
      </div>
    </header>
  `;
}

function renderTopstrip(finalists) {
  if (!finalists.length) return '';
  return `
    <nav class="trip-topstrip">
      ${finalists.slice(0, 6).map(d => {
        const hero = (d._hero?.[0]?.url) || '';
        return `
          <a class="trip-topstrip-item" href="#dest-${esc(d.slug)}">
            ${hero ? `<img loading="lazy" src="${esc(hero)}" alt="">` : ''}
            <div class="trip-topstrip-rank">${d.ranking ?? '·'}</div>
            <div class="trip-topstrip-name">${esc(d.name)}</div>
          </a>
        `;
      }).join('')}
    </nav>
  `;
}

function renderHero(dest) {
  const hero = dest._hero || [];
  if (!hero.length) return '';
  return `
    <div class="hero-masonry">
      ${hero.map((p, i) => `
        <a class="hero-tile hero-tile-${i % 5}" data-action="lightbox" data-url="${esc(p.url)}" data-caption="${esc(p.caption || '')}">
          <img loading="lazy" src="${esc(p.url)}" alt="${esc(p.alt_text || p.caption || '')}">
        </a>
      `).join('')}
    </div>
  `;
}

function renderScorecard(dest) {
  const scores = dest.scores || {};
  const op = dest.operational || {};
  return `
    <ul class="scorecard">
      ${SCORE_BUCKETS.map(b => {
        const s = scores[b.key];
        const pct = s != null ? Math.max(0, Math.min(100, (s / 5) * 100)) : 0;
        let extra = '';
        if (b.key === 'climate_fit' && op.climate?.avg_high_F != null) {
          extra = `${op.climate.avg_high_F}°F · ${op.climate.comfort || ''}`;
        }
        if (b.key === 'pit_accessibility' && op.pit_routing?.status) {
          const st = op.pit_routing.status;
          extra = st === 'nonstop' ? `nonstop ${(op.pit_routing.nonstop_airports || []).join(', ')}${op.pit_routing.seasonal ? ' (seasonal)' : ''}`
                : st === 'no_nonstop' ? 'connection required'
                : '';
        }
        return `
          <li class="scorecard-row">
            <span class="scorecard-bucket">${b.icon} ${b.label}</span>
            <span class="scorecard-bar"><span class="scorecard-bar-fill" style="width:${pct}%"></span></span>
            <span class="scorecard-score">${fmtScore(s)}</span>
            ${extra ? `<span class="scorecard-fact">${esc(extra)}</span>` : '<span class="scorecard-fact"></span>'}
          </li>
        `;
      }).join('')}
    </ul>
  `;
}

// Find a photo whose place_mentions or caption matches the given place name.
// Used by the see-do / food / hotel card grids to locate visuals from the
// already-uploaded trip_destination_photos rows.
function findPhotoForPlace(name, dest) {
  if (!name || !dest._byBucket) return null;
  const lower = name.toLowerCase().trim();
  if (lower.length < 3) return null;
  // Walk every photo across every bucket
  for (const bucket of Object.values(dest._byBucket)) {
    for (const p of bucket) {
      const mentions = (p.place_mentions || []).map(s => s.toLowerCase());
      if (mentions.some(m => m === lower || m.includes(lower) || lower.includes(m))) return p;
    }
  }
  // Fallback: caption substring match (only for longer names to avoid false positives)
  if (lower.length >= 5) {
    for (const bucket of Object.values(dest._byBucket)) {
      for (const p of bucket) {
        const cap = (p.caption || '').toLowerCase();
        if (cap.includes(lower)) return p;
      }
    }
  }
  return null;
}

function googleMapsUrl(name, dest) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name + ' ' + dest.name)}`;
}

const SEE_DO_ICONS = { museum: '🖼', park: '🌲', landmark: '📍', sight: '👁', shop: '🛍' };
const FOOD_ICONS   = { restaurant: '🍽', cafe: '☕', bar: '🍷' };

// Single pick card (used by see-do and food sections)
function renderPickCard(item, dest, iconMap) {
  const photo = findPhotoForPlace(item.name, dest);
  const mapsUrl = photo?.source_url || googleMapsUrl(item.name, dest);
  const bgStyle = photo ? `style="background-image: url('${esc(photo.url)}')"` : '';
  const icon = iconMap?.[item.category] || '·';
  const catTag = item.category
    ? `<span class="pick-card-tag pick-card-tag-cat pick-card-cat-${item.category}">${icon} ${esc(item.category)}</span>`
    : '';
  const sourceTags = (item.sources || []).slice(0, 2)
    .map(s => `<span class="pick-card-tag pick-card-tag-src">${esc(s)}</span>`).join('');
  const cls = 'pick-card' + (photo ? ' pick-card-image' : ' pick-card-text-only');
  return `
    <a class="${cls}" href="${esc(mapsUrl)}" target="_blank" rel="noopener" ${bgStyle}>
      ${photo ? '<div class="pick-card-scrim"></div>' : ''}
      <div class="pick-card-text">
        <div class="pick-card-tags">${catTag}${sourceTags}</div>
        <h4 class="pick-card-name">${esc(item.name)}</h4>
        ${item.snippet ? `<p class="pick-card-snippet">${esc(item.snippet)}</p>` : ''}
      </div>
    </a>
  `;
}

function renderSeeDoSection(dest) {
  const picks = dest.operational?.agree_picks || [];
  if (!picks.length) return '';
  return `
    <section class="picks-section picks-section-seedo">
      <h3 class="picks-section-title">What to see + do <span class="picks-section-count">${picks.length}</span></h3>
      <div class="picks-grid">${picks.map(p => renderPickCard(p, dest, SEE_DO_ICONS)).join('')}</div>
    </section>
  `;
}

function renderFoodSection(dest) {
  const picks = dest.operational?.food_picks || [];
  if (!picks.length) return '';
  return `
    <section class="picks-section picks-section-food">
      <h3 class="picks-section-title">Food <span class="picks-section-count">${picks.length}</span></h3>
      <div class="picks-grid">${picks.map(p => renderPickCard(p, dest, FOOD_ICONS)).join('')}</div>
    </section>
  `;
}

// Featured stay card — same visual language as see-do/food but full-width feature
function renderHotel(dest) {
  const hp = dest.hotel_pick;
  if (!hp || !hp.name) return '';
  const photo = findPhotoForPlace(hp.name, dest)
             || (dest._byBucket?.['boutique-stay'] || [])[0]
             || (dest._byBucket?.['hero'] || [])[0];
  const mapsUrl = hp.source_url || googleMapsUrl(hp.name, dest);
  const bgStyle = photo ? `style="background-image: url('${esc(photo.url)}')"` : '';
  const tags = [];
  if (hp.approx_nightly_usd) tags.push(`<span class="pick-card-tag pick-card-tag-rate">~$${hp.approx_nightly_usd}/night</span>`);
  if (hp.on_edit)  tags.push(`<span class="pick-card-tag pick-card-tag-edit">★ Chase Edit</span>`);
  if (hp.on_hyatt) tags.push(`<span class="pick-card-tag pick-card-tag-hyatt">★ Hyatt</span>`);
  return `
    <section class="picks-section picks-section-stay">
      <h3 class="picks-section-title">Where to stay</h3>
      <a class="pick-card pick-card-feature ${photo ? 'pick-card-image' : 'pick-card-text-only'}" href="${esc(hp.source_url || mapsUrl)}" target="_blank" rel="noopener" ${bgStyle}>
        ${photo ? '<div class="pick-card-scrim"></div>' : ''}
        <div class="pick-card-text pick-card-text-feature">
          <div class="pick-card-tags">${tags.join('')}</div>
          <h4 class="pick-card-name pick-card-name-feature">${esc(hp.name)}</h4>
          ${hp.neighborhood ? `<p class="pick-card-subtitle">${esc(hp.neighborhood)}</p>` : ''}
          ${hp.summary ? `<p class="pick-card-snippet pick-card-snippet-feature">${esc(hp.summary)}</p>` : ''}
        </div>
      </a>
    </section>
  `;
}

// Legacy dead-code path (kept temporarily so any in-flight callers don't break) — not invoked.
function _renderHotelLegacy(dest) {
  const hp = dest.hotel_pick;
  if (!hp || !hp.name) return '';
  const photos = (dest._byBucket?.['boutique-stay'] || []).slice(0, 4);
  const loyaltyFlags = [];
  if (hp.on_edit)  loyaltyFlags.push('<span class="hotel-pick-loyalty hotel-pick-loyalty-edit">★ Chase Edit</span>');
  if (hp.on_hyatt) loyaltyFlags.push('<span class="hotel-pick-loyalty hotel-pick-loyalty-hyatt">★ Hyatt</span>');
  return `
    <section class="hotel-pick">
      <div class="hotel-pick-text">
        <div class="hotel-pick-eyebrow">Where to stay</div>
        <h3 class="hotel-pick-name">${esc(hp.name)}</h3>
        ${hp.neighborhood || hp.approx_nightly_usd ? `<div class="hotel-pick-sub">${esc(hp.neighborhood || '')}${hp.approx_nightly_usd ? `${hp.neighborhood ? ' · ' : ''}<strong>~$${hp.approx_nightly_usd}/night</strong>` : ''}${loyaltyFlags.length ? ' · ' + loyaltyFlags.join(' ') : ''}</div>` : ''}
        <p class="hotel-pick-summary">${esc(hp.summary || '')}</p>
        ${hp.source_url ? `<a class="hotel-pick-link" href="${esc(hp.source_url)}" target="_blank" rel="noopener">Visit hotel →</a>` : ''}
      </div>
      ${photos.length ? `
        <div class="hotel-pick-photos">
          ${photos.map(p => `
            <a class="hotel-photo" data-action="lightbox" data-url="${esc(p.url)}" data-caption="${esc(p.caption || '')}">
              <img loading="lazy" src="${esc(p.url)}" alt="${esc(p.caption || hp.name)}">
            </a>
          `).join('')}
        </div>
      ` : ''}
    </section>
  `;
}

function renderItineraryDay(day, dest) {
  return `
    <div class="itin-day" data-day="${day.day}">
      <div class="itin-day-header">Day ${day.day}</div>
      <div class="itin-grid">
        ${(day.slots || []).map(slot => renderSlot(slot, dest)).join('')}
      </div>
    </div>
  `;
}

function renderSlot(slot, dest) {
  const slotType = slot.type || 'morning';
  const icon = SLOT_ICONS[slotType] || '·';
  const label = slot.label || SLOT_LABELS[slotType] || '';
  // Photos: prefer slot.key → photo.itinerary_slot_key direct match.
  let photos = [];
  if (slot.key) {
    const itinPhotos = dest._byBucket?.['itinerary-slot'] || [];
    photos = itinPhotos.filter(p => p.itinerary_slot_key === slot.key)
      .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  }
  if (photos.length === 0 && slot.photo_ids?.length) {
    photos = slot.photo_ids.map(id => dest._photoIndex?.[id]).filter(Boolean);
  }
  const photo = photos[0];
  const placeName = slot.place_name || '—';
  const mapsUrl = photo?.source_url || googleMapsUrl(placeName === '—' ? label : placeName, dest);
  const cls = 'itin-slot' + (photo ? ' itin-slot-image' : ' itin-slot-text-only');
  // Image (or placeholder) on top, body below — two-part vertical card with
  // grid-aligned rows so titles line up across cards in a row.
  const imageBlock = photo
    ? `<div class="itin-slot-image-top" style="background-image: url('${esc(photo.url)}')"></div>`
    : `<div class="itin-slot-image-top itin-slot-image-empty">${icon}</div>`;
  return `
    <a class="${cls}" href="${esc(mapsUrl)}" target="_blank" rel="noopener" title="${esc(placeName)} — open in Google Maps">
      ${imageBlock}
      <div class="itin-slot-body">
        <div class="itin-slot-eyebrow">${icon} ${esc(label)}</div>
        <div class="itin-slot-name">${esc(placeName)}</div>
        ${slot.text ? `<div class="itin-slot-text-body">${esc(slot.text)}</div>` : '<div class="itin-slot-text-body"></div>'}
      </div>
    </a>
  `;
}

function renderLoyaltyPerks(dest) {
  const lp = dest.operational?.loyalty_perks;
  const inBudget = h => h.status === 'in_budget' || h.status === 'edit_brings_in' || h.status === 'points_only';
  const noLoyalty = !lp || ((!lp.edit?.length) && (!lp.hyatt?.length));
  if (noLoyalty) {
    if (lp?.note) {
      return `<div class="loyalty-perks loyalty-perks-empty">★ <em>${esc(lp.note)}</em></div>`;
    }
    return '';
  }
  const editIn  = (lp.edit  || []).filter(inBudget);
  const editOut = (lp.edit  || []).filter(h => !inBudget(h));
  const hyattIn  = (lp.hyatt || []).filter(inBudget);
  const hyattOut = (lp.hyatt || []).filter(h => !inBudget(h));
  const isAnchor = lp.anchor && lp.anchor.startsWith('★');
  const isWarn   = lp.anchor && lp.anchor.startsWith('⚠');

  function hotelLine(h, type) {
    const ratePart = h.est_nightly_usd ? ` · <span class="loyalty-perks-rate">~$${h.est_nightly_usd}/night</span>` : '';
    const catPart = h.category ? ` · <span class="loyalty-perks-cat">${esc(h.category)}</span>` : '';
    const ptsPart = h.points ? ` · <span class="loyalty-perks-cat">${esc(h.points)}</span>` : '';
    const statusPill = ({
      in_budget:       '<span class="loyalty-status loyalty-status-good">in budget</span>',
      edit_brings_in:  '<span class="loyalty-status loyalty-status-edge">budget w/ Edit credit</span>',
      points_only:     '<span class="loyalty-status loyalty-status-points">points-only path</span>',
      over_budget:     '<span class="loyalty-status loyalty-status-out">over budget</span>',
    })[h.status] || '';
    return `<li><strong>${esc(h.name)}</strong>${h.neighborhood ? ` · ${esc(h.neighborhood)}` : ''}${catPart}${ptsPart}${ratePart} ${statusPill}<br><span class="loyalty-perks-why">${esc(h.why)}</span></li>`;
  }

  return `
    <section class="loyalty-perks${isAnchor ? ' loyalty-perks-anchor' : ''}${isWarn ? ' loyalty-perks-warn' : ''}">
      <h3 class="loyalty-perks-title">★ Loyalty perks${isAnchor ? ' <span class="loyalty-perks-anchor-tag">trip anchor candidate</span>' : ''}</h3>
      ${lp.anchor ? `<p class="loyalty-perks-anchor-text">${esc(lp.anchor)}</p>` : ''}
      ${editIn.length ? `
        <div class="loyalty-perks-block">
          <div class="loyalty-perks-block-label">Chase Edit hotels in budget (CSR: $100/stay credit + breakfast)</div>
          <ul>${editIn.map(h => hotelLine(h, 'edit')).join('')}</ul>
        </div>` : ''}
      ${hyattIn.length ? `
        <div class="loyalty-perks-block">
          <div class="loyalty-perks-block-label">Hyatt properties in budget (Chase UR transfers 1:1)</div>
          <ul>${hyattIn.map(h => hotelLine(h, 'hyatt')).join('')}</ul>
        </div>` : ''}
      ${(editOut.length + hyattOut.length) ? `
        <details class="loyalty-perks-excluded">
          <summary>${editOut.length + hyattOut.length} property${(editOut.length + hyattOut.length) === 1 ? '' : 'ies'} above the $500–600/night cap</summary>
          ${editOut.length ? `<div class="loyalty-perks-block"><div class="loyalty-perks-block-label">Excluded Edit hotels</div><ul>${editOut.map(h => hotelLine(h, 'edit')).join('')}</ul></div>` : ''}
          ${hyattOut.length ? `<div class="loyalty-perks-block"><div class="loyalty-perks-block-label">Excluded Hyatt</div><ul>${hyattOut.map(h => hotelLine(h, 'hyatt')).join('')}</ul></div>` : ''}
        </details>` : ''}
      ${lp.verify ? `<p class="loyalty-perks-verify">Verify rates + Edit eligibility before booking — programs change. <a href="${esc(lp.verify.split(' and ')[0])}" target="_blank" rel="noopener">Open Chase Edit ↗</a></p>` : ''}
    </section>
  `;
}

function renderSourceBadges(sources) {
  if (!sources?.length) return '';
  // Group by display label so duplicate labels (e.g. nyt36hours + nyt36hours-recent) collapse
  const seen = new Set();
  const items = [];
  for (const s of sources) {
    const cfg = SOURCE_BADGES[s.type] || { label: s.type, cls: 'src-default' };
    const key = cfg.label;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ ...s, ...cfg });
  }
  return `
    <div class="source-badges">
      ${items.map(s => `
        <a class="source-badge ${s.cls}${s.verified ? ' source-badge-verified' : ''}"
           href="${esc(s.url)}" target="_blank" rel="noopener"
           title="${esc(s.title || s.label)}${s.verified ? ' (verified from archive)' : ''}">
          ${s.verified ? '<span class="source-badge-tick">✓</span>' : ''}${esc(s.label)}
        </a>
      `).join('')}
    </div>
  `;
}

function renderDestination(dest) {
  const itinerary = dest.itinerary || [];
  const climate = dest.operational?.climate;
  const climateBadge = climate
    ? `<span class="dest-meta-badge">☀ ${climate.avg_high_F}°F · ${climate.comfort}</span>`
    : '';
  return `
    <article class="destination" id="dest-${esc(dest.slug)}">
      <div class="destination-rankbar">
        ${dest.ranking ? `<span class="destination-rank">#${dest.ranking}</span>` : ''}
        <span class="destination-score">${fmtScore(dest.composite_score)}</span>
      </div>
      <h2 class="destination-title">${esc(dest.name)}<span class="destination-country">${esc(dest.country || '')}</span></h2>
      <div class="destination-meta">
        ${climateBadge}
        ${(() => {
          const fe = dest.operational?.flight_estimate;
          if (!fe) return dest.operational?.pit_routing?.status === 'nonstop'
            ? `<span class="dest-meta-badge">✈ nonstop ${(dest.operational.pit_routing.nonstop_airports || []).join(', ')}</span>`
            : `<span class="dest-meta-badge dest-meta-badge-warn">✈ connection</span>`;
          if (fe.quality === 'unviable') {
            return `<span class="dest-meta-badge dest-meta-badge-warn">✈ 2+ stops required — unavailable per family no-2-stop rule</span>`;
          }
          const hrs = fe.total_hours_door_to_door;
          const hrsStr = hrs >= 10 ? `${Math.round(hrs)}h` : `${hrs.toFixed(hrs < 5 ? 1 : 0)}h`;
          const cls = /Nonstop/i.test(fe.stops || '') ? '' : (fe.quality !== 'good' ? 'dest-meta-badge-warn' : '');
          return `<span class="dest-meta-badge ${cls}">✈ ~${hrsStr} · ~$${fe.round_trip_pp_usd} · ${esc(fe.stops)}</span>`;
        })()}
        ${dest.operational?.flight_estimate?.note ? `<span class="dest-meta-note">${esc(dest.operational.flight_estimate.note)}</span>` : ''}
      </div>

      ${renderSourceBadges(dest.sources)}
      ${renderLoyaltyPerks(dest)}
      ${renderHero(dest)}
      ${renderScorecard(dest)}
      ${(() => {
        // Split report_md into known sections so we can interleave card grids with prose.
        const sec = splitReportSections(dest.report_md);
        const hasSeeDo = (dest.operational?.agree_picks || []).length > 0;
        const hasFood  = (dest.operational?.food_picks  || []).length > 0;
        const skipFromFallback = new Set([
          'Where to stay',                                              // always — replaced by featured hotel card
          ...(hasSeeDo ? ['What every source agrees on'] : []),
          ...(hasFood  ? ['The food side'] : []),
        ]);
        const known = new Set(['The place', 'The natural side', 'The city side', 'Risks / tradeoffs', 'Risks/tradeoffs', ...skipFromFallback]);
        const fallbackEntries = Object.entries(sec).filter(([t]) => !known.has(t));
        const renderSec = (title, body) => body ? `<div class="destination-report">${md('## ' + title + '\n' + body)}</div>` : '';
        return [
          renderSec('The place', sec['The place']),
          renderSeeDoSection(dest),
          renderSec('The natural side', sec['The natural side']),
          renderSec('The city side', sec['The city side']),
          renderFoodSection(dest),
          renderHotel(dest),
        ].join('');
      })()}

      ${itinerary.length ? `
        <section class="itinerary">
          <h3 class="itinerary-title">Sample itinerary</h3>
          ${itinerary.map(d => renderItineraryDay(d, dest)).join('')}
        </section>
      ` : ''}

      ${(() => {
        // Risks paragraph + any unmatched fallback sections (e.g., curated content
        // that uses non-standard headers). Render after itinerary so they don't
        // break the see-do / food / stay card flow.
        const sec = splitReportSections(dest.report_md);
        const hasSeeDo = (dest.operational?.agree_picks || []).length > 0;
        const hasFood  = (dest.operational?.food_picks  || []).length > 0;
        const skipFromFallback = new Set([
          'Where to stay',
          ...(hasSeeDo ? ['What every source agrees on'] : []),
          ...(hasFood  ? ['The food side'] : []),
        ]);
        const known = new Set(['The place', 'The natural side', 'The city side', 'Risks / tradeoffs', 'Risks/tradeoffs', ...skipFromFallback]);
        const fallbackEntries = Object.entries(sec).filter(([t]) => !known.has(t));
        const risksTitle = sec['Risks / tradeoffs'] ? 'Risks / tradeoffs' : (sec['Risks/tradeoffs'] ? 'Risks/tradeoffs' : null);
        const renderSec = (title, body) => body ? `<div class="destination-report">${md('## ' + title + '\n' + body)}</div>` : '';
        return [
          ...fallbackEntries.map(([t, b]) => renderSec(t, b)),
          risksTitle ? renderSec(risksTitle, sec[risksTitle]) : '',
        ].join('');
      })()}

      ${dest.sources && dest.sources.length ? `
        <details class="destination-sources">
          <summary>${dest.sources.length} source${dest.sources.length === 1 ? '' : 's'} (full list)</summary>
          <ul>
            ${dest.sources.map(s => `<li>${s.verified ? '<span class="src-tick" title="verified from scraped archive">✓</span> ' : ''}<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.type)}</a> <span class="dest-source-type">${esc(s.type)}</span></li>`).join('')}
          </ul>
        </details>
      ` : ''}
    </article>
  `;
}

function renderRejected(rejected) {
  if (!rejected.length) return '';
  return `
    <details class="trip-rejected">
      <summary>${rejected.length} destinations filtered out</summary>
      <ul>
        ${rejected.map(d => `<li><strong>${esc(d.name)}</strong>${d.country ? ', ' + esc(d.country) : ''} — <em>${esc(d.rejection_reason || 'rejected')}</em></li>`).join('')}
      </ul>
    </details>
  `;
}

function attachPhotosToDestinations(destinations, photos) {
  // Build a per-destination photo index plus bucketed maps
  for (const d of destinations) {
    const own = photos.filter(p => p.trip_destination_id === d.id);
    d._photoIndex = {};
    d._byBucket = {};
    d._hero = [];
    for (const p of own) {
      const url = db.tripPhotoUrl(p.storage_path);
      const enriched = { ...p, url };
      d._photoIndex[p.id] = enriched;
      (d._byBucket[p.bucket] ||= []).push(enriched);
      if (p.bucket === 'hero') d._hero.push(enriched);
    }
    // If hero bucket is empty, fall back to top-ranked from all buckets (excluding itinerary-slot)
    if (d._hero.length === 0) {
      const fallback = own
        .filter(p => p.bucket !== 'itinerary-slot')
        .map(p => ({ ...p, url: db.tripPhotoUrl(p.storage_path) }))
        .slice(0, 8);
      d._hero = fallback;
    }
  }
}

// Lightbox
function showLightbox(url, caption) {
  const $lb = document.getElementById('trip-lightbox');
  $lb.innerHTML = `
    <div class="lightbox-backdrop" data-action="close-lightbox"></div>
    <div class="lightbox-content">
      <button class="lightbox-close" data-action="close-lightbox" aria-label="Close">×</button>
      <img src="${esc(url)}" alt="">
      ${caption ? `<div class="lightbox-caption">${esc(caption)}</div>` : ''}
    </div>
  `;
  $lb.hidden = false;
}
function closeLightbox() { document.getElementById('trip-lightbox').hidden = true; }

// ── Overview card (compact summary in the band grid) ───────────────
function renderOverviewCard(dest) {
  const hero = dest._hero?.[0]?.url || dest._photoIndex && Object.values(dest._photoIndex)[0]?.url || '';
  const climate = dest.operational?.climate;
  const tagline = dest.operational?.tagline || '';
  const sources = (dest.sources || []).filter(s => s.verified).slice(0, 4);
  const climateBadge = climate?.avg_high_F != null
    ? `<span class="ov-badge ov-badge-climate">☀ ${climate.avg_high_F}°F</span>` : '';
  // Flight badge — Google Flights scrape data; unviable = no 1-stop available (family rule).
  const fe = dest.operational?.flight_estimate;
  let pitBadge = '';
  if (fe) {
    if (fe.quality === 'unviable') {
      pitBadge = `<span class="ov-badge ov-badge-pit ov-badge-pit-warn" title="${esc(fe.note || '')}">✈ 2+ stops · unavailable</span>`;
    } else {
      const hrs = fe.total_hours_door_to_door;
      const hrsStr = hrs >= 10 ? `${Math.round(hrs)}h` : `${hrs.toFixed(hrs < 5 ? 1 : 0)}h`;
      const isNonstop = /Nonstop/i.test(fe.stops || '');
      const questionable = fe.quality && fe.quality !== 'good';
      const cls = isNonstop ? 'ov-badge-pit' : (questionable ? 'ov-badge-pit ov-badge-pit-warn' : 'ov-badge-pit ov-badge-pit-mid');
      const tooltip = `${fe.stops}, ${fe.sampled_window}${fe.note ? ' — ' + fe.note : ''}`;
      pitBadge = `<span class="ov-badge ${cls}" title="${esc(tooltip)}">✈ ~${hrsStr} · ~$${fe.round_trip_pp_usd}${questionable ? ' ⚠' : ''}</span>`;
    }
  } else if (dest.operational?.pit_routing?.status === 'nonstop') {
    pitBadge = `<span class="ov-badge ov-badge-pit">✈ nonstop</span>`;
  } else if (dest.operational?.pit_routing?.status === 'no_nonstop') {
    pitBadge = `<span class="ov-badge ov-badge-pit ov-badge-pit-warn">✈ 1-stop</span>`;
  }
  const rv = dest.operational?.recently_visited;
  const cooldown = dest.operational?.cooldown_status;
  const cooldownBadge = cooldown && !cooldown.ok
    ? `<span class="ov-badge ov-badge-cooldown" title="${esc(cooldown.reason)}">↩︎ Just visited (${rv?.who || 'family'}) · ${cooldown.months_out ? cooldown.months_out + 'mo' : ''}</span>`
    : '';
  const lp = dest.operational?.loyalty_perks;
  const inBudget = h => h.status === 'in_budget' || h.status === 'edit_brings_in' || h.status === 'points_only';
  const lpAnchor = lp?.anchor && lp.anchor.startsWith('★');
  const editIn = (lp?.edit || []).filter(inBudget);
  const hyattIn = (lp?.hyatt || []).filter(inBudget);
  const lpItems = editIn.length + hyattIn.length;
  const loyaltyBadge = lpItems > 0
    ? `<span class="ov-badge ov-badge-loyalty${lpAnchor ? ' ov-badge-loyalty-anchor' : ''}" title="${esc(lp.anchor || '')}">★ ${editIn.length ? 'Edit×' + editIn.length : ''}${editIn.length && hyattIn.length ? ' · ' : ''}${hyattIn.length ? 'Hyatt×' + hyattIn.length : ''}${lpAnchor ? ' ⭐' : ''}</span>`
    : '';
  const sourceBadgesHtml = sources.length ? `
    <div class="ov-sources">
      ${sources.map(s => {
        const cfg = SOURCE_BADGES[s.type] || { label: s.type, cls: 'src-default' };
        return `<span class="ov-source-badge ${cfg.cls}" title="${esc(s.title || cfg.label)}"><span class="ov-source-tick">✓</span>${esc(cfg.label)}</span>`;
      }).join('')}
    </div>` : '';
  return `
    <a class="overview-card" href="?t=${encodeURIComponent(tripId)}&d=${encodeURIComponent(dest.slug)}" data-slug="${esc(dest.slug)}" data-action="open-detail">
      <div class="overview-card-image">
        ${hero ? `<img loading="lazy" src="${esc(hero)}" alt="${esc(dest.name)}">` : '<div class="overview-card-image-empty">📍</div>'}
        ${dest.ranking ? `<div class="overview-card-rank">#${dest.ranking}</div>` : ''}
        <div class="overview-card-score">${fmtScore(dest.composite_score)}</div>
      </div>
      <div class="overview-card-body">
        <h3 class="overview-card-title">${esc(dest.name)}</h3>
        ${dest.country ? `<div class="overview-card-country">${esc(dest.country)}</div>` : ''}
        <div class="overview-card-meta">${climateBadge}${pitBadge}${cooldownBadge}${loyaltyBadge}</div>
        ${tagline ? `<p class="overview-card-tagline">${esc(tagline)}</p>` : ''}
        ${sourceBadgesHtml}
        <div class="overview-card-cta">View details →</div>
      </div>
    </a>
  `;
}

function climateBand(d) {
  const h = d.operational?.climate?.avg_high_F;
  if (h == null) return 'unknown';
  if (h < 70) return 'cool';
  if (h <= 84) return 'sweet';
  return 'warm';
}
const BAND_META = {
  sweet:   { label: 'Sweet spot',                sub: 'Highs 70–84°F. The family\'s preferred summer band — comfortable not stifling.', icon: '☀️' },
  warm:    { label: 'Warm — needs cool-down',    sub: 'Highs 84°F+. Works when there\'s coastal swimming, a pool, or shade-and-AC mitigation built in.', icon: '🌊' },
  cool:    { label: 'Cool side',                 sub: 'Highs below 70°F. Landscape-driven trips — pack layers; the scenery does the work.', icon: '❄️' },
  unknown: { label: 'Climate not enriched',       sub: '', icon: '·' },
};
const BANDS_ORDER = ['sweet', 'warm', 'cool', 'unknown'];
const INITIAL_PER_BAND = 999;   // show all destinations in each band by default

// ── Graph view (price × air time, temp-encoded) ─────────────────────
// Color ramp: cool blue → teal → green → yellow → orange → red, indexed by °F.
function tempColor(f) {
  if (f == null || isNaN(f)) return '#94a3b8';
  // Stops at 55, 65, 72, 80, 86, 95
  const stops = [
    [55, [70, 130, 180]],   // steel blue
    [65, [56, 178, 172]],   // teal
    [72, [120, 190, 90]],   // green
    [80, [240, 200, 70]],   // warm yellow
    [86, [240, 130, 60]],   // orange
    [95, [210, 60, 60]],    // red
  ];
  if (f <= stops[0][0]) return rgb(stops[0][1]);
  if (f >= stops[stops.length - 1][0]) return rgb(stops[stops.length - 1][1]);
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i], [b, cb] = stops[i + 1];
    if (f >= a && f <= b) {
      const t = (f - a) / (b - a);
      return rgb([
        Math.round(ca[0] + (cb[0] - ca[0]) * t),
        Math.round(ca[1] + (cb[1] - ca[1]) * t),
        Math.round(ca[2] + (cb[2] - ca[2]) * t),
      ]);
    }
  }
  return '#94a3b8';
}
function rgb([r, g, b]) { return `rgb(${r},${g},${b})`; }

// Pick legible text color (black or white) given a fill color.
function textOnColor([r, g, b]) {
  // Relative luminance, simplified
  const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return l > 0.62 ? '#0f172a' : '#ffffff';
}

function graphPoints(finalists) {
  const pts = [];
  for (const d of finalists) {
    const fe = d.operational?.flight_estimate;
    const cl = d.operational?.climate;
    if (!fe || fe.quality === 'unviable') continue;
    const hrs = fe.total_hours_door_to_door;
    const usd = fe.round_trip_pp_usd;
    if (hrs == null || usd == null) continue;
    pts.push({
      slug: d.slug,
      name: d.name,
      country: d.country,
      hrs,
      usd,
      tempF: cl?.avg_high_F ?? null,
      hero: d._hero?.[0]?.url || (d._photoIndex && Object.values(d._photoIndex)[0]?.url) || '',
      tagline: d.operational?.tagline || '',
      ranking: d.ranking,
      stops: fe.stops || '',
      sampled: fe.sampled_window || '',
      cooldownReason: (d.operational?.cooldown_status && !d.operational.cooldown_status.ok)
        ? d.operational.cooldown_status.reason : null,
    });
  }
  return pts;
}

// Greedy label placement: try 8 offsets around the dot, pick the first that
// doesn't collide with already-placed label boxes. Returns {dx, dy, anchor}.
function placeLabel(cx, cy, placed, labelW, labelH, dotR) {
  const candidates = [
    { dx: 0,            dy: dotR + 14,         anchor: 'middle' },  // below
    { dx: 0,            dy: -(dotR + 6),       anchor: 'middle' },  // above
    { dx: dotR + 8,     dy: 4,                 anchor: 'start'  },  // right
    { dx: -(dotR + 8),  dy: 4,                 anchor: 'end'    },  // left
    { dx: dotR + 6,     dy: dotR + 12,         anchor: 'start'  },  // br
    { dx: -(dotR + 6),  dy: dotR + 12,         anchor: 'end'    },  // bl
    { dx: dotR + 6,     dy: -(dotR + 4),       anchor: 'start'  },  // tr
    { dx: -(dotR + 6),  dy: -(dotR + 4),       anchor: 'end'    },  // tl
  ];
  for (const c of candidates) {
    const x0 = c.anchor === 'middle' ? cx + c.dx - labelW / 2
            : c.anchor === 'start'  ? cx + c.dx
            :                          cx + c.dx - labelW;
    const y0 = cy + c.dy - labelH;
    const box = { x0, y0, x1: x0 + labelW, y1: y0 + labelH };
    let collides = false;
    for (const p of placed) {
      if (box.x1 < p.x0 || box.x0 > p.x1 || box.y1 < p.y0 || box.y0 > p.y1) continue;
      collides = true; break;
    }
    if (!collides) {
      placed.push(box);
      return c;
    }
  }
  // Fallback: below, accept overlap
  return candidates[0];
}

function renderGraph(trip, finalists) {
  const pts = graphPoints(finalists);
  const skipped = finalists.filter(d => {
    const fe = d.operational?.flight_estimate;
    return !fe || fe.quality === 'unviable' || fe.total_hours_door_to_door == null || fe.round_trip_pp_usd == null;
  });

  if (!pts.length) {
    return `<div class="graph-empty">No destinations have flight + climate data yet.</div>`;
  }

  // Axis bounds with a little padding
  const hrsMin = Math.floor(Math.min(...pts.map(p => p.hrs)) - 0.5);
  const hrsMax = Math.ceil(Math.max(...pts.map(p => p.hrs)) + 0.5);
  const usdMin = Math.floor((Math.min(...pts.map(p => p.usd)) - 50) / 100) * 100;
  const usdMax = Math.ceil((Math.max(...pts.map(p => p.usd)) + 50) / 100) * 100;

  // SVG geometry
  const W = 1280, H = 760;
  const M = { left: 90, right: 40, top: 50, bottom: 70 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const xScale = (h) => M.left + ((h - hrsMin) / (hrsMax - hrsMin)) * plotW;
  const yScale = (u) => M.top + plotH - ((u - usdMin) / (usdMax - usdMin)) * plotH;

  // X gridlines: every 1 hour
  const xTicks = [];
  for (let h = hrsMin; h <= hrsMax; h += 1) xTicks.push(h);
  // Y gridlines: every $100 (or $200 if range wide)
  const usdRange = usdMax - usdMin;
  const usdStep = usdRange > 1000 ? 200 : 100;
  const yTicks = [];
  for (let u = usdMin; u <= usdMax; u += usdStep) yTicks.push(u);

  // Determine cooldown points (rendered with reduced opacity + dashed ring)
  const dotR = 22;

  // Greedy label placement
  const placed = [];
  const dotInfo = pts.map(p => {
    const cx = xScale(p.hrs);
    const cy = yScale(p.usd);
    const labelW = Math.max(60, p.name.length * 7.2 + 8);
    const labelH = 16;
    const lp = placeLabel(cx, cy, placed, labelW, labelH, dotR);
    const lx = cx + lp.dx;
    const ly = cy + lp.dy;
    return { p, cx, cy, lx, ly, anchor: lp.anchor };
  });

  // SVG markup
  const gridX = xTicks.map(h => `
    <line class="graph-grid" x1="${xScale(h)}" x2="${xScale(h)}" y1="${M.top}" y2="${M.top + plotH}" />
    <text class="graph-axis-tick" x="${xScale(h)}" y="${M.top + plotH + 20}" text-anchor="middle">${h}h</text>
  `).join('');
  const gridY = yTicks.map(u => `
    <line class="graph-grid" x1="${M.left}" x2="${M.left + plotW}" y1="${yScale(u)}" y2="${yScale(u)}" />
    <text class="graph-axis-tick" x="${M.left - 10}" y="${yScale(u) + 4}" text-anchor="end">$${u}</text>
  `).join('');

  const dotsSvg = dotInfo.map(({ p, cx, cy, lx, ly, anchor }) => {
    const fill = tempColor(p.tempF);
    // Extract rgb to compute text-on-fill
    const m = fill.match(/rgb\((\d+),(\d+),(\d+)\)/);
    const txtCol = m ? textOnColor([+m[1], +m[2], +m[3]]) : '#fff';
    const dim = p.cooldownReason ? 'graph-dot-dim' : '';
    const tempLabel = p.tempF != null ? Math.round(p.tempF) : '·';
    return `
      <g class="graph-point ${dim}" data-slug="${esc(p.slug)}" data-name="${esc(p.name)}"
         data-country="${esc(p.country || '')}" data-hrs="${p.hrs.toFixed(1)}"
         data-usd="${p.usd}" data-temp="${p.tempF != null ? Math.round(p.tempF) : ''}"
         data-stops="${esc(p.stops)}" data-sampled="${esc(p.sampled)}"
         data-tagline="${esc(p.tagline)}" data-hero="${esc(p.hero)}"
         data-ranking="${p.ranking ?? ''}" data-cooldown="${esc(p.cooldownReason || '')}"
         tabindex="0" role="button" aria-label="${esc(p.name)}, ${p.hrs.toFixed(1)} hours, $${p.usd}, ${tempLabel}°F">
        <circle class="graph-dot" cx="${cx}" cy="${cy}" r="${dotR}" fill="${fill}" />
        <text class="graph-dot-temp" x="${cx}" y="${cy + 5}" text-anchor="middle" fill="${txtCol}">${tempLabel}</text>
        <text class="graph-dot-label" x="${lx}" y="${ly}" text-anchor="${anchor}">${esc(p.name)}</text>
      </g>
    `;
  }).join('');

  // Color legend (gradient bar under x-axis title, right-aligned)
  const legendStops = [55, 65, 72, 80, 86, 95];
  const legendBarStops = legendStops.map((t, i) =>
    `<stop offset="${(i / (legendStops.length - 1) * 100).toFixed(1)}%" stop-color="${tempColor(t)}"/>`
  ).join('');

  return `
    <div class="graph-wrap">
      <div class="graph-header">
        <div>
          <h2 class="graph-title">Air time vs. price</h2>
          <p class="graph-sub">Each dot is a finalist. Color and number show the typical August daytime high (°F). Hover for details. Faded dots are in the family-visit cooldown window.</p>
        </div>
        <div class="graph-legend">
          <div class="graph-legend-label">Daytime high (°F)</div>
          <svg width="240" height="22" viewBox="0 0 240 22">
            <defs>
              <linearGradient id="tempGrad" x1="0%" y1="0%" x2="100%" y2="0%">${legendBarStops}</linearGradient>
            </defs>
            <rect x="0" y="0" width="240" height="14" fill="url(#tempGrad)" rx="2" />
            ${legendStops.map((t, i) => `<text class="graph-legend-tick" x="${(i / (legendStops.length - 1) * 240).toFixed(1)}" y="22" text-anchor="${i === 0 ? 'start' : i === legendStops.length - 1 ? 'end' : 'middle'}">${t}°</text>`).join('')}
          </svg>
        </div>
      </div>

      <div class="graph-canvas">
        <svg class="graph-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Scatter plot of destinations: x-axis air time, y-axis air price, color encodes August high temperature">
          <text class="graph-axis-title" x="${M.left + plotW / 2}" y="${H - 18}" text-anchor="middle">Door-to-door air time (hours)</text>
          <text class="graph-axis-title" x="20" y="${M.top + plotH / 2}" text-anchor="middle" transform="rotate(-90 20 ${M.top + plotH / 2})">Round-trip per person ($)</text>
          ${gridX}
          ${gridY}
          <line class="graph-axis" x1="${M.left}" x2="${M.left + plotW}" y1="${M.top + plotH}" y2="${M.top + plotH}" />
          <line class="graph-axis" x1="${M.left}" x2="${M.left}" y1="${M.top}" y2="${M.top + plotH}" />
          ${dotsSvg}
        </svg>
        <div id="graph-hovercard" class="graph-hovercard" hidden></div>
      </div>

      ${skipped.length ? `
        <details class="graph-skipped">
          <summary>${skipped.length} destination${skipped.length === 1 ? '' : 's'} not on graph (no flight or climate data, or 2+ stops required)</summary>
          <ul>
            ${skipped.map(d => `<li><strong>${esc(d.name)}</strong>${d.country ? ', ' + esc(d.country) : ''}${d.operational?.flight_estimate?.quality === 'unviable' ? ' — 2+ stops required' : ' — missing data'}</li>`).join('')}
          </ul>
        </details>` : ''}
    </div>
  `;
}

function renderGraphView(trip, finalists) {
  $root.innerHTML = `
    ${renderHeader(trip)}
    <div id="trip-lightbox" hidden></div>
    <main class="trip-main">
      ${renderViewToggle('graph', finalists.length)}
      ${renderGraph(trip, finalists)}
    </main>
  `;
  window.scrollTo(0, 0);
}

function renderViewToggle(active, count) {
  const overviewActive = active === 'overview' ? 'view-toggle-active' : '';
  const graphActive    = active === 'graph'    ? 'view-toggle-active' : '';
  return `
    <div class="view-toggle">
      <a class="view-toggle-btn ${overviewActive}" href="?t=${encodeURIComponent(tripId)}" data-action="view-overview">
        <span class="view-toggle-icon">▦</span>
        <span class="view-toggle-label">Overview</span>
        <span class="view-toggle-sub">${count} cards by climate</span>
      </a>
      <a class="view-toggle-btn view-toggle-graph ${graphActive}" href="?t=${encodeURIComponent(tripId)}&v=graph" data-action="view-graph">
        <span class="view-toggle-icon">📊</span>
        <span class="view-toggle-label">Trade-off graph</span>
        <span class="view-toggle-sub">Air time × price × temp</span>
      </a>
    </div>
  `;
}

// ── Overview view ───────────────────────────────────────────────────
function renderOverview(trip, finalists) {
  const finalistsByBand = {};
  for (const f of finalists) (finalistsByBand[climateBand(f)] ||= []).push(f);

  const sectionsHtml = BANDS_ORDER
    .filter(b => finalistsByBand[b]?.length)
    .map(b => {
      const meta = BAND_META[b];
      const items = finalistsByBand[b];
      const visible = state.expandedBands.has(b) ? items : items.slice(0, INITIAL_PER_BAND);
      const hidden  = items.length - visible.length;
      const cards = visible.map(renderOverviewCard).join('');
      const moreBtn = hidden > 0 ? `
        <button class="band-more-btn" data-action="expand-band" data-band="${b}">
          Show all ${items.length} ${esc(meta.label.toLowerCase())} destinations →
        </button>` : (state.expandedBands.has(b) && items.length > INITIAL_PER_BAND ? `
        <button class="band-more-btn" data-action="collapse-band" data-band="${b}">
          Show fewer
        </button>` : '');
      return `
        <section class="climate-band climate-band-${b}">
          <header class="climate-band-header">
            <div class="climate-band-icon">${meta.icon}</div>
            <div class="climate-band-text">
              <h2 class="climate-band-title">${esc(meta.label)}</h2>
              <p class="climate-band-sub">${esc(meta.sub)}</p>
            </div>
            <div class="climate-band-count">${items.length} destination${items.length === 1 ? '' : 's'}</div>
          </header>
          <div class="overview-grid">${cards}</div>
          ${moreBtn}
        </section>
      `;
    }).join('');

  $root.innerHTML = `
    ${renderHeader(trip)}
    <div id="trip-lightbox" hidden></div>
    <main class="trip-main">
      ${renderViewToggle('overview', finalists.length)}
      ${sectionsHtml}
    </main>
  `;
  window.scrollTo(0, 0);
}

// ── Detail view ─────────────────────────────────────────────────────
function renderDetail(trip, dest) {
  if (!dest) {
    $root.innerHTML = `
      ${renderHeader(trip)}
      <main class="trip-main">
        <div class="detail-not-found">
          <a class="detail-back" href="?t=${encodeURIComponent(tripId)}" data-action="back-to-overview">← All destinations</a>
          <p>Destination not found.</p>
        </div>
      </main>
    `;
    return;
  }
  const hasReport = !!dest.report_md;
  const hasItin   = (dest.itinerary || []).length > 0;
  const stub = !hasReport && !hasItin
    ? `<div class="detail-stub">
         <p><strong>This destination doesn't have a fully composed plan yet.</strong> The overview card above shows what's known so far. To dig in: in your terminal, run the <code>discover-destinations</code> skill against trip <code>${esc(tripId)}</code> with this destination listed in the prompt — Claude will scrape its NYT 36 Hours article (or equivalents) and compose a full report + 4-day itinerary + photos.</p>
       </div>`
    : '';
  $root.innerHTML = `
    ${renderHeader(trip)}
    <div id="trip-lightbox" hidden></div>
    <main class="trip-main">
      <div class="detail-back-bar">
        <a class="detail-back" href="?t=${encodeURIComponent(tripId)}" data-action="back-to-overview">← All destinations</a>
      </div>
      ${renderDestination(dest)}
      ${stub}
    </main>
  `;
  window.scrollTo(0, 0);
}

// ── Routing + state ─────────────────────────────────────────────────
const state = {
  trip: null,
  finalists: [],
  bySlug: {},
  expandedBands: new Set(),
};

function render() {
  if (!state.trip) return;
  const sp = new URLSearchParams(location.search);
  const slug = sp.get('d');
  const view = sp.get('v');
  if (slug)               renderDetail(state.trip, state.bySlug[slug]);
  else if (view === 'graph') renderGraphView(state.trip, state.finalists);
  else                    renderOverview(state.trip, state.finalists);
}

function navigate({ d = null, v = null } = {}) {
  const params = new URLSearchParams();
  params.set('t', tripId);
  if (d) params.set('d', d);
  if (v) params.set('v', v);
  history.pushState({ d, v }, '', `?${params.toString()}`);
  render();
}

window.addEventListener('popstate', render);

// ── Click handler (overview cards, expand/collapse, back link, lightbox) ──
$root.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const action = t.dataset.action;
  if (action === 'open-detail') {
    e.preventDefault();
    navigate({ d: t.dataset.slug });
  } else if (action === 'back-to-overview') {
    e.preventDefault();
    navigate({});
  } else if (action === 'view-overview') {
    e.preventDefault();
    navigate({});
  } else if (action === 'view-graph') {
    e.preventDefault();
    navigate({ v: 'graph' });
  } else if (action === 'expand-band') {
    e.preventDefault();
    state.expandedBands.add(t.dataset.band);
    render();
  } else if (action === 'collapse-band') {
    e.preventDefault();
    state.expandedBands.delete(t.dataset.band);
    render();
  } else if (action === 'lightbox') {
    e.preventDefault();
    showLightbox(t.dataset.url, t.dataset.caption);
  }
});

// Click on a graph point opens that destination's detail page.
$root.addEventListener('click', (e) => {
  if (e.target.closest('[data-action]')) return;
  const gp = e.target.closest('.graph-point');
  if (!gp) return;
  e.preventDefault();
  navigate({ d: gp.dataset.slug });
});

// Hovercard for graph points.
function showHovercard(gp) {
  const $hc = document.getElementById('graph-hovercard');
  if (!$hc) return;
  const d = gp.dataset;
  const sourcesNote = d.cooldown
    ? `<div class="hc-cooldown">↩︎ ${esc(d.cooldown)}</div>` : '';
  const stopsLine = d.stops || d.sampled
    ? `<div class="hc-flight"><span>✈ ${esc(d.stops || '')}</span>${d.sampled ? `<span class="hc-flight-sub">${esc(d.sampled)}</span>` : ''}</div>`
    : '';
  $hc.innerHTML = `
    <div class="hc-card">
      ${d.hero ? `<div class="hc-image"><img src="${esc(d.hero)}" alt=""></div>` : ''}
      <div class="hc-body">
        ${d.ranking ? `<div class="hc-rank">#${esc(d.ranking)}</div>` : ''}
        <h3 class="hc-title">${esc(d.name)}</h3>
        ${d.country ? `<div class="hc-country">${esc(d.country)}</div>` : ''}
        <div class="hc-stats">
          <span class="hc-stat"><strong>${esc(d.hrs)}h</strong> air time</span>
          <span class="hc-stat"><strong>$${esc(d.usd)}</strong> rt/pp</span>
          ${d.temp ? `<span class="hc-stat"><strong>${esc(d.temp)}°F</strong> high</span>` : ''}
        </div>
        ${stopsLine}
        ${d.tagline ? `<p class="hc-tagline">${esc(d.tagline)}</p>` : ''}
        ${sourcesNote}
        <div class="hc-cta">Click to view full report →</div>
      </div>
    </div>
  `;
  $hc.hidden = false;
  positionHovercard(gp, $hc);
}
function positionHovercard(gp, $hc) {
  const svg = gp.closest('.graph-svg');
  const canvas = gp.closest('.graph-canvas');
  if (!svg || !canvas) return;
  // Find the dot's circle in screen coordinates
  const circle = gp.querySelector('.graph-dot');
  const dotRect = circle.getBoundingClientRect();
  const canvRect = canvas.getBoundingClientRect();
  const cardRect = $hc.firstElementChild.getBoundingClientRect();
  // Prefer right of the dot; if it'd overflow, place left; if short, place below.
  let left = dotRect.right - canvRect.left + 14;
  let top  = dotRect.top   - canvRect.top  - 8;
  if (left + cardRect.width > canvRect.width - 8) {
    left = dotRect.left - canvRect.left - cardRect.width - 14;
  }
  if (left < 8) left = 8;
  if (top + cardRect.height > canvRect.height - 8) {
    top = canvRect.height - cardRect.height - 8;
  }
  if (top < 8) top = 8;
  $hc.style.left = `${left}px`;
  $hc.style.top  = `${top}px`;
}
function hideHovercard() {
  const $hc = document.getElementById('graph-hovercard');
  if ($hc) $hc.hidden = true;
}
$root.addEventListener('mouseenter', (e) => {
  const gp = e.target.closest && e.target.closest('.graph-point');
  if (gp) showHovercard(gp);
}, true);
$root.addEventListener('mouseleave', (e) => {
  const gp = e.target.closest && e.target.closest('.graph-point');
  if (gp) hideHovercard();
}, true);
$root.addEventListener('focusin', (e) => {
  const gp = e.target.closest && e.target.closest('.graph-point');
  if (gp) showHovercard(gp);
});
$root.addEventListener('focusout', (e) => {
  const gp = e.target.closest && e.target.closest('.graph-point');
  if (gp) hideHovercard();
});
document.body.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action="close-lightbox"]');
  if (t) { e.preventDefault(); closeLightbox(); }
});
document.body.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLightbox();
});

// Main
async function load() {
  if (!tripId) { $root.innerHTML = '<p class="trip-empty">No trip token.</p>'; return; }
  $root.innerHTML = '<div class="trip-loading">Loading…</div>';

  const trip = await db.loadTrip(tripId);
  if (!trip) {
    $root.innerHTML = `<div class="trip-empty"><p>Trip <code>${esc(tripId)}</code> not found.</p><a href="/" class="trip-back">All trips</a></div>`;
    return;
  }

  const allDests = await db.loadTripDestinations(tripId);
  const finalists = allDests.filter(d => d.status === 'finalist').sort((a, b) => (a.ranking ?? 99) - (b.ranking ?? 99));

  const destIds = finalists.map(d => d.id);
  const photos = destIds.length ? await db.loadTripPhotos(destIds) : [];
  attachPhotosToDestinations(finalists, photos);

  if (finalists.length === 0) {
    $root.innerHTML = `
      ${renderHeader(trip)}
      <main class="trip-main trip-main-empty">
        <div class="trip-empty-state">
          <h2>No destinations yet</h2>
          <p>This trip is freshly created. Run the <code>discover-destinations</code> skill to populate it:</p>
          <pre>discover destinations for trip ${esc(tripId)}</pre>
        </div>
      </main>
    `;
    return;
  }

  state.trip = trip;
  state.finalists = finalists;
  state.bySlug = Object.fromEntries(finalists.map(d => [d.slug, d]));
  render();
}

load();
