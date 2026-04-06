// components.js — Pure rendering functions returning HTML strings
import { yelpUrl, mapsUrl } from './data.js';

function esc(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderSourceBadges(sources) {
  return sources.map(s => {
    const cls = `badge badge-${s.type}`;
    let label = s.type.charAt(0).toUpperCase() + s.type.slice(1);
    if (s.type === 'cnt') label = 'CNT';
    if (s.type === 'eater_new') label = 'Eater New';
    if (s.type === 'eater' && s.rank) label += ` #${s.rank}`;
    if (s.type === 'reddit') {
      const n = s.mentions || 1;
      label = `${n} Reddit rec${n !== 1 ? 's' : ''}`;
    }
    return `<span class="${cls}">${label}</span>`;
  }).join('');
}

function renderSourceButton(id, sources) {
  const n = sources.length;
  const dots = sources.map(s => `<span class="source-dot dot-${s.type}"></span>`).join('');
  return `<button class="sources-btn" data-action="show-sources" data-id="${id}">
    ${dots}<span class="sources-label">${n} source${n !== 1 ? 's' : ''}</span>
  </button>`;
}

// Total source count: 4 editorial articles + 11 Reddit threads = 15
export const TOTAL_SOURCE_COUNT = 15;

export function renderGlobalSourcesModal(allRestaurants) {
  // Count restaurants per source type
  const counts = {};
  for (const r of (allRestaurants || [])) {
    for (const s of r.sources) {
      counts[s.type] = (counts[s.type] || 0) + 1;
    }
  }
  const redditThreads = [
    { title: 'La Jolla Day — Where to hit?', url: 'https://www.reddit.com/r/FoodSanDiego/comments/1ljq6yg/la_jolla_day_where_to_hit/', sub: 'r/FoodSanDiego', comments: '29 answers' },
    { title: 'Must Try food in La Jolla', url: 'https://www.reddit.com/r/FoodSanDiego/comments/1gs8hhm/must_try_food_in_la_jolla/', sub: 'r/FoodSanDiego', comments: '40+ comments' },
    { title: 'Decent restaurants in La Jolla that aren\'t expensive', url: 'https://www.reddit.com/r/FoodSanDiego/comments/1qxquq8/what_are_some_decent_restaurants_in_la_jolla_that/', sub: 'r/FoodSanDiego', comments: '20+ comments' },
    { title: 'Fine dining near La Jolla', url: 'https://www.reddit.com/r/FoodSanDiego/comments/1or4bt6/fine_dining_near_la_jolla/', sub: 'r/FoodSanDiego', comments: '20+ comments' },
    { title: 'La Jolla restaurants with a view that aren\'t George\'s', url: 'https://www.reddit.com/r/FoodSanDiego/comments/1elp15q/la_jolla_restaurants_with_a_view_that_arent/', sub: 'r/FoodSanDiego', comments: '30+ comments' },
    { title: 'Best nice restaurant in La Jolla', url: 'https://www.reddit.com/r/FoodSanDiego/comments/x4fzt0/best_nice_restaurant_in_la_jolla/', sub: 'r/FoodSanDiego', comments: '30+ comments' },
    { title: 'Mid/High-End Restaurants that are actually WORTH IT', url: 'https://www.reddit.com/r/FoodSanDiego/comments/1lmusdd/midhighend_restaurants_that_are_actually_worth_it/', sub: 'r/FoodSanDiego', comments: '' },
    { title: 'What restaurants are a "can\'t miss" in SD?', url: 'https://www.reddit.com/r/FoodSanDiego/', sub: 'r/FoodSanDiego', comments: '' },
    { title: 'Underrated restaurants', url: 'https://www.reddit.com/r/sandiego/', sub: 'r/sandiego', comments: '' },
    { title: 'Most underrated restaurant in San Diego?', url: 'https://www.reddit.com/r/SanDiegan/', sub: 'r/SanDiegan', comments: '' },
    { title: 'Quintessential San Diego restaurants to take visitors to?', url: 'https://www.reddit.com/r/FoodSanDiego/', sub: 'r/sandiego', comments: '' },
  ];

  return `
  <div class="modal-overlay" data-action="close-modal">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h3>Sources</h3>
        <button class="modal-close" data-action="close-modal">&times;</button>
      </div>
      <div class="sources-modal-body">
        <div class="source-modal-item">
          <div class="source-modal-header">
            <span class="badge badge-eater">Eater San Diego</span>
            <a href="https://sandiego.eater.com/maps/38-best-restaurants-san-diego-california" target="_blank" rel="noopener" class="source-link">Open &rarr;</a>
          </div>
          <p class="source-modal-title">The 38 Best Restaurants in San Diego</p>
          <p class="source-harvest">${counts.eater || 0} restaurants harvested</p>
          <p class="source-modal-detail">Eater's curated list of 38 essential restaurants across San Diego County, updated quarterly. Covers all price points and cuisines.</p>
          <div class="source-modal-meta">
            <span>By Helen I. Hwang</span>
            <span>Updated Jan 2026</span>
            <span>High — professional editorial</span>
          </div>
        </div>

        <div class="source-modal-item">
          <div class="source-modal-header">
            <span class="badge badge-infatuation">The Infatuation</span>
            <a href="https://www.theinfatuation.com/san-diego/guides/san-diego-restaurants" target="_blank" rel="noopener" class="source-link">Open &rarr;</a>
          </div>
          <p class="source-modal-title">The 25 Best Restaurants in San Diego</p>
          <p class="source-harvest">${counts.infatuation || 0} restaurants harvested</p>
          <p class="source-modal-detail">The Infatuation's opinionated picks for San Diego's best restaurants with detailed, personality-driven reviews.</p>
          <div class="source-modal-meta">
            <span>By Infatuation Staff</span>
            <span>Updated 2026</span>
            <span>High — professional editorial</span>
          </div>
        </div>

        <div class="source-modal-item">
          <div class="source-modal-header">
            <span class="badge badge-cnt">Conde Nast Traveler</span>
            <a href="https://www.cntraveler.com/gallery/best-restaurants-in-san-diego" target="_blank" rel="noopener" class="source-link">Open &rarr;</a>
          </div>
          <p class="source-modal-title">The 25 Best Restaurants in San Diego</p>
          <p class="source-harvest">${counts.cnt || 0} restaurants harvested</p>
          <p class="source-modal-detail">Conde Nast Traveler's curated list of San Diego's 25 best restaurants, spanning fine dining to beloved casual spots.</p>
          <div class="source-modal-meta">
            <span>By Marie Tutko and Archana Ram</span>
            <span>Updated Oct 2024</span>
            <span>High — professional editorial</span>
          </div>
        </div>

        <div class="source-modal-item">
          <div class="source-modal-header">
            <span class="badge badge-eater_new">Eater Heatmap</span>
            <a href="https://sandiego.eater.com/maps/best-new-san-diego-restaurants-heatmap" target="_blank" rel="noopener" class="source-link">Open &rarr;</a>
          </div>
          <p class="source-modal-title">Best New Restaurants in San Diego, April 2026</p>
          <p class="source-harvest">${counts.eater_new || 0} restaurants harvested</p>
          <p class="source-modal-detail">Eater San Diego's heatmap of the hottest new restaurant openings, updated monthly. Focuses on the newest and most exciting additions to the SD dining scene.</p>
          <div class="source-modal-meta">
            <span>By Helen I. Hwang, Matthew Kang, Mona Holmes</span>
            <span>Updated Apr 2026</span>
            <span>High — professional editorial</span>
          </div>
        </div>

        <div class="source-modal-item">
          <div class="source-modal-header">
            <span class="badge badge-reddit">Reddit</span>
          </div>
          <p class="source-modal-title">Crowd wisdom from ${redditThreads.length} threads</p>
          <p class="source-harvest">${counts.reddit || 0} restaurants harvested</p>
          <p class="source-modal-detail">Aggregated recommendations from local San Diego food communities.</p>
          <div class="source-modal-meta">
            <span>Medium-high — local crowd wisdom</span>
          </div>
          <ul class="reddit-threads">
            ${redditThreads.map(t => `
              <li>
                <a href="${t.url}" target="_blank" rel="noopener">${esc(t.title)}</a>
                <span class="thread-meta">${esc(t.sub)}${t.comments ? ' · ' + esc(t.comments) : ''}</span>
              </li>
            `).join('')}
          </ul>
        </div>
      </div>
    </div>
  </div>`;
}

function renderSourceInline(sources) {
  const items = sources
    .filter(s => s.detail)
    .map(s => {
      let label, badgeLabel;
      if (s.type === 'reddit') {
        const n = s.mentions || 1;
        badgeLabel = `${n} rec${n !== 1 ? 's' : ''}`;
      } else {
        badgeLabel = s.type.charAt(0).toUpperCase() + s.type.slice(1);
        if (s.rank) badgeLabel += ` #${s.rank}`;
      }
      return `<div class="source-summary">
        <span class="badge badge-${s.type} badge-sm">${badgeLabel}</span>
        <span class="source-text">${esc(s.detail)}</span>
      </div>`;
    });
  if (!items.length) return '';
  return `<div class="source-summaries">${items.join('')}</div>`;
}

function renderPhotoCarousel(r) {
  const photos = r.photos || (r.photoUrl ? [r.photoUrl] : []);
  if (!photos.length) return '';
  if (photos.length === 1) {
    return `<div class="card-photo"><img src="${esc(photos[0])}" alt="${esc(r.name)}" loading="lazy"></div>`;
  }
  return `<div class="carousel" data-id="${r.id}">
    <div class="carousel-track">
      ${photos.map((url, i) => `<img src="${esc(url)}" alt="${esc(r.name)}" loading="lazy" class="carousel-img ${i === 0 ? 'active' : ''}">`).join('')}
    </div>
    <div class="carousel-dots">
      ${photos.map((_, i) => `<span class="carousel-dot ${i === 0 ? 'active' : ''}" data-idx="${i}"></span>`).join('')}
    </div>
  </div>`;
}

export function renderVoteButtons(id, vote) {
  const btns = [
    { val: -1, icon: '👎', label: 'no' },
    { val: 1, icon: '👍', label: 'yes' },
  ];
  return `<div class="vote-row">${btns.map(b =>
    `<button class="vote-btn ${vote === b.val ? 'active vote-' + (b.val > 0 ? 'up' : 'down') : ''}"
       data-action="vote" data-id="${id}" data-vote="${b.val}"
       aria-label="${b.label}">${b.icon}</button>`
  ).join('')}</div>`;
}

function renderOtherVotes(allVotes) {
  if (!allVotes || !allVotes.length) return '';
  const icons = { '-2': '👎', '-1': '👎', '1': '👍', '2': '👍' };
  const items = allVotes.map(v =>
    `<span class="other-vote ${v.vote > 0 ? 'pos' : 'neg'}">${esc(v.user)} ${icons[v.vote] || ''}</span>`
  ).join('');
  return `<div class="other-votes">${items}</div>`;
}

export function renderCard(r, us) {
  const state = us || {};
  const vote = state.vote || 0;
  const status = state.status || 'default';
  const comments = state.comments || [];
  const commentCount = comments.length;
  const lastComment = comments.length ? comments[comments.length - 1] : null;
  const isShortlisted = status === 'shortlisted';
  const allVotes = state.allVotes || [];

  return `
  <div class="card ${status}" data-id="${r.id}">
    ${(r.photos?.length || r.photoUrl) ? renderPhotoCarousel(r) : ''}
    ${allVotes.length ? `<div class="card-topbar">${renderOtherVotes(allVotes)}</div>` : ''}
    <div class="card-header" data-action="toggle-detail" data-id="${r.id}">
      <div class="card-title-row">
        <h3 class="card-name">${esc(r.name)}</h3>
        <span class="card-title-right">
          ${r.googleRating ? `<span class="card-rating">${r.googleRating}★${r.googleReviewCount ? `<span class="card-review-count">(${r.googleReviewCount.toLocaleString()})</span>` : ''}</span>` : ''}
          ${r.price ? `<span class="card-price">${esc(r.price)}</span>` : ''}
        </span>
      </div>
      <div class="card-meta">
        ${r.neighborhood ? `<span class="card-neighborhood">${esc(r.neighborhood)}</span>` : ''}
        ${r.cuisine ? `<span class="card-cuisine">${esc(r.cuisine)}</span>` : ''}
      </div>
      <div class="card-badges">${renderSourceBadges(r.sources)}</div>
      ${r.highlights ? `<p class="card-highlights">${esc(r.highlights)}</p>` : ''}
      ${r.insiderTip ? `<p class="card-tip"><strong>Tip:</strong> ${esc(r.insiderTip)}</p>` : ''}
      ${lastComment ? `<div class="card-last-comment" data-action="toggle-detail" data-id="${r.id}">
        <span class="last-comment-author">${esc(lastComment.author || 'You')}:</span>
        <span class="last-comment-text">${esc(lastComment.text)}</span>
        ${commentCount > 1 ? `<span class="last-comment-more">+${commentCount - 1} more</span>` : ''}
      </div>` : ''}
    </div>
    <div class="card-actions">
      <div class="card-links-row">
        <a class="action-btn link-btn" href="${yelpUrl(r.name, r.neighborhood)}" target="_blank" rel="noopener">Yelp</a>
        ${r.website ? `<a class="action-btn link-btn" href="${esc(r.website)}" target="_blank" rel="noopener">Web</a>` : ''}
        <a class="action-btn link-btn" href="${mapsUrl(r.name, r.address)}" target="_blank" rel="noopener">Map</a>
      </div>
      <div class="card-interact-row">
        ${renderVoteButtons(r.id, vote)}
        <button class="interact-btn comment-btn" data-action="toggle-detail" data-id="${r.id}">
          💬${commentCount > 0 ? `<span class="comment-count">${commentCount}</span>` : ''}
        </button>
      </div>
    </div>
  </div>`;
}

export function renderShortlistCard(r, us, rank) {
  const state = us || {};
  const vote = state.vote || 0;
  return `
  <div class="card shortlist-card" data-id="${r.id}">
    <div class="drag-handle" aria-label="Drag to reorder">⠿</div>
    <div class="card-rank">${rank}</div>
    <div class="card-body">
      <div class="card-header" data-action="toggle-detail" data-id="${r.id}">
        <div class="card-title-row">
          <h3 class="card-name">${esc(r.name)}</h3>
          ${r.price ? `<span class="card-price">${esc(r.price)}</span>` : ''}
        </div>
        <div class="card-meta">
          ${r.neighborhood ? `<span class="card-neighborhood">${esc(r.neighborhood)}</span>` : ''}
        </div>
        <div class="card-badges">${renderSourceBadges(r.sources)}</div>
      </div>
      <div class="action-row">
        ${renderVoteButtons(r.id, vote)}
        <button class="action-btn remove-btn" data-action="unshortlist" data-id="${r.id}">Remove</button>
      </div>
    </div>
  </div>`;
}

export function renderTrashCard(r) {
  return `
  <div class="card trash-card" data-id="${r.id}">
    <div class="card-header">
      <h3 class="card-name">${esc(r.name)}</h3>
      <span class="card-neighborhood">${esc(r.neighborhood || '')}</span>
    </div>
    <button class="action-btn restore-btn" data-action="restore" data-id="${r.id}">Restore</button>
  </div>`;
}

export function renderDetail(r, us) {
  const state = us || {};
  const comments = state.comments || [];
  return `
  <div class="detail-sheet" data-id="${r.id}">
    <div class="detail-header">
      <button class="detail-close" data-action="close-detail" aria-label="Close">&times;</button>
      <h2>${esc(r.name)}</h2>
      <div class="detail-meta">
        ${r.neighborhood ? `<span>${esc(r.neighborhood)}</span>` : ''}
        ${r.price ? `<span>${esc(r.price)}</span>` : ''}
        ${r.cuisine ? `<span>${esc(r.cuisine)}</span>` : ''}
        ${r.openFor ? `<span>Open for: ${esc(r.openFor)}</span>` : ''}
      </div>
      ${r.address ? `<p class="detail-address">${esc(r.address)}</p>` : ''}
      <div class="detail-links">
        <a href="${yelpUrl(r.name, r.neighborhood)}" target="_blank" class="detail-link">Yelp</a>
        ${r.website ? `<a href="${esc(r.website)}" target="_blank" class="detail-link">Website</a>` : ''}
        <a href="${mapsUrl(r.name, r.address)}" target="_blank" class="detail-link">Google Maps</a>
      </div>
    </div>
    <div class="detail-body">
      ${r.highlights ? `<div class="detail-section"><h4>Highlights</h4><p>${esc(r.highlights)}</p></div>` : ''}
      ${r.insiderTip ? `<div class="detail-section"><h4>Insider Tip</h4><p>${esc(r.insiderTip)}</p></div>` : ''}
      <div class="detail-section">
        <h4>Sources</h4>
        ${r.sources.map(s => `
          <div class="source-detail">
            <span class="badge badge-${s.type}">${s.type}${s.rank ? ' #' + s.rank : ''}</span>
            ${s.detail ? `<p>${esc(s.detail)}</p>` : ''}
            ${s.mentions ? `<p class="source-mentions">${s.mentions} Reddit mention${s.mentions > 1 ? 's' : ''}</p>` : ''}
          </div>
        `).join('')}
      </div>
      <div class="detail-section">
        <h4>Comments</h4>
        ${renderCommentThread(comments, null, r.id)}
        <form class="comment-form" data-action="add-comment" data-id="${r.id}">
          <textarea placeholder="Add a comment..." rows="2" required></textarea>
          <button type="submit">Post</button>
        </form>
      </div>
    </div>
  </div>`;
}

function renderCommentThread(comments, parentId, restaurantId) {
  const thread = comments.filter(c => (c.parentId || null) === parentId);
  if (!thread.length) return '';
  return `<div class="comment-thread ${parentId ? 'reply-thread' : ''}">
    ${thread.map(c => `
      <div class="comment" data-comment-id="${c.id}">
        <div class="comment-header">
          <strong>${esc(c.author || 'You')}</strong>
          <span class="comment-time">${new Date(c.timestamp).toLocaleDateString()}</span>
        </div>
        <p class="comment-text">${esc(c.text)}</p>
        <button class="reply-btn" data-action="reply" data-id="${restaurantId}" data-parent="${c.id}">Reply</button>
        ${renderCommentThread(comments, c.id, restaurantId)}
      </div>
    `).join('')}
  </div>`;
}

export function renderAddForm() {
  return `
  <div class="modal-overlay" data-action="close-modal">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h3>Add Restaurant</h3>
        <button class="modal-close" data-action="close-modal">&times;</button>
      </div>
      <form class="add-form" data-action="submit-add">
        <label>Name *<input type="text" name="name" required></label>
        <label>Neighborhood<input type="text" name="neighborhood"></label>
        <label>Address<input type="text" name="address"></label>
        <label>Cuisine<input type="text" name="cuisine"></label>
        <label>Price
          <select name="price">
            <option value="">--</option>
            <option>$</option><option>$$</option><option>$$$</option><option>$$$$</option>
          </select>
        </label>
        <label>Notes<textarea name="notes" rows="3"></textarea></label>
        <button type="submit" class="submit-btn">Add</button>
      </form>
    </div>
  </div>`;
}

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

export function renderFilterPane(activeFilters, totalCount, filteredCount, hasMapFilter) {
  const now = new Date();
  const today = now.getDay();
  const currentHour = now.getHours();
  const currentMin = now.getMinutes();
  const nowTime = `${String(currentHour).padStart(2,'0')}:${String(currentMin).padStart(2,'0')}`;

  const dayChips = DAYS.map((d, i) => {
    const short = d.substring(0, 3);
    const isToday = i === today;
    const active = activeFilters.day === i;
    return `<button class="fp-chip ${active ? 'active' : ''} ${isToday ? 'today' : ''}" data-action="filter-day" data-day="${i}">${short}${isToday ? ' ·today' : ''}</button>`;
  }).join('');

  const openNow = activeFilters.openNow;
  const minRating = activeFilters.minRating || 0;
  const filterTime = activeFilters.time || '';
  const hasFilters = openNow || minRating || activeFilters.day !== null || filterTime;

  // Rating slider label
  const ratingLabel = minRating ? `${minRating}+ ★` : 'Any';

  // Time quick-pick buttons
  const timeSlots = [
    { label: 'Breakfast', time: '08:00' },
    { label: 'Lunch', time: '12:00' },
    { label: 'Happy hr', time: '16:30' },
    { label: 'Dinner', time: '19:00' },
    { label: 'Late', time: '21:30' },
  ];
  const timeChips = timeSlots.map(s => {
    const active = filterTime === s.time;
    return `<button class="fp-chip fp-chip-sm ${active ? 'active' : ''}" data-action="filter-time-quick" data-time="${s.time}">${s.label}</button>`;
  }).join('');

  return `<div class="filter-pane">
    <div class="fp-count">${filteredCount} of ${totalCount} showing</div>

    <div class="fp-section">
      <h4>Location</h4>
      <button class="fp-chip fp-map-btn ${hasMapFilter ? 'active' : ''}" data-action="open-map">
        🗺 ${hasMapFilter ? 'Map area active' : 'Filter by map area'}
      </button>
    </div>

    <div class="fp-section">
      <h4>Rating</h4>
      <div class="fp-slider-row">
        <input type="range" class="fp-slider" min="0" max="5" step="0.5" value="${minRating}" data-action="filter-rating-slider">
        <span class="fp-slider-value">${ratingLabel}</span>
      </div>
      <div class="fp-slider-labels">
        <span>Any</span><span>3</span><span>3.5</span><span>4</span><span>4.5</span><span>5</span>
      </div>
    </div>

    <div class="fp-section">
      <h4>Hours</h4>
      <button class="fp-chip ${openNow ? 'active' : ''}" data-action="filter-open-now" style="margin-bottom:10px">
        Open now <span class="fp-chip-sub">${DAYS[today].substring(0,3)} ${nowTime}</span>
      </button>
      <div class="fp-subsection">
        <div class="fp-label">Or pick a day & time</div>
        <div class="fp-row fp-days">${dayChips}</div>
        <div class="fp-row" style="margin-top:8px">
          ${timeChips}
          <div class="fp-time-custom">
            <input type="time" class="fp-time-input" value="${filterTime}" data-action="filter-time-input">
          </div>
        </div>
      </div>
    </div>

  </div>`;
}

export function activeFilterCount(filters) {
  let n = 0;
  if (filters.openNow) n++;
  if (filters.minRating) n++;
  if (filters.day !== null && filters.day !== undefined) n++;
  if (filters.time) n++;
  return n;
}

export function renderEmptyState(view) {
  const msgs = {
    all: 'No restaurants to show.',
    shortlist: 'No restaurants shortlisted yet. Tap ☆ on a restaurant to add it.',
    trash: 'Trash is empty.',
  };
  return `<div class="empty-state">${msgs[view] || msgs.all}</div>`;
}
