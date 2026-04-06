// map.js — Interactive map drawer with paint-to-filter
let map = null;
const markers = new Map();
let paintCanvas, paintCtx;
let isPaintMode = false;
let isPainting = false;
let lastPt = null;
const BRUSH_RADIUS = 30;
const LABEL_ZOOM = 14;
let _restaurants = [];
let _onFilterChange = null;
let _filterIds = null; // persisted filter even after canvas clears

const $drawer = () => document.getElementById('map-drawer');
const $container = () => document.getElementById('map-container');
const $canvas = () => document.getElementById('paint-canvas');
const $paintBtn = () => document.getElementById('map-paint-toggle');

export function initMap(restaurants, onFilterChange) {
  _restaurants = restaurants.filter(r => r.lat != null && r.lng != null);
  _onFilterChange = onFilterChange;

  // Drawer tab
  document.getElementById('map-drawer-tab').addEventListener('click', openDrawer);
  document.getElementById('map-close').addEventListener('click', closeDrawer);
  document.getElementById('map-paint-toggle').addEventListener('click', togglePaint);
  document.getElementById('map-reset').addEventListener('click', resetFilter);
}

export function openDrawer() {
  const drawer = $drawer();
  drawer.classList.add('open');

  if (!map) {
    createMap();
  } else {
    setTimeout(() => map.invalidateSize(), 350);
  }
}

export function closeDrawer() {
  $drawer().classList.remove('open');
  setPaintMode(false);
}

function createMap() {
  const container = $container();
  map = L.map(container, {
    center: [32.78, -117.15],
    zoom: 11,
    zoomControl: false,
  });

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19,
  }).addTo(map);

  // Add markers
  const bounds = [];
  for (const r of _restaurants) {
    const latlng = [r.lat, r.lng];
    bounds.push(latlng);

    const marker = L.circleMarker(latlng, {
      radius: 7,
      fillColor: '#0071e3',
      fillOpacity: 0.9,
      color: '#fff',
      weight: 2,
    }).addTo(map);

    marker.bindTooltip(r.name, {
      permanent: false,
      direction: 'top',
      offset: [0, -10],
      className: 'restaurant-label',
    });

    marker._restaurantId = r.id;
    markers.set(r.id, marker);
  }

  if (bounds.length) {
    map.fitBounds(bounds, { padding: [30, 30] });
  }

  // Zoom-dependent labels
  map.on('zoomend', updateLabels);
  updateLabels();

  // Clear canvas on map move (paint becomes stale)
  map.on('movestart', () => {
    if (paintCanvas) clearCanvas();
  });

  // Setup paint canvas
  setupCanvas();

  // Invalidate after transition
  setTimeout(() => map.invalidateSize(), 400);
}

function updateLabels() {
  const zoom = map.getZoom();
  for (const [, marker] of markers) {
    if (zoom >= LABEL_ZOOM) {
      marker.openTooltip();
    } else {
      marker.closeTooltip();
    }
  }
}

// ── Paint Canvas ──

function setupCanvas() {
  paintCanvas = $canvas();
  paintCtx = paintCanvas.getContext('2d');
  resizeCanvas();

  const ro = new ResizeObserver(() => resizeCanvas());
  ro.observe($container());

  // Pointer events for painting
  paintCanvas.addEventListener('pointerdown', onPaintStart);
  paintCanvas.addEventListener('pointermove', onPaintMove);
  paintCanvas.addEventListener('pointerup', onPaintEnd);
  paintCanvas.addEventListener('pointercancel', onPaintEnd);
}

function resizeCanvas() {
  const container = $container();
  const dpr = window.devicePixelRatio || 1;
  paintCanvas.width = container.offsetWidth * dpr;
  paintCanvas.height = container.offsetHeight * dpr;
  paintCanvas.style.width = container.offsetWidth + 'px';
  paintCanvas.style.height = container.offsetHeight + 'px';
  paintCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function clearCanvas() {
  if (!paintCtx) return;
  const dpr = window.devicePixelRatio || 1;
  paintCtx.clearRect(0, 0, paintCanvas.width / dpr, paintCanvas.height / dpr);
}

function drawBrush(x, y) {
  paintCtx.globalCompositeOperation = 'source-over';
  paintCtx.fillStyle = 'rgba(76, 175, 80, 0.3)';
  paintCtx.beginPath();
  paintCtx.arc(x, y, BRUSH_RADIUS, 0, Math.PI * 2);
  paintCtx.fill();
}

function interpolate(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const step = BRUSH_RADIUS / 3;
  const steps = Math.ceil(dist / step);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    drawBrush(from.x + dx * t, from.y + dy * t);
  }
}

function onPaintStart(e) {
  if (!isPaintMode) return;
  isPainting = true;
  const rect = paintCanvas.getBoundingClientRect();
  const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  drawBrush(pt.x, pt.y);
  lastPt = pt;
  e.preventDefault();
}

function onPaintMove(e) {
  if (!isPainting) return;
  const rect = paintCanvas.getBoundingClientRect();
  const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  interpolate(lastPt, pt);
  lastPt = pt;
  e.preventDefault();
}

function onPaintEnd(e) {
  if (!isPainting) return;
  isPainting = false;
  lastPt = null;
  computeFilter();
}

// ── Filter Computation ──

function computeFilter() {
  if (!map || !paintCtx) return;
  const dpr = window.devicePixelRatio || 1;
  const ids = [];

  for (const r of _restaurants) {
    const pt = map.latLngToContainerPoint([r.lat, r.lng]);
    const px = Math.round(pt.x * dpr);
    const py = Math.round(pt.y * dpr);

    if (px < 0 || py < 0 || px >= paintCanvas.width || py >= paintCanvas.height) continue;

    const pixel = paintCtx.getImageData(px, py, 1, 1).data;
    if (pixel[3] > 0) {
      ids.push(r.id);
    }
  }

  if (ids.length > 0) {
    _filterIds = ids;
    _onFilterChange(ids);
  }
}

// ── Paint Mode Toggle ──

function setPaintMode(on) {
  isPaintMode = on;
  const btn = $paintBtn();
  const drawer = $drawer();
  if (on) {
    btn.classList.add('active');
    drawer.classList.add('paint-active');
    map.dragging.disable();
    map.touchZoom.disable();
    map.doubleClickZoom.disable();
  } else {
    btn.classList.remove('active');
    drawer.classList.remove('paint-active');
    if (map) {
      map.dragging.enable();
      map.touchZoom.enable();
      map.doubleClickZoom.enable();
    }
    isPainting = false;
  }
}

function togglePaint() {
  setPaintMode(!isPaintMode);
}

function resetFilter() {
  clearCanvas();
  _filterIds = null;
  setPaintMode(false);
  _onFilterChange(null);
}
