// app.js — Main controller with Supabase backend for shared state
import { loadRestaurants, getAllRestaurants, generateId, setCityContext } from './data.js?v=1775460000';
import * as local from './storage.js?v=1775460000';
import * as db from './supabase.js?v=1775460000';
import * as groupCtx from './group.js?v=1775460000';
import { renderCard, renderShortlistCard, renderTrashCard, renderDetail, renderAddForm, renderEmptyState, renderGlobalSourcesModal, TOTAL_SOURCE_COUNT, renderFilterPane, activeFilterCount } from './components.js?v=1775460000';
import { initSortable, destroySortable } from './drag.js?v=1775460000';
import { initMap, clearFilterExternal, openDrawer as openMapDrawer, closeDrawer as closeMapDrawer, highlightMarker } from './map.js?v=1775460000';

const useDB = db.isConfigured();

const state = {
  view: 'all',
  userName: null,
  mapFilter: null, // null = no filter, Set<string> = filtered restaurant IDs
  filters: { day: null, openNow: false, minRating: 0, time: '' },
  // allState[restaurantId][userName] = { vote, status, shortlistPosition }
  allState: {},
  // allComments[restaurantId] = [{ id, text, author, timestamp, parentId }]
  allComments: {},
  restaurants: [],
  openDetail: null,
};

const $content = document.getElementById('content');
const $addBtn = document.getElementById('add-btn');
const $modalContainer = document.getElementById('modal-container');
const $detailContainer = document.getElementById('detail-container');
const $shortlistCount = document.getElementById('shortlist-count');

// ── Helpers ──

function myState(restaurantId) {
  const perUser = state.allState[restaurantId];
  return perUser?.[state.userName] || { vote: 0, status: 'default', shortlistPosition: 0 };
}

function allVotes(restaurantId) {
  const perUser = state.allState[restaurantId];
  if (!perUser) return [];
  return Object.entries(perUser)
    .filter(([, s]) => s.vote !== 0)
    .map(([user, s]) => ({ user, vote: s.vote }));
}

function commentsFor(restaurantId) {
  return state.allComments[restaurantId] || [];
}

function commentCount(restaurantId) {
  return commentsFor(restaurantId).length;
}

// Build the per-user view state for rendering (combines my status with shared comments)
function viewState(restaurantId) {
  const my = myState(restaurantId);
  return {
    vote: my.vote,
    status: my.status,
    comments: commentsFor(restaurantId),
    allVotes: allVotes(restaurantId),
  };
}

function myShortlistOrder() {
  const ids = [];
  for (const [rid, perUser] of Object.entries(state.allState)) {
    const my = perUser[state.userName];
    if (my?.status === 'shortlisted') {
      ids.push({ id: rid, pos: my.shortlistPosition || 0 });
    }
  }
  ids.sort((a, b) => a.pos - b.pos);
  return ids.map(x => x.id);
}

function isOpenAtDayTime(r, day, time) {
  if (!r.openingHours?.periods?.length) return true; // unknown = don't filter out
  return r.openingHours.periods.some(p => {
    if (p.day !== day) return false;
    if (!time || !p.open || !p.close) return true; // day matches, no time constraint
    if (p.close < p.open) {
      return time >= p.open || time <= p.close;
    }
    return time >= p.open && time <= p.close;
  });
}

function isOpenNow(r) {
  if (!r.openingHours?.periods?.length) return true; // unknown = don't filter out
  const now = new Date();
  const day = now.getDay();
  const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  return r.openingHours.periods.some(p => {
    if (p.day !== day) return false;
    if (!p.open || !p.close) return true; // open period exists for this day
    // Handle overnight (close < open means past midnight)
    if (p.close < p.open) {
      return time >= p.open || time <= p.close;
    }
    return time >= p.open && time <= p.close;
  });
}

function getFilteredListFromState(view) {
  const all = getAllRestaurants();
  const shortlistOrder = myShortlistOrder();

  if (view === 'shortlist') {
    const shortlisted = all.filter(r => myState(r.id).status === 'shortlisted');
    return shortlistOrder
      .map(id => shortlisted.find(r => r.id === id))
      .filter(Boolean)
      .concat(shortlisted.filter(r => !shortlistOrder.includes(r.id)));
  }
  if (view === 'trash') {
    return all.filter(r => myState(r.id).status === 'trashed');
  }
  let visible = all.filter(r => myState(r.id).status !== 'trashed');
  // Apply map filter if active
  if (state.mapFilter) {
    visible = visible.filter(r => state.mapFilter.has(r.id));
  }
  // Apply rating filter
  if (state.filters.minRating) {
    visible = visible.filter(r => (r.googleRating || 0) >= state.filters.minRating);
  }
  // Apply day+time filter
  if (state.filters.day !== null && state.filters.day !== undefined) {
    const time = state.filters.time || null;
    visible = visible.filter(r => isOpenAtDayTime(r, state.filters.day, time));
  }
  // Apply open-now filter
  if (state.filters.openNow) {
    visible = visible.filter(r => isOpenNow(r));
  }
  // Sort by vote: double thumbs up first, then thumbs up, then unvoted, then thumbs down, then double thumbs down
  visible.sort((a, b) => {
    const va = myState(a.id).vote || 0;
    const vb = myState(b.id).vote || 0;
    if (vb !== va) return vb - va; // higher vote first
    // Within same vote level, keep original order (source count)
    return 0;
  });
  return visible;
}

function updateShortlistBadge() {
  if (!$shortlistCount) return;
  const count = Object.entries(state.allState)
    .filter(([, perUser]) => perUser[state.userName]?.status === 'shortlisted').length;
  $shortlistCount.textContent = count > 0 ? count : '';
  $shortlistCount.hidden = count === 0;
}

// ── State mutations ──

function ensureState(restaurantId) {
  if (!state.allState[restaurantId]) state.allState[restaurantId] = {};
  if (!state.allState[restaurantId][state.userName]) {
    state.allState[restaurantId][state.userName] = { vote: 0, status: 'default', shortlistPosition: 0 };
  }
  return state.allState[restaurantId][state.userName];
}

async function setVote(restaurantId, vote) {
  const s = ensureState(restaurantId);
  s.vote = s.vote === vote ? 0 : vote;
  if (useDB) await db.setVote(restaurantId, state.userName, s.vote);
}

async function setStatus(restaurantId, status) {
  const s = ensureState(restaurantId);
  s.status = status;
  if (useDB) await db.setStatus(restaurantId, state.userName, status, s.shortlistPosition);
}

async function reorderShortlist(orderedIds) {
  for (let i = 0; i < orderedIds.length; i++) {
    const s = ensureState(orderedIds[i]);
    s.shortlistPosition = i;
  }
  if (useDB) await db.updateShortlistPositions(state.userName, orderedIds);
}

async function postComment(restaurantId, text, parentId = null) {
  const id = 'c' + Date.now();
  const comment = { id, text, author: state.userName, timestamp: Date.now(), parentId };
  if (!state.allComments[restaurantId]) state.allComments[restaurantId] = [];
  state.allComments[restaurantId].push(comment);
  if (useDB) await db.addComment(restaurantId, state.userName, text, parentId);
  return id;
}

async function addNewRestaurant(restaurant) {
  if (useDB) await db.addCustomRestaurant(restaurant, state.userName);
  else {
    const custom = local.loadCustomRestaurants();
    custom.push(restaurant);
    local.saveCustomRestaurants(custom);
  }
}

// ── Rendering ──

function render() {
  const list = getFilteredListFromState('all');

  if (!list.length) {
    $content.innerHTML = renderEmptyState('all');
    return;
  }

  $content.innerHTML = list.map(r =>
    renderCard(r, viewState(r.id))
  ).join('');

  updateShortlistBadge();
  updateFilterBadge();
  setupCarousels();
  setupScrollHighlight();
}

function openDetail(id) {
  const r = getAllRestaurants().find(r => r.id === id);
  if (!r) return;
  state.openDetail = id;
  $detailContainer.innerHTML = renderDetail(r, viewState(id));
  $detailContainer.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeDetail() {
  state.openDetail = null;
  $detailContainer.classList.remove('open');
  $detailContainer.innerHTML = '';
  document.body.style.overflow = '';
}

// ── Actions ──

async function handleAction(action, id, el) {
  switch (action) {
    case 'vote': {
      const vote = parseInt(el.dataset.vote);
      await setVote(id, vote);
      // Update just this card's vote buttons immediately without re-sorting
      const card = el.closest('.card');
      if (card) {
        const newVote = myState(id).vote;
        card.querySelectorAll('.vote-btn').forEach(b => {
          const bv = parseInt(b.dataset.vote);
          b.classList.toggle('active', bv === newVote);
          b.classList.toggle('vote-up', bv === newVote && bv > 0);
          b.classList.toggle('vote-down', bv === newVote && bv < 0);
        });
      }
      // Re-sort after a short delay so user sees the toggle
      setTimeout(() => {
        render();
        if (state.openDetail) openDetail(id);
      }, 400);
      break;
    }
    case 'shortlist': {
      const my = myState(id);
      if (my.status === 'shortlisted') {
        await setStatus(id, 'default');
      } else {
        await setStatus(id, 'shortlisted');
      }
      render();
      break;
    }
    case 'unshortlist': {
      await setStatus(id, 'default');
      render();
      break;
    }
    case 'trash': {
      await setStatus(id, 'trashed');
      render();
      break;
    }
    case 'restore': {
      await setStatus(id, 'default');
      render();
      break;
    }
    case 'toggle-detail': {
      if (state.openDetail === id) closeDetail();
      else openDetail(id);
      break;
    }
    case 'close-detail': {
      closeDetail();
      break;
    }
    case 'show-sources': {
      $modalContainer.innerHTML = renderGlobalSourcesModal(getAllRestaurants());
      $modalContainer.hidden = false;
      break;
    }
    case 'close-modal': {
      $modalContainer.innerHTML = '';
      $modalContainer.hidden = true;
      break;
    }
    case 'reply': {
      const parentId = el.dataset.parent;
      const existing = el.parentElement.querySelector('.inline-reply-form');
      if (existing) { existing.remove(); return; }
      const form = document.createElement('form');
      form.className = 'comment-form inline-reply-form';
      form.innerHTML = `<textarea placeholder="Reply..." rows="2" required></textarea><button type="submit">Reply</button>`;
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = form.querySelector('textarea').value.trim();
        if (!text) return;
        await postComment(id, text, parentId);
        openDetail(id);
      });
      el.parentElement.appendChild(form);
      form.querySelector('textarea').focus();
      break;
    }
  }
}

// ── Carousel ──

// ── Scroll Highlight ──

let _scrollObserver = null;
let _highlightedCardId = null;

function setupScrollHighlight() {
  if (_scrollObserver) _scrollObserver.disconnect();

  const cards = $content.querySelectorAll('.card[data-id]');
  if (!cards.length) return;

  _scrollObserver = new IntersectionObserver((entries) => {
    // Find the topmost visible card
    let topCard = null;
    let topY = Infinity;
    for (const entry of entries) {
      if (entry.isIntersecting && entry.boundingClientRect.top < topY) {
        topY = entry.boundingClientRect.top;
        topCard = entry.target;
      }
    }
    if (topCard) {
      const id = topCard.dataset.id;
      if (id !== _highlightedCardId) {
        // Remove old highlight
        if (_highlightedCardId) {
          const old = $content.querySelector(`.card[data-id="${_highlightedCardId}"]`);
          if (old) old.classList.remove('card-highlighted');
        }
        _highlightedCardId = id;
        topCard.classList.add('card-highlighted');
        highlightMarker(id);
      }
    }
  }, {
    root: null,
    rootMargin: '-56px 0px -70% 0px', // top = header height, bottom = ignore lower 70%
    threshold: 0,
  });

  cards.forEach(card => _scrollObserver.observe(card));
}

function setupCarousels() {
  document.querySelectorAll('.carousel').forEach(carousel => {
    const track = carousel.querySelector('.carousel-track');
    const dots = carousel.querySelectorAll('.carousel-dot');
    const imgs = carousel.querySelectorAll('.carousel-img');
    const count = imgs.length;
    let current = 0;
    let startX = 0;

    function goTo(idx) {
      current = Math.max(0, Math.min(count - 1, idx));
      track.style.transform = `translateX(-${current * 100}%)`;
      dots.forEach((d, i) => d.classList.toggle('active', i === current));
    }

    // Swipe
    carousel.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
    }, { passive: true });
    carousel.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - startX;
      if (dx < -40) goTo(current + 1);
      else if (dx > 40) goTo(current - 1);
    }, { passive: true });

    // Dot click
    dots.forEach(dot => {
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        goTo(parseInt(dot.dataset.idx));
      });
    });

    // Tap left/right halves
    carousel.addEventListener('click', (e) => {
      if (e.target.closest('.carousel-dot')) return;
      const rect = carousel.getBoundingClientRect();
      const x = e.clientX - rect.left;
      if (x > rect.width / 2) goTo(current + 1);
      else goTo(current - 1);
    });
  });
}

// ── Event delegation ──

function setupEvents() {
  $content.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;

    if (action && id) {
      e.preventDefault();
      handleAction(action, id, btn);
    }
  });

  $detailContainer.addEventListener('click', (e) => {
    // Don't intercept clicks inside comment forms (textareas, submit buttons)
    if (e.target.closest('.comment-form')) return;
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (action) {
      e.preventDefault();
      handleAction(action, id, btn);
    }
  });

  // Comment form submission — use event delegation with click on the Post button
  $detailContainer.addEventListener('click', async (e) => {
    const submitBtn = e.target.closest('.comment-form button[type="submit"]');
    if (!submitBtn) return;
    e.preventDefault();
    const form = submitBtn.closest('.comment-form');
    const id = form.dataset.id;
    const textarea = form.querySelector('textarea');
    const text = textarea.value.trim();
    if (!text) return;
    submitBtn.disabled = true;
    submitBtn.textContent = '...';
    await postComment(id, text, null);
    openDetail(id);
  });

  // Filter button in header
  document.getElementById('filter-btn').addEventListener('click', () => showFilterModal());
  document.getElementById('filter-modal-close').addEventListener('click', () => closeFilterModal());
  document.getElementById('filter-modal').addEventListener('click', (e) => {
    if (e.target.id === 'filter-modal') closeFilterModal();
  });

  // Floating map toggle
  const $fab = document.getElementById('map-fab');
  let mapOpen = false;
  $fab.addEventListener('click', () => {
    if (mapOpen) {
      closeMapDrawer();
      $fab.querySelector('#map-fab-icon').textContent = '🗺';
      $fab.querySelector('#map-fab-label').textContent = 'Map';
      $fab.classList.remove('fab-active');
      mapOpen = false;
    } else {
      openMapDrawer();
      $fab.querySelector('#map-fab-icon').textContent = '📋';
      $fab.querySelector('#map-fab-label').textContent = 'List';
      $fab.classList.add('fab-active');
      mapOpen = true;
    }
  });

  $addBtn.addEventListener('click', () => {
    $modalContainer.innerHTML = renderAddForm();
    $modalContainer.hidden = false;
  });

  document.querySelector('[data-action="show-sources"]')?.addEventListener('click', () => {
    $modalContainer.innerHTML = renderGlobalSourcesModal(getAllRestaurants());
    $modalContainer.hidden = false;
  });

  $modalContainer.addEventListener('click', (e) => {
    // Close on overlay click or any close-modal button (including × inside the modal)
    const btn = e.target.closest('[data-action="close-modal"]');
    const isOverlay = e.target.classList.contains('modal-overlay');
    if (btn || isOverlay) {
      $modalContainer.innerHTML = '';
      $modalContainer.hidden = true;
    }
  }, true); // useCapture to beat stopPropagation

  $modalContainer.addEventListener('submit', async (e) => {
    if (!e.target.matches('[data-action="submit-add"]')) return;
    e.preventDefault();
    const form = e.target;
    const name = form.name.value.trim();
    if (!name) return;
    const newR = {
      id: generateId(),
      name,
      neighborhood: form.neighborhood.value.trim() || null,
      address: form.address.value.trim() || null,
      cuisine: form.cuisine.value.trim() || null,
      price: form.price.value || null,
      openFor: null,
      highlights: form.notes.value.trim() || null,
      insiderTip: null,
      website: null,
      inTargetArea: true,
      notes: 'Manually added',
      sources: [{ type: 'manual', detail: `Added by ${state.userName}` }],
    };
    await addNewRestaurant(newR);
    $modalContainer.innerHTML = '';
    $modalContainer.hidden = true;
    state.restaurants = await loadRestaurants();
    render();
  });

  $detailContainer.addEventListener('touchstart', (e) => {
    // Don't track swipes starting in form inputs
    if (e.target.closest('textarea, input, .comment-form')) {
      $detailContainer._touchStartX = null;
      return;
    }
    const touch = e.touches[0];
    $detailContainer._touchStartX = touch.clientX;
    $detailContainer._touchStartY = touch.clientY;
  }, { passive: true });
  $detailContainer.addEventListener('touchend', (e) => {
    if ($detailContainer._touchStartX == null) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - $detailContainer._touchStartX;
    const dy = Math.abs(touch.clientY - ($detailContainer._touchStartY || 0));
    // Only close on deliberate horizontal swipe (>120px right, <50px vertical)
    if (dx > 120 && dy < 50) closeDetail();
  }, { passive: true });
}

// ── User name prompt ──

function promptUserName() {
  return new Promise((resolve) => {
    $modalContainer.innerHTML = `
    <div class="modal-overlay">
      <div class="modal" onclick="event.stopPropagation()">
        <div class="modal-header"><h3>Who are you?</h3></div>
        <form class="add-form" id="user-form">
          <label>Your name<input type="text" name="username" required autofocus placeholder="e.g. Niki, Carissa, Ashi"></label>
          <button type="submit" class="submit-btn">Continue</button>
        </form>
      </div>
    </div>`;
    $modalContainer.hidden = false;
    document.getElementById('user-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = e.target.username.value.trim();
      if (!name) return;
      db.setUser(name);
      $modalContainer.innerHTML = '';
      $modalContainer.hidden = true;
      resolve(name);
    });
  });
}

// ── Filter Modal ──

const $filterModal = document.getElementById('filter-modal');
const $filterBody = document.getElementById('filter-modal-body');

function showFilterModal() {
  const total = getAllRestaurants().length;
  const filtered = getFilteredListFromState('all').length;
  $filterBody.innerHTML = renderFilterPane(state.filters, total, filtered, !!state.mapFilter);
  $filterModal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeFilterModal() {
  $filterModal.hidden = true;
  $filterBody.innerHTML = '';
  document.body.style.overflow = '';
  render(); // re-render main list with updated filters
}

function updateFilterBadge() {
  const n = activeFilterCount(state.filters) + (state.mapFilter ? 1 : 0);
  const badge = document.getElementById('filter-badge');
  if (badge) {
    badge.textContent = n > 0 ? n : '';
    badge.hidden = n === 0;
  }
}

// Filter modal click delegation
$filterBody.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === 'filter-day') {
    const day = parseInt(btn.dataset.day);
    state.filters.day = state.filters.day === day ? null : day;
    if (state.filters.day !== null) state.filters.openNow = false; // day+time overrides open-now
  } else if (action === 'filter-open-now') {
    state.filters.openNow = !state.filters.openNow;
    if (state.filters.openNow) { state.filters.day = null; state.filters.time = ''; } // open-now overrides day+time
  } else if (action === 'filter-time-quick') {
    const t = btn.dataset.time;
    state.filters.time = state.filters.time === t ? '' : t;
    if (state.filters.time && state.filters.day === null) state.filters.day = new Date().getDay(); // auto-select today
    state.filters.openNow = false;
  } else if (action === 'filter-clear') {
    state.filters = { day: null, openNow: false, minRating: 0, time: '' };
  } else if (action === 'open-map') {
    closeFilterModal();
    setTimeout(() => openMapDrawer(true), 100);
    return;
  }

  updateFilterBadge();
  updateMapFilterBanner();
  showFilterModal();
});

// Rating slider + time input (use input events, not click)
$filterBody.addEventListener('input', (e) => {
  if (e.target.dataset.action === 'filter-rating-slider') {
    state.filters.minRating = parseFloat(e.target.value) || 0;
    const label = e.target.nextElementSibling;
    if (label) label.textContent = state.filters.minRating ? `${state.filters.minRating}+ ★` : 'Any';
    updateFilterBadge();
    updateMapFilterBanner();
    // Update count without full re-render (avoid losing slider focus)
    const count = getFilteredListFromState('all').length;
    const total = getAllRestaurants().length;
    const countEl = $filterBody.querySelector('.fp-count');
    if (countEl) countEl.textContent = `${count} of ${total} showing`;
  }
  if (e.target.dataset.action === 'filter-time-input') {
    state.filters.time = e.target.value;
    if (state.filters.time && state.filters.day === null) state.filters.day = new Date().getDay();
    state.filters.openNow = false;
    updateFilterBadge();
    updateMapFilterBanner();
    const count = getFilteredListFromState('all').length;
    const total = getAllRestaurants().length;
    const countEl = $filterBody.querySelector('.fp-count');
    if (countEl) countEl.textContent = `${count} of ${total} showing`;
  }
});

// Re-render pane on slider change end
$filterBody.addEventListener('change', (e) => {
  if (e.target.dataset.action === 'filter-rating-slider' || e.target.dataset.action === 'filter-time-input') {
    showFilterModal();
  }
});

// ── Init ──

async function init() {
  // Resolve group from ?g=... — the dispatcher in index.html only loads app.js
  // when a group id is present, so bail defensively if it isn't.
  const group = await groupCtx.resolveCurrentGroup();
  if (!group) {
    location.replace('/');
    return;
  }
  state.group = group;

  // Tell data.js how to label Yelp/Maps URLs for this city
  setCityContext({ name: group.city_name, country: group.country });

  // Dynamic title + header for this group
  document.title = `${group.city_name} Restaurants`;
  const headerTitle = document.getElementById('header-title');
  if (headerTitle) headerTitle.textContent = `${group.city_name} Restaurants`;

  // Reveal the app shell (hidden by the dispatcher until we know which view to show)
  document.getElementById('app-shell')?.removeAttribute('hidden');

  // Get or prompt for user name (scoped per-group)
  state.userName = db.getUser();
  if (!state.userName) {
    state.userName = await promptUserName();
  }
  // Remember this group in the device-local "my groups" list
  groupCtx.rememberGroup(group, state.userName);

  // Load data
  state.restaurants = await loadRestaurants();

  // Load state from Supabase or localStorage
  if (useDB) {
    state.allState = await db.loadAllState();
    state.allComments = await db.loadAllComments();
  } else {
    // Fallback: convert old localStorage format to new multi-user format
    const oldState = local.loadUserState();
    for (const [rid, us] of Object.entries(oldState)) {
      if (!state.allState[rid]) state.allState[rid] = {};
      state.allState[rid][state.userName] = {
        vote: us.vote || 0,
        status: us.status || 'default',
        shortlistPosition: 0,
      };
      if (us.comments?.length) {
        state.allComments[rid] = us.comments;
      }
    }
  }

  // Restore shared map filter from Supabase (or localStorage fallback)
  if (useDB) {
    try {
      const shared = await db.loadSharedState('map-filter');
      if (shared?.ids?.length) {
        state.mapFilter = new Set(shared.ids);
      }
    } catch {}
  } else {
    try {
      const saved = localStorage.getItem('sd-map-filter');
      if (saved) {
        const ids = JSON.parse(saved);
        if (Array.isArray(ids) && ids.length) state.mapFilter = new Set(ids);
      }
    } catch {}
  }

  setupEvents();
  updateMapFilterBanner();
  render();

  // Sources modal currently has SD-specific hardcoded content (components.js).
  // Phase 2 will data-drive it from groups.source_metadata; until then, only
  // show the link for the legacy SD group.
  const sourcesLink = document.getElementById('sources-link');
  if (sourcesLink) {
    if (group.city_slug === 'san-diego') {
      sourcesLink.textContent = `${TOTAL_SOURCE_COUNT} sources`;
    } else {
      sourcesLink.hidden = true;
    }
  }

  // Init map
  initMap(getAllRestaurants(), onMapFilterChange);

  // Map filter banner clear button
  document.getElementById('clear-map-filter').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearFilterExternal();
    state.mapFilter = null;
    state.filters = { day: null, openNow: false, minRating: 0, time: '' };
    if (useDB) db.deleteSharedState('map-filter');
    else localStorage.removeItem('sd-map-filter');
    updateMapFilterBanner();
    updateFilterBadge();
    render();
  });
}

function onMapFilterChange(ids) {
  state.mapFilter = ids ? new Set(ids) : null;
  // Persist to Supabase (shared) or localStorage (fallback)
  if (useDB) {
    if (ids) {
      db.saveSharedState('map-filter', { ids }, state.userName);
    } else {
      db.deleteSharedState('map-filter');
    }
  } else {
    if (ids) localStorage.setItem('sd-map-filter', JSON.stringify(ids));
    else localStorage.removeItem('sd-map-filter');
  }
  updateMapFilterBanner();
  render();
}

function updateMapFilterBanner() {
  const banner = document.getElementById('map-filter-banner');
  const tags = [];
  if (state.mapFilter) tags.push('Map area');
  if (state.filters.openNow) tags.push('Open now');
  if (state.filters.minRating) tags.push(`${state.filters.minRating}+★`);
  if (state.filters.day !== null && state.filters.day !== undefined) {
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    let dayTag = days[state.filters.day];
    if (state.filters.time) dayTag += ` ${state.filters.time}`;
    tags.push(dayTag);
  }

  const hasFilters = tags.length > 0;
  banner.hidden = !hasFilters;
  if (hasFilters) {
    const filtered = getFilteredListFromState('all').length;
    const total = getAllRestaurants().length;
    document.getElementById('map-filter-text').textContent =
      `${filtered}/${total} · ${tags.join(' · ')}`;
  }
}

init();
