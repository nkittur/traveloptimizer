// map.js — Interactive map drawer with paint-to-filter
let map = null;
const markers = new Map();
let paintCanvas, paintCtx;
let isPaintMode = false;
let isPainting = false;
let lastPt = null;
let paintPoints = []; // screen coords [{x, y}] during active stroke
let geoPoints = [];   // geographic coords [{lat, lng, zoom}] persisted across pan/zoom
const BRUSH_RADIUS = 30;
let paintZoom = null; // zoom level when painting started
const LABEL_ZOOM = 12;
let _restaurants = [];
let _onFilterChange = null;

const $drawer = () => document.getElementById('map-drawer');
const $container = () => document.getElementById('map-container');
const $canvas = () => document.getElementById('paint-canvas');
const $paintBtn = () => document.getElementById('map-paint-toggle');

export function initMap(restaurants, onFilterChange) {
  _restaurants = restaurants.filter(r => r.lat != null && r.lng != null);
  _onFilterChange = onFilterChange;

  document.getElementById('map-drawer-tab').addEventListener('click', openDrawer);
  document.getElementById('map-close').addEventListener('click', closeDrawer);
  document.getElementById('map-paint-toggle').addEventListener('click', togglePaint);
  document.getElementById('map-reset').addEventListener('click', resetFilter);
}

export function clearFilterExternal() {
  paintPoints = [];
  geoPoints = [];
  clearCanvas();
  setPaintMode(false);
}

export function openDrawer() {
  const drawer = $drawer();
  drawer.classList.add('open');
  if (!map) {
    createMap();
    setTimeout(() => setPaintMode(true), 450);
  } else {
    setTimeout(() => { map.invalidateSize(); setPaintMode(true); }, 350);
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

  map.on('zoomend', updateLabels);
  updateLabels();

  // Redraw paint as map moves/zooms so it stays aligned with markers
  map.on('move', () => {
    if (geoPoints.length) redrawPaint();
  });
  map.on('zoom', () => {
    if (geoPoints.length) redrawPaint();
  });

  setupCanvas();
  setTimeout(() => map.invalidateSize(), 400);
}

function updateLabels() {
  const zoom = map.getZoom();
  for (const [, marker] of markers) {
    if (zoom >= LABEL_ZOOM) marker.openTooltip();
    else marker.closeTooltip();
  }
}

// ── Paint Canvas ──

function setupCanvas() {
  paintCanvas = $canvas();
  paintCtx = paintCanvas.getContext('2d');
  resizeCanvas();

  const ro = new ResizeObserver(() => resizeCanvas());
  ro.observe($container());

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

// Redraw ALL paint from geo coords, reprojected to current screen position
function redrawPaint() {
  clearCanvas();
  if (!geoPoints.length && !paintPoints.length) return;

  const currentZoom = map.getZoom();

  paintCtx.globalCompositeOperation = 'source-over';
  paintCtx.fillStyle = 'rgba(76, 175, 80, 0.25)';
  paintCtx.beginPath();

  // Draw persisted geo points with zoom-scaled radius
  for (const gp of geoPoints) {
    const sp = map.latLngToContainerPoint([gp.lat, gp.lng]);
    // Scale radius: each zoom level doubles the size
    const scale = Math.pow(2, currentZoom - gp.zoom);
    const r = BRUSH_RADIUS * scale;
    paintCtx.moveTo(sp.x + r, sp.y);
    paintCtx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
  }

  // Draw active stroke points at current brush size
  for (const pt of paintPoints) {
    paintCtx.moveTo(pt.x + BRUSH_RADIUS, pt.y);
    paintCtx.arc(pt.x, pt.y, BRUSH_RADIUS, 0, Math.PI * 2);
  }

  paintCtx.fill();
}

function addBrushPoints(from, to) {
  if (!from) {
    paintPoints.push({ x: to.x, y: to.y });
    return;
  }
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const step = BRUSH_RADIUS / 3;
  const steps = Math.max(1, Math.ceil(dist / step));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    paintPoints.push({ x: from.x + dx * t, y: from.y + dy * t });
  }
}

function onPaintStart(e) {
  if (!isPaintMode) return;
  isPainting = true;
  const rect = paintCanvas.getBoundingClientRect();
  const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  addBrushPoints(null, pt);
  redrawPaint();
  lastPt = pt;
  e.preventDefault();
}

function onPaintMove(e) {
  if (!isPainting) return;
  const rect = paintCanvas.getBoundingClientRect();
  const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  addBrushPoints(lastPt, pt);
  redrawPaint();
  lastPt = pt;
  updatePaintCount();
  e.preventDefault();
}

function onPaintEnd() {
  if (!isPainting) return;
  isPainting = false;
  lastPt = null;
  // Convert screen paintPoints to geo coords for persistence across pan/zoom
  const z = map.getZoom();
  for (const pt of paintPoints) {
    const latlng = map.containerPointToLatLng([pt.x, pt.y]);
    geoPoints.push({ lat: latlng.lat, lng: latlng.lng, zoom: z });
  }
  paintPoints = [];
  computeFilter();
}

// ── Filter Computation ──

function countSelected() {
  if (!map || !paintCtx || (!geoPoints.length && !paintPoints.length)) return 0;
  const dpr = window.devicePixelRatio || 1;
  let count = 0;
  for (const r of _restaurants) {
    const pt = map.latLngToContainerPoint([r.lat, r.lng]);
    const px = Math.round(pt.x * dpr);
    const py = Math.round(pt.y * dpr);
    if (px < 0 || py < 0 || px >= paintCanvas.width || py >= paintCanvas.height) continue;
    const pixel = paintCtx.getImageData(px, py, 1, 1).data;
    if (pixel[3] > 0) count++;
  }
  return count;
}

function updatePaintCount() {
  const el = document.getElementById('map-paint-count');
  if (!el) return;
  const count = countSelected();
  if (count > 0) {
    el.textContent = `${count} of ${_restaurants.length} selected`;
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

function computeFilter() {
  if (!map || !paintCtx || (!geoPoints.length && !paintPoints.length)) return;
  redrawPaint(); // ensure canvas matches current projection before sampling
  const dpr = window.devicePixelRatio || 1;
  const ids = [];

  for (const r of _restaurants) {
    const pt = map.latLngToContainerPoint([r.lat, r.lng]);
    const px = Math.round(pt.x * dpr);
    const py = Math.round(pt.y * dpr);
    if (px < 0 || py < 0 || px >= paintCanvas.width || py >= paintCanvas.height) continue;
    const pixel = paintCtx.getImageData(px, py, 1, 1).data;
    if (pixel[3] > 0) ids.push(r.id);
  }

  updatePaintCount();
  if (ids.length > 0) {
    _onFilterChange(ids);
  }
}

// ── Paint Mode Toggle ──

function setPaintMode(on) {
  isPaintMode = on;
  const btn = $paintBtn();
  const drawer = $drawer();
  if (!btn || !drawer) return;
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
  paintPoints = [];
  geoPoints = [];
  clearCanvas();
  setPaintMode(false);
  const el = document.getElementById('map-paint-count');
  if (el) el.hidden = true;
  if (_onFilterChange) _onFilterChange(null);
}
