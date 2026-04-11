// picker.js — Pre-screen: list my groups, join via link, create new.
import * as db from './supabase.js?v=1775460000';
import * as groupCtx from './group.js?v=1775460000';

const $root = document.getElementById('picker-root');
$root.hidden = false;

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
  const groups = groupCtx.getMyGroups();

  $root.innerHTML = `
    <div class="picker-page">
      <header class="picker-header">
        <h1>Your groups</h1>
      </header>
      <main class="picker-main">
        ${groups.length ? `
          <ul class="picker-list">
            ${groups.map(g => `
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
        ` : `
          <div class="picker-empty">
            <p>No groups yet.</p>
            <p class="picker-hint">Create a new one or paste a share link from someone.</p>
          </div>
        `}

        <div class="picker-actions">
          <button class="picker-btn picker-btn-primary" data-action="create">+ Create new group</button>
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

function showCreateModal() {
  const modal = document.createElement('div');
  modal.className = 'picker-modal-overlay';
  modal.innerHTML = `
    <div class="picker-modal">
      <h2>Create a new group</h2>
      <form class="picker-form" id="create-form">
        <label>
          <span>Group name</span>
          <input type="text" name="name" placeholder="e.g. SF 2026 Birthday Trip" required autofocus>
        </label>
        <label>
          <span>City</span>
          <input type="text" name="city" placeholder="e.g. San Francisco" required>
        </label>
        <label>
          <span>Country (optional)</span>
          <input type="text" name="country" placeholder="e.g. USA">
        </label>
        <label>
          <span>Your name</span>
          <input type="text" name="myName" placeholder="e.g. Naveen" required>
        </label>
        <label>
          <span>Criteria (optional, free text)</span>
          <textarea name="criteria" rows="3" placeholder="e.g. kid-friendly, outdoor seating, under $60pp"></textarea>
        </label>
        <div class="picker-modal-actions">
          <button type="button" class="picker-btn" data-action="close-modal">Cancel</button>
          <button type="submit" class="picker-btn picker-btn-primary">Create</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.dataset.action === 'close-modal') modal.remove();
  });
  modal.querySelector('#create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const submit = form.querySelector('button[type=submit]');
    submit.disabled = true;
    submit.textContent = 'Creating…';
    const name = form.name.value.trim();
    const cityName = form.city.value.trim();
    const country = form.country.value.trim() || null;
    const myName = form.myName.value.trim();
    const criteriaText = form.criteria.value.trim();
    const citySlug = cityName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const group = await db.createGroup({
      name, cityName, citySlug, country,
      criteria: criteriaText ? { freeText: criteriaText } : {},
      createdByName: myName,
    });
    if (!group) {
      submit.disabled = false;
      submit.textContent = 'Create';
      flash('Something went wrong');
      return;
    }
    groupCtx.rememberGroup(group, myName);
    // Scope user name to the new group's id before navigating so app.js finds it
    localStorage.setItem(`user-name:${group.id}`, myName);
    location.href = `/?g=${encodeURIComponent(group.id)}`;
  });
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
  if (action === 'share') { e.stopPropagation(); copyShareLink(id); return; }
  if (action === 'forget') {
    e.stopPropagation();
    groupCtx.forgetGroup(id);
    render();
    return;
  }
  if (action === 'create') { showCreateModal(); return; }
  if (action === 'join') { showJoinModal(); return; }
});

render();
