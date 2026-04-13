(function () {
'use strict';

/* ──────────────────────────────────────────────────────────────
   Constants & theme palette
────────────────────────────────────────────────────────────── */
const FULL_POOL_MASL = 342.48;
const LEVEL_OFFSET   = 340.236;
const FLOOD_CONSTRUCTION_LEVEL  = 343.66;
const IMPACTS_MAIN_FLOOR        = FLOOD_CONSTRUCTION_LEVEL;
const IMPACTS_CRAWLSPACE_FLOOR  = FLOOD_CONSTRUCTION_LEVEL - 0.80;
const IMPACTS_FINISHED_FLOOR    = 343.94;
const IMPACTS_GRADE_AT_HOUSE    = 343.05;
const IMPACTS_NATURAL_BOUNDARY  = 342.50;
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const OVERVIEW_MAP_BOUNDS = [
  [49.40, -120.05],
  [50.33, -119.15]
];

// Station colours — visible on CartoDB Positron light basemap
const STATION_COLORS = {
  kelowna:            '#1562a4',
  penticton_outflow:  '#2f8f46',
  brenda_mine:        '#8c6810',
  penticton_weather:  '#7040a8'
};

// Centralised colour palette for all D3-drawn elements
const T = {
  // ── time-series / levels ──
  bandFill:        'rgba(21,98,164,0.09)',
  meanLine:        'rgba(21,98,164,0.40)',
  fullPoolFill:    'rgba(200,78,20,0.05)',
  fullPoolLine:    'rgba(200,78,20,0.62)',
  fullPoolLabel:   'rgba(200,78,20,0.88)',
  monthSep:        'rgba(22,46,74,0.055)',
  hoverLine:       'rgba(22,46,74,0.20)',
  levelSelected:   '#1562a4',
  level2017:       '#c84e14',
  // ── heatmap ──
  heatLow:         '#d4eaf7',
  heatHigh:        '#09355e',
  cellStroke:      'rgba(22,46,74,0.09)',
  cellStrokeHov:   'rgba(22,46,74,0.55)',
  cellStrokeSel:   'rgba(21,98,164,0.72)',
  // ── drivers — SWE ──
  sweArea:         'rgba(140,104,16,0.22)',
  sweLine:         '#8c6810',
  sweMeanFill:     'rgba(186, 158, 94, 0.18)',
  sweMeanStroke:   'rgba(166,128,34,0.34)',
  snowmeltLine:    'rgba(140,104,16,0.38)',
  // ── drivers — temperature ──
  tempLine:        '#b0281e',
  tempHotFill:     'rgba(176,40,30,0.20)',
  tempColdFill:    'rgba(176,40,30,0.14)',
  tempZero:        'rgba(22,46,74,0.18)',
  // ── drivers — outflow ──
  outflowBand:     'rgba(47,143,70,0.10)',
  outflowMean:     'rgba(47,143,70,0.42)',
  outflow2017:     'rgba(200,78,20,0.34)',
  outflowCapacity: 'rgba(22,46,74,0.42)',
  outflowSel:      '#2f8f46',
  outflowSelOther: '#63ad76',
  // ── drivers — lake level ──
  levelBand:       'rgba(21,98,164,0.08)',
  level2017Ref:    'rgba(200,78,20,0.46)',
  fullPoolDrivers: 'rgba(200,78,20,0.46)',
  // ── tooltip ──
  tipMuted:        '#5c7285',
};

/* ──────────────────────────────────────────────────────────────
   Shared state
────────────────────────────────────────────────────────────── */
const state = {
  selectedYear:   2017,
  currentSection: 0,
  chartsInit: { 1: false, 2: false, 3: false, 4: false },
  activeStationKey: 'all',
  activePhotoId: 'all',
  impactsDayIndex: 0,
  impactsPlaying: false
};

let rawDaily      = [];
let chartRows     = [];
let stations      = [];
let YEARS         = [];
let byYear        = {};
let sweDoyStats   = {};
let tempDoyStats  = {};
let levelDoyStats = {};
let outflowDoyStats = {};
let heatmap       = {};
let yearPeak      = {};
let imagePoints   = [];
let mapInstance   = null;
let markersByKey  = {};
let photoMarkersById = {};
let mapBounds     = null;
let photoBounds   = null;
let suppressPopupReset = false;
let photoLightbox = null;
let zoomSliderInput = null;
let impactsTimer = null;
let impactsSpeedMs = 120;

/* ──────────────────────────────────────────────────────────────
   Tooltip
────────────────────────────────────────────────────────────── */
const tooltip = document.createElement('div');
tooltip.className = 'd3-tooltip';
tooltip.style.opacity = '0';
document.body.appendChild(tooltip);

function showTip(html, event) {
  tooltip.innerHTML = html;
  tooltip.style.opacity = '1';
  moveTip(event);
}
function moveTip(event) {
  const x = event.clientX + 16;
  const y = event.clientY - 10;
  const tipWidth = tooltip.offsetWidth || 320;
  tooltip.style.left = Math.min(x, window.innerWidth - tipWidth - 16) + 'px';
  tooltip.style.top  = y + 'px';
}
function hideTip() { tooltip.style.opacity = '0'; }

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ──────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────── */
function isLeapDay(dateStr) { return dateStr.slice(5) === '02-29'; }

function smooth(data, key, windowSize = 7) {
  const vals = data.map(d => d[key]);
  return data.map((d, i) => {
    const slice = vals
      .slice(Math.max(0, i - windowSize), i + windowSize + 1)
      .filter(v => v != null && !Number.isNaN(v));
    return slice.length ? d3.mean(slice) : null;
  });
}

function smoothStatsSeries(stats, windowSize = 7) {
  const series = d3.range(365)
    .map(doy => stats[doy] ? { doy, ...stats[doy] } : null)
    .filter(Boolean);
  const mean = smooth(series, 'mean', windowSize);
  const lo = smooth(series, 'lo', windowSize);
  const hi = smooth(series, 'hi', windowSize);
  return series.map((d, i) => ({
    ...d,
    mean: mean[i] ?? d.mean,
    lo: lo[i] ?? d.lo,
    hi: hi[i] ?? d.hi
  }));
}

function extentPad(values, padLow, padHigh) {
  const vals = values.filter(v => v != null && !Number.isNaN(v));
  return [d3.min(vals) - padLow, d3.max(vals) + padHigh];
}

function valueOrNull(v) {
  return (v == null || v === '' || Number.isNaN(+v)) ? null : +v;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function fmt(v, digits, suffix) {
  return v == null ? '—' : (+v).toFixed(digits) + suffix;
}

function relativeToFullPool(v) {
  return v == null ? null : v - FULL_POOL_MASL;
}

function fmtSignedMeters(v, digits = 2) {
  if (v == null || Number.isNaN(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(digits)} m`;
}

function describeFullPoolOffset(v, digits = 3) {
  if (v == null || Number.isNaN(v)) return '—';
  if (Math.abs(v) < 10 ** (-digits) / 2) return `0.${'0'.repeat(digits)} m at full pool`;
  const amount = Math.abs(v).toFixed(digits);
  return v > 0
    ? `+${amount} m above full pool`
    : `-${amount} m below full pool`;
}

function approxMonthDay(year, doy) {
  const dt = new Date(year, 0, 1);
  dt.setDate(dt.getDate() + doy);
  return dt.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}

function makeLine(x, y, yMin, yMax, key) {
  return d3.line()
    .x(d => x(d.doy))
    .y(d => y(clamp(d[key], yMin, yMax)))
    .defined(d => d[key] != null)
    .curve(d3.curveBasis);
}

function pickTextColor(fill) {
  const c = d3.color(fill);
  if (!c) return '#162235';
  const yiq = (c.r * 299 + c.g * 587 + c.b * 114) / 1000;
  return yiq < 145 ? '#ffffff' : '#162235';
}

function buildPhotoCardHtml(photo, compact = false) {
  const title = photo.title || photo.marker_label || 'Map photo';
  const caption = photo.caption || '';
  const cardWidth = compact ? '220px' : '260px';
  const imgStyle = compact
    ? 'display:block;width:100%;max-width:220px;height:auto;border-radius:8px;margin:6px 0 6px;'
    : 'display:block;width:100%;max-width:260px;height:auto;border-radius:10px;margin:8px 0 8px;';
  const titleStyle = compact
    ? 'font:600 12px/1.35 DM Sans,sans-serif;color:#162235;margin-bottom:2px;white-space:normal;overflow-wrap:anywhere;'
    : 'font:600 13px/1.4 DM Sans,sans-serif;color:#162235;margin-bottom:2px;white-space:normal;overflow-wrap:anywhere;';
  const capStyle = compact
    ? 'font:400 11px/1.45 DM Sans,sans-serif;color:#5c7285;white-space:normal;overflow-wrap:anywhere;'
    : 'font:400 12px/1.5 DM Sans,sans-serif;color:#5c7285;white-space:normal;overflow-wrap:anywhere;';
  const triggerAttrs = [
    'type="button"',
    'class="photo-enlarge-trigger"',
    `data-photo-src="${escapeHtml(photo.image_path)}"`,
    `data-photo-title="${escapeHtml(title)}"`,
    `data-photo-caption="${escapeHtml(caption)}"`,
    `aria-label="Open larger version of ${escapeHtml(title)}"`
  ].join(' ');
  return `
    <div style="width:${cardWidth};max-width:${cardWidth};white-space:normal;overflow-wrap:anywhere;word-break:break-word;">
      ${title ? `<div style="${titleStyle}">${title}</div>` : ''}
      <button ${triggerAttrs}>
        <img src="${photo.image_path}" alt="${title}" style="${imgStyle}">
        <span class="photo-enlarge-label">View larger</span>
      </button>
      ${caption ? `<div style="${capStyle}">${caption}</div>` : ''}
    </div>
  `;
}

function closePhotoLightbox() {
  if (!photoLightbox) return;
  photoLightbox.classList.remove('is-open');
  photoLightbox.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('lightbox-open');
}

function openPhotoLightbox({ src, title, caption }) {
  if (!photoLightbox || !src) return;

  const img = photoLightbox.querySelector('.photo-lightbox-image');
  const titleEl = photoLightbox.querySelector('.photo-lightbox-title');
  const captionEl = photoLightbox.querySelector('.photo-lightbox-caption');

  img.src = src;
  img.alt = title || 'Expanded map photo';
  titleEl.textContent = title || 'Map photo';
  captionEl.textContent = caption || '';
  captionEl.hidden = !caption;

  photoLightbox.classList.add('is-open');
  photoLightbox.setAttribute('aria-hidden', 'false');
  document.body.classList.add('lightbox-open');
}

function syncZoomSlider() {
  if (!mapInstance || !zoomSliderInput) return;
  zoomSliderInput.value = mapInstance.getZoom().toFixed(1);
}

function addZoomSliderControl() {
  if (!mapInstance) return;

  const ZoomSliderControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-zoomslider');
      container.innerHTML = `
        <div class="zoomslider-shell">
          <input class="zoomslider-input" type="range" aria-label="Map zoom level">
        </div>
      `;

      zoomSliderInput = container.querySelector('.zoomslider-input');
      zoomSliderInput.min = mapInstance.getMinZoom().toFixed(1);
      zoomSliderInput.max = mapInstance.getMaxZoom().toFixed(1);
      zoomSliderInput.step = '0.1';
      syncZoomSlider();

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      zoomSliderInput.addEventListener('input', event => {
        mapInstance.setZoom(+event.target.value);
      });

      return container;
    }
  });

  mapInstance.addControl(new ZoomSliderControl());
  mapInstance.on('zoomend', syncZoomSlider);
}

function initPhotoLightbox() {
  photoLightbox = document.createElement('div');
  photoLightbox.className = 'photo-lightbox';
  photoLightbox.setAttribute('aria-hidden', 'true');
  photoLightbox.innerHTML = `
    <div class="photo-lightbox-backdrop" data-lightbox-close="true"></div>
    <div class="photo-lightbox-dialog" role="dialog" aria-modal="true" aria-label="Expanded photo view">
      <button type="button" class="photo-lightbox-close" aria-label="Close photo view">&times;</button>
      <img class="photo-lightbox-image" src="" alt="">
      <div class="photo-lightbox-meta">
        <div class="photo-lightbox-title"></div>
        <div class="photo-lightbox-caption"></div>
      </div>
    </div>
  `;
  document.body.appendChild(photoLightbox);

  document.addEventListener('click', event => {
    const trigger = event.target.closest('.photo-enlarge-trigger');
    if (trigger) {
      event.preventDefault();
      event.stopPropagation();
      openPhotoLightbox({
        src: trigger.dataset.photoSrc,
        title: trigger.dataset.photoTitle,
        caption: trigger.dataset.photoCaption
      });
      return;
    }

    if (event.target.closest('[data-lightbox-close="true"]') || event.target.closest('.photo-lightbox-close')) {
      closePhotoLightbox();
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && photoLightbox?.classList.contains('is-open')) {
      closePhotoLightbox();
    }
  });
}

function initSourceDetails() {
  document.addEventListener('click', event => {
    const closeBtn = event.target.closest('.source-details-close');
    if (!closeBtn) return;

    const details = closeBtn.closest('.source-details');
    if (details) details.open = false;
  });
}

function buildStationMetaHtml(station, compact = false) {
  const titleStyle = compact
    ? 'font:600 12px/1.35 DM Sans,sans-serif;color:#162235;white-space:normal;overflow-wrap:anywhere;'
    : 'font:600 13px/1.35 DM Sans,sans-serif;color:#162235;white-space:normal;overflow-wrap:anywhere;';
  const subtitleStyle = compact
    ? 'font:400 11px/1.45 DM Sans,sans-serif;color:#5c7285;margin-top:2px;white-space:normal;overflow-wrap:anywhere;'
    : 'font:400 12px/1.45 DM Sans,sans-serif;color:#5c7285;margin-top:4px;white-space:normal;overflow-wrap:anywhere;';
  return `
    <div style="white-space:normal;overflow-wrap:anywhere;word-break:break-word;">
      <div style="${titleStyle}">${station.station_name}</div>
      <div style="${subtitleStyle}">
        ${station.station_type} · ${station.station_id}
        ${station.elevation_m ? `<br>Elevation: ${(+station.elevation_m).toFixed(1)} m` : ''}
      </div>
    </div>
  `;
}

function buildStationPopupHtml(station, photos = []) {
  const meta = `
    ${buildStationMetaHtml(station, false)}
    <div style="font:400 12px/1.45 DM Sans,sans-serif;color:#5c7285;margin-top:6px;margin-bottom:${photos.length ? '10px' : '0'};white-space:normal;overflow-wrap:anywhere;">
      ${(+station.latitude).toFixed(5)}°N, ${Math.abs(+station.longitude).toFixed(5)}°W
    </div>
  `;
  if (!photos.length) return meta;
  return meta + photos.map(photo => buildPhotoCardHtml(photo, false)).join('');
}

function buildStationTooltipHtml(station, photos = []) {
  const header = buildStationMetaHtml(station, true);
  if (!photos.length) return header;
  return `${header}<div style="margin-top:8px;">${buildPhotoCardHtml(photos[0], true)}</div>`;
}

function buildStandalonePhotoPopupHtml(photo) {
  const place = photo.marker_label ? `<div style="font:500 11px/1.35 DM Sans,sans-serif;color:#0e7475;margin-bottom:6px;letter-spacing:0.03em;text-transform:uppercase;">${photo.marker_label}</div>` : '';
  return place + buildPhotoCardHtml(photo, false);
}

function isStandaloneFloodPhoto(photo) {
  const text = `${photo.title || ''} ${photo.marker_label || ''} ${photo.caption || ''}`.toLowerCase();
  return !photo.station_key &&
    photo.latitude != null &&
    photo.longitude != null &&
    (text.includes('2017') || text.includes('flood') || text.includes('high water'));
}

function photoButtonLabel(photo) {
  return (photo.marker_label || photo.title || 'Photo')
    .replace(/\s*\(2017\)\s*/i, '')
    .trim();
}

function stopImpactsAnimation() {
  if (impactsTimer) {
    window.clearInterval(impactsTimer);
    impactsTimer = null;
  }
  state.impactsPlaying = false;
  const btn = document.getElementById('impact-play-btn');
  if (btn) { btn.textContent = 'Play season'; btn.classList.remove('is-playing'); }
}

function updateImpactsControls(yearData) {
  const slider = document.getElementById('impact-day-slider');
  if (!slider || !yearData?.length) return;

  slider.max = String(yearData.length - 1);
  slider.value = String(state.impactsDayIndex);
}

function startImpactsAnimation() {
  const yearData = (byYear[state.selectedYear] || []).filter(d => d.level != null);
  if (!yearData.length) return;

  stopImpactsAnimation();
  state.impactsPlaying = true;

  const playBtn = document.getElementById('impact-play-btn');
  if (playBtn) { playBtn.textContent = 'Pause'; playBtn.classList.add('is-playing'); }

  impactsTimer = window.setInterval(() => {
    state.impactsDayIndex += 1;
    if (state.impactsDayIndex >= yearData.length) state.impactsDayIndex = 0;
    renderImpacts();
  }, impactsSpeedMs);
}

function impactStageLabel(level) {
  if (level >= IMPACTS_MAIN_FLOOR)       return 'Water at habitable floor';
  if (level >= IMPACTS_GRADE_AT_HOUSE)   return 'Water above lot grade';
  if (level >= IMPACTS_CRAWLSPACE_FLOOR) return 'Crawlspace flooding risk';
  if (level >= FULL_POOL_MASL)           return 'Lake above full pool';
  return 'Below full pool';
}

/* ──────────────────────────────────────────────────────────────
   Data loading
────────────────────────────────────────────────────────────── */
async function loadData() {
  if (window.EMBEDDED_DAILY_DATA && window.EMBEDDED_STATIONS_DATA) {
    rawDaily  = window.EMBEDDED_DAILY_DATA;
    stations  = window.EMBEDDED_STATIONS_DATA;
    imagePoints = window.EMBEDDED_IMAGE_POINTS || [];
    return;
  }

  const dailyCandidates = [
    'processed_okanagan_daily_2014_2024.csv',
    './processed_okanagan_daily_2014_2024.csv',
    'data/processed_okanagan_daily_2014_2024.csv',
    './data/processed_okanagan_daily_2014_2024.csv'
  ];

  const stationCandidates = [
    'okanagan_station_locations.csv',
    './okanagan_station_locations.csv',
    'data/okanagan_station_locations.csv',
    './data/okanagan_station_locations.csv'
  ];

  const imageCandidates = [
    'map_images.csv',
    './map_images.csv',
    'data/map_images.csv',
    './data/map_images.csv'
  ];

  async function loadCsvWithFallback(paths, rowParser, label) {
    let lastError = null;

    for (const path of paths) {
      try {
        const rows = await d3.csv(path, rowParser);
        if (rows && rows.length) return rows;
      } catch (err) {
        lastError = err;
      }
    }

    const pathList = paths.join(', ');
    throw new Error(
      `Could not load ${label}. Tried: ${pathList}. ` +
      `If you opened index.html directly as a file:// page, the browser may be blocking CSV fetches. ` +
      `Run the project from a local server instead. ` +
      (lastError ? `Last error: ${lastError.message}` : '')
    );
  }

  async function loadCsvOptional(paths, rowParser) {
    for (const path of paths) {
      try {
        const rows = await d3.csv(path, rowParser);
        if (rows) return rows;
      } catch (err) {
        // ignore optional file load errors
      }
    }
    return [];
  }

  rawDaily = await loadCsvWithFallback(dailyCandidates, d => ({
    ...d,
    year: +d.year,
    month: +d.month,
    day: +d.day,
    season_day: +d.season_day,
    kelowna_level_gauge_m: valueOrNull(d.kelowna_level_gauge_m),
    kelowna_level_masl: valueOrNull(d.kelowna_level_masl),
    penticton_outflow_m3s: valueOrNull(d.penticton_outflow_m3s),
    temp_mean_c: valueOrNull(d.temp_mean_c),
    precip_total_mm: valueOrNull(d.precip_total_mm),
    swe_mm: valueOrNull(d.swe_mm)
  }), 'processed daily data');

  stations = await loadCsvWithFallback(stationCandidates, d => ({
    ...d,
    latitude: valueOrNull(d.latitude),
    longitude: valueOrNull(d.longitude),
    elevation_m: valueOrNull(d.elevation_m)
  }), 'station locations');

  imagePoints = await loadCsvOptional(imageCandidates, d => ({
    ...d,
    latitude: valueOrNull(d.latitude),
    longitude: valueOrNull(d.longitude)
  }));
}

/* ──────────────────────────────────────────────────────────────
   Data processing
────────────────────────────────────────────────────────────── */
function processData() {
  chartRows = rawDaily
    .filter(d => !isLeapDay(d.date))
    .map(d => ({
      date:      d.date,
      year:      +d.year,
      month:     +d.month - 1,
      day:       +d.day,
      month_name: d.month_name,
      doy:       +d.season_day,
      level_gauge: valueOrNull(d.kelowna_level_gauge_m),
      level:       valueOrNull(d.kelowna_level_masl),
      outflow:     valueOrNull(d.penticton_outflow_m3s),
      temp:        valueOrNull(d.temp_mean_c),
      precip:      valueOrNull(d.precip_total_mm),
      swe:         valueOrNull(d.swe_mm)
    }));

  YEARS  = Array.from(new Set(chartRows.map(d => d.year))).sort((a, b) => a - b);
  byYear = Object.fromEntries(
    YEARS.map(y => [y, chartRows.filter(d => d.year === y).sort((a, b) => a.doy - b.doy)])
  );

  sweDoyStats     = computeStatsByDoy(chartRows, 'swe');
  tempDoyStats    = computeStatsByDoy(chartRows, 'temp');
  levelDoyStats   = computeStatsByDoy(chartRows, 'level');
  outflowDoyStats = computeStatsByDoy(chartRows, 'outflow');

  heatmap  = {};
  yearPeak = {};
  YEARS.forEach(y => {
    heatmap[y]  = {};
    yearPeak[y] = relativeToFullPool(
      d3.max(byYear[y].map(d => d.level).filter(v => v != null))
    );
    for (let m = 0; m < 12; m++) {
      const vals = byYear[y].filter(d => d.month === m).map(d => d.level).filter(v => v != null);
      heatmap[y][m] = vals.length ? relativeToFullPool(d3.mean(vals)) : null;
    }
  });
}

function computeStatsByDoy(rows, key) {
  const stats = {};
  for (let doy = 0; doy <= 364; doy++) {
    const vals = rows.filter(d => d.doy === doy).map(d => d[key]).filter(v => v != null);
    if (!vals.length) continue;
    const mean = d3.mean(vals);
    const std  = Math.sqrt(d3.mean(vals.map(v => (v - mean) ** 2)));
    stats[doy] = { mean, std, lo: mean - std, hi: mean + std };
  }
  return stats;
}

/* ──────────────────────────────────────────────────────────────
   Year selector
────────────────────────────────────────────────────────────── */
function buildYearSelector(containerId, onChange) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  YEARS.forEach(year => {
    const btn = document.createElement('button');
    btn.className =
      'year-btn' +
      (year === 2017           ? ' highlight-2017' : '') +
      (year === state.selectedYear ? ' active'         : '');
    btn.dataset.year = year;
    btn.textContent  = year;
    btn.addEventListener('click', () => {
      state.selectedYear = year;
      document.querySelectorAll('.year-btn').forEach(b => {
        b.classList.toggle('active', parseInt(b.dataset.year, 10) === year);
      });
      onChange(year);
    });
    container.appendChild(btn);
  });
}

/* ──────────────────────────────────────────────────────────────
   Map — CartoDB Positron light basemap
────────────────────────────────────────────────────────────── */
function updateMapButtonStates() {
  const homeView = state.activeStationKey === 'all' && state.activePhotoId === 'all';

  document.querySelectorAll('#scenario-row .scen-btn').forEach(btn => {
    const key = btn.dataset.station;
    const isActive = key === 'all' ? homeView : state.activeStationKey === key;
    btn.classList.toggle('active', isActive);
  });

  document.querySelectorAll('#scenario-row2 .scen-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.photo === state.activePhotoId);
  });
}

function returnToAllStations() {
  suppressPopupReset = true;
  if (mapInstance) mapInstance.closePopup();
  suppressPopupReset = false;

  state.activeStationKey = 'all';
  state.activePhotoId = 'all';
  updateMapButtonStates();

  if (mapInstance && mapBounds) {
    mapInstance.flyToBounds(mapBounds, { duration: 0.8, padding: [30, 30] });
  }
}

function flyToWithVerticalOffset(latlng, zoom, offsetY = 0, options = {}) {
  if (!mapInstance) return;
  if (!offsetY) {
    mapInstance.flyTo(latlng, zoom, options);
    return;
  }
  const targetPoint = mapInstance.project(latlng, zoom).subtract([0, offsetY]);
  const targetLatLng = mapInstance.unproject(targetPoint, zoom);
  mapInstance.flyTo(targetLatLng, zoom, options);
}

function initMap() {
  const realStations = stations.filter(
    d => d.station_key !== 'all' && d.latitude != null && d.longitude != null
  );

  const standalonePhotos = imagePoints.filter(isStandaloneFloodPhoto);
  const stationPhotosByKey = d3.group(
    imagePoints.filter(d => d.station_key),
    d => d.station_key
  );

  markersByKey = {};
  photoMarkersById = {};

  mapInstance = L.map('map', {
    zoomControl: false,
    scrollWheelZoom: false,
    attributionControl: true,
    maxBoundsViscosity: 0.45,
    maxZoom: 19,
    zoomSnap: 0.1
  });

  L.control.zoom({ position: 'topright' }).addTo(mapInstance);

  L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{y}/{x}{r}.png'.replace('{y}/{x}', '{x}/{y}'),
    {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
        '&copy; <a href="https://carto.com/attributions">CARTO</a>'
    }
  ).addTo(mapInstance);

  const latlngs = [
    ...realStations.map(d => [d.latitude, d.longitude]),
    ...standalonePhotos.map(d => [d.latitude, d.longitude])
  ];

  mapBounds = L.latLngBounds([
    ...latlngs,
    ...OVERVIEW_MAP_BOUNDS
  ]).pad(0.08);
  photoBounds = standalonePhotos.length
    ? L.latLngBounds(standalonePhotos.map(d => [d.latitude, d.longitude])).pad(0.22)
    : null;

  mapInstance.setMaxBounds(mapBounds.pad(0.9));
  mapInstance.fitBounds(mapBounds);
  mapInstance.setMinZoom(mapInstance.getZoom());
  addZoomSliderControl();

  realStations.forEach(st => {
    const color = STATION_COLORS[st.station_key] || '#1562a4';
    const radius = st.station_key === 'kelowna' ? 9 : 7;
    const relatedPhotos = stationPhotosByKey.get(st.station_key) || [];

    const marker = L.circleMarker([st.latitude, st.longitude], {
      radius,
      color: '#ffffff',
      weight: 2,
      fillColor: color,
      fillOpacity: 0.92
    }).addTo(mapInstance);

    marker.bindPopup(buildStationPopupHtml(st, relatedPhotos), {
      maxWidth: 300,
      className: 'station-photo-popup'
    });

    marker.bindTooltip(buildStationTooltipHtml(st, relatedPhotos), {
      direction: 'top',
      sticky: true,
      opacity: 1,
      className: 'station-marker-tooltip'
    });

    marker.on('click', () => setActiveStation(st.station_key));
    marker.on('popupclose', () => {
      if (!suppressPopupReset && state.activeStationKey === st.station_key) {
        returnToAllStations();
      }
    });

    markersByKey[st.station_key] = marker;
  });

  standalonePhotos.forEach(photo => {
    const marker = L.circleMarker([photo.latitude, photo.longitude], {
      radius: 6,
      color: '#ffffff',
      weight: 2,
      fillColor: '#0e7475',
      fillOpacity: 0.95
    }).addTo(mapInstance);

    marker.bindPopup(buildStandalonePhotoPopupHtml(photo), {
      maxWidth: 300,
      className: 'standalone-photo-popup'
    });

    if (photo.marker_label || photo.title) {
      marker.bindTooltip(photo.marker_label || photo.title, {
        direction: 'top',
        offset: [0, -8],
        opacity: 0.9
      });
    }

    marker.on('click', () => setActivePhoto(photo.id));
    marker.on('popupclose', () => {
      if (!suppressPopupReset && state.activePhotoId === photo.id) {
        returnToAllStations();
      }
    });

    photoMarkersById[photo.id] = marker;
  });

  const row = document.getElementById('scenario-row');
  const buttons = [
    { key: 'all',               label: 'All stations' },
    { key: 'kelowna',           label: 'Kelowna lake level' },
    { key: 'penticton_outflow', label: 'Penticton outflow' },
    { key: 'brenda_mine',       label: 'Brenda Mine Snow' },
    { key: 'penticton_weather', label: 'Penticton A weather' }
  ];

  row.innerHTML = '';
  buttons.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'scen-btn';
    btn.dataset.station = item.key;
    btn.textContent = item.label;
    btn.addEventListener('click', () => setActiveStation(item.key));
    row.appendChild(btn);
  });

  const row2 = document.getElementById('scenario-row2');
  if (row2) {
    row2.innerHTML = '';

    standalonePhotos.forEach(photo => {
      const btn = document.createElement('button');
      btn.className = 'scen-btn';
      btn.dataset.photo = photo.id;
      btn.textContent = photoButtonLabel(photo);
      btn.addEventListener('click', () => setActivePhoto(photo.id));
      row2.appendChild(btn);
    });
  }

  state.activeStationKey = 'all';
  state.activePhotoId = 'all';
  updateMapButtonStates();

  document.getElementById('map-status').textContent =
    `CartoDB Positron · ${realStations.length} stations + ${standalonePhotos.length} photo locations`;
}

function setActiveStation(stationKey) {
  if (!mapInstance) return;

  if (stationKey === 'all') {
    returnToAllStations();
    return;
  }

  suppressPopupReset = true;
  mapInstance.closePopup();

  state.activeStationKey = stationKey;
  state.activePhotoId = 'all';
  updateMapButtonStates();

  const marker = markersByKey[stationKey];
  if (marker) {
    mapInstance.once('moveend', () => marker.openPopup());
    flyToWithVerticalOffset(marker.getLatLng(), 10.6, 145, { duration: 0.8 });
  }

  suppressPopupReset = false;
}

function setActivePhoto(photoId) {
  if (!mapInstance) return;

  if (photoId === 'all') {
    returnToAllStations();
    return;
  }

  suppressPopupReset = true;
  mapInstance.closePopup();

  state.activeStationKey = 'all';
  state.activePhotoId = photoId;
  updateMapButtonStates();

  const marker = photoMarkersById[photoId];
  if (marker) {
    mapInstance.once('moveend', () => marker.openPopup());
    flyToWithVerticalOffset(marker.getLatLng(), 11.2, 125, { duration: 0.8 });
  }

  suppressPopupReset = false;
}

/* ──────────────────────────────────────────────────────────────
   Section 1 — Ten-year time series
────────────────────────────────────────────────────────────── */
function initTimeSeries() {
  buildYearSelector('year-selector-1', () => {
    renderTimeSeries();
    if (state.chartsInit[3]) renderDrivers();
  });
  renderTimeSeries();
}

function renderTimeSeries() {
  const svg = d3.select('#timeseries-chart');
  svg.selectAll('*').remove();

  const W = 900, H = 380;
  const M = { top: 24, right: 96, bottom: 44, left: 62 };
  const pw = W - M.left - M.right;
  const ph = H - M.top - M.bottom;

  const levelVals    = chartRows.map(d => d.level).filter(v => v != null);
  const [yMin, yMax] = extentPad(levelVals, 0.08, 0.10);

  const g = svg.append('g').attr('transform', `translate(${M.left},${M.top})`);
  const x = d3.scaleLinear().domain([0, 364]).range([0, pw]);
  const y = d3.scaleLinear().domain([yMin, yMax]).range([ph, 0]);

  const monthDoys  = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];
  const monthStart = [0,  31, 59, 90,  120, 151, 181, 212, 243, 273, 304, 334];

  g.append('g').attr('class', 'grid')
    .call(d3.axisLeft(y).ticks(6).tickSize(-pw).tickFormat(''));

  const bandData = d3.range(365).map(doy => levelDoyStats[doy] ? { doy, ...levelDoyStats[doy] } : null).filter(Boolean);

  g.append('path')
    .datum(bandData)
    .attr('fill',   T.bandFill)
    .attr('stroke', 'none')
    .attr('d', d3.area()
      .x(d => x(d.doy))
      .y0(d => y(Math.max(yMin, d.lo)))
      .y1(d => y(Math.min(yMax, d.hi)))
      .curve(d3.curveBasis));

  g.append('path')
    .datum(bandData)
    .attr('fill',              'none')
    .attr('stroke',            T.meanLine)
    .attr('stroke-width',      1)
    .attr('stroke-dasharray',  '4 3')
    .attr('d', d3.line()
      .x(d => x(d.doy))
      .y(d => y(d.mean))
      .defined(d => d != null)
      .curve(d3.curveBasis));

  g.append('rect')
    .attr('x', 0).attr('width', pw)
    .attr('y', 0).attr('height', y(FULL_POOL_MASL))
    .attr('fill', T.fullPoolFill);

  g.append('line')
    .attr('x1', 0).attr('x2', pw)
    .attr('y1', y(FULL_POOL_MASL)).attr('y2', y(FULL_POOL_MASL))
    .attr('stroke',            T.fullPoolLine)
    .attr('stroke-width',      1)
    .attr('stroke-dasharray',  '5 4');

  g.append('text')
    .attr('x', pw + 8).attr('y', y(FULL_POOL_MASL) + 4)
    .attr('class', 'chart-annotation')
    .attr('fill', T.outflowCapacity)
    .text('Full Pool (342.48 m ASL)');

  monthStart.slice(1).forEach(doy => {
    g.append('line')
      .attr('x1', x(doy)).attr('x2', x(doy))
      .attr('y1', 0).attr('y2', ph)
      .attr('stroke', T.monthSep)
      .attr('stroke-width', 1);
  });

  if (state.selectedYear !== 2017) {
    g.append('path')
      .datum(byYear[2017] || [])
      .attr('fill', 'none')
      .attr('stroke', 'rgba(200,78,20,0.50)')
      .attr('stroke-width', 1.5)
      .attr('d', makeLine(x, y, yMin, yMax, 'level'));
  }

  const selColor = state.selectedYear === 2017 ? T.level2017 : T.levelSelected;
  g.append('path')
    .datum(byYear[state.selectedYear] || [])
    .attr('fill',         'none')
    .attr('stroke',       selColor)
    .attr('stroke-width', 2.2)
    .attr('d', makeLine(x, y, yMin, yMax, 'level'));

  const peakRow = (byYear[state.selectedYear] || []).reduce(
    (best, cur) => cur.level != null && cur.level > (best?.level ?? -Infinity) ? cur : best, null
  );
  if (peakRow) {
    g.append('circle')
      .attr('cx', x(peakRow.doy)).attr('cy', y(peakRow.level))
      .attr('r', 4)
      .attr('fill',         selColor)
      .attr('stroke',       '#ffffff')
      .attr('stroke-width', 2);

    g.append('text')
      .attr('x', x(peakRow.doy) + 8).attr('y', y(peakRow.level) - 10)
      .attr('fill', selColor)
      .attr('font-family', 'DM Sans, sans-serif')
      .attr('font-size', 11).attr('font-weight', '600')
      .text(`${state.selectedYear} peak: ${peakRow.level.toFixed(2)} m`);
  }

  g.append('g').attr('class', 'axis')
    .attr('transform', `translate(0,${ph})`)
    .call(d3.axisBottom(x).tickValues(monthDoys).tickFormat((d, i) => MONTHS[i]));

  g.append('g').attr('class', 'axis')
    .call(d3.axisLeft(y).ticks(6).tickFormat(d => d.toFixed(2) + ' m'));

  const vline = g.append('line')
    .attr('y1', 0).attr('y2', ph)
    .attr('stroke', T.hoverLine).attr('stroke-width', 1)
    .style('display', 'none');

  g.append('rect')
    .attr('width', pw).attr('height', ph)
    .attr('fill', 'transparent').style('cursor', 'crosshair')
    .on('mousemove', function(event) {
      const [mx] = d3.pointer(event);
      const doy  = Math.max(0, Math.min(364, Math.round(x.invert(mx))));
      vline.style('display', null).attr('x1', mx).attr('x2', mx);

      const selData = (byYear[state.selectedYear] || []).find(d => d.doy === doy);
      const d2017   = (byYear[2017]               || []).find(d => d.doy === doy);
      const stats   = levelDoyStats[doy];
      const label   = approxMonthDay(state.selectedYear, doy);

      let html = `<strong>${label}</strong><br>`;
      if (selData?.level != null)
        html += `<span style="color:${selColor}">${state.selectedYear}: ${selData.level.toFixed(3)} m</span><br>`;
      if (d2017?.level != null && state.selectedYear !== 2017)
        html += `<span style="color:${T.level2017}">2017: ${d2017.level.toFixed(3)} m</span><br>`;
      if (stats)
        html += `<span style="color:${T.tipMuted}">Decade mean: ${stats.mean.toFixed(3)} m</span>`;
      showTip(html, event);
    })
    .on('mouseleave', () => { vline.style('display', 'none'); hideTip(); });
}

/* ──────────────────────────────────────────────────────────────
   Section 2 — Calendar heatmap
────────────────────────────────────────────────────────────── */
function initHeatmap() { renderHeatmap(); }

function renderHeatmap() {
  const svg = d3.select('#heatmap-chart');
  svg.selectAll('*').remove();

  const W = 900, H = 360;
  const M = { top: 28, right: 184, bottom: 34, left: 62 };
  const pw = W - M.left - M.right;
  const ph = H - M.top - M.bottom;
  const g  = svg.append('g').attr('transform', `translate(${M.left},${M.top})`);

  const columns = [
    ...MONTHS.map((label, monthIndex) => ({ key: monthIndex, label, kind: 'month' })),
    { key: 'peak', label: 'Peak', kind: 'peak' }
  ];

  const cellW = pw / columns.length;
  const cellH = ph / YEARS.length;

  const allVals = YEARS.flatMap(y => [
    ...Object.values(heatmap[y]).filter(v => v != null),
    yearPeak[y]
  ].filter(v => v != null));

  const vMin = d3.min(allVals);
  const vMax = d3.max(allVals);
  const belowMid = vMin * 0.5;
  const aboveMid = vMax * 0.5;

  const color = d3.scaleLinear()
    .domain([vMin, belowMid, 0, aboveMid, vMax])
    .range(['#1f5f99', '#9ecae1', '#ffffff', '#f8bf86', '#d97706'])
    .clamp(true);

  columns.forEach((col, i) => {
    g.append('text')
      .attr('class', 'month-label')
      .attr('x', i * cellW + cellW / 2)
      .attr('y', -10)
      .attr('text-anchor', 'middle')
      .attr('fill', col.kind === 'peak' ? 'var(--text)' : 'var(--muted)')
      .attr('font-family', 'DM Sans, sans-serif')
      .attr('font-size', 11)
      .attr('font-weight', col.kind === 'peak' ? '700' : '500')
      .text(col.label);
  });

  YEARS.forEach((year, yi) => {
    columns.forEach((col, ci) => {
      const val = col.kind === 'peak' ? yearPeak[year] : heatmap[year][col.key];
      if (val == null) return;

      const isSelected = year === state.selectedYear;
      const cx = ci * cellW;
      const cy = yi * cellH;
      const fill = color(val);
      const textColor = pickTextColor(fill);

      const cell = g.append('rect')
        .attr('x', cx + 1.5)
        .attr('y', cy + 1.5)
        .attr('width', cellW - 3)
        .attr('height', cellH - 3)
        .attr('rx', col.kind === 'peak' ? 5 : 3)
        .attr('fill', fill)
        .attr('stroke', isSelected ? T.cellStrokeSel : (col.kind === 'peak' ? 'rgba(22,46,74,0.22)' : T.cellStroke))
        .attr('stroke-width', isSelected ? 1.6 : (col.kind === 'peak' ? 1 : 0.5))
        .style('cursor', 'pointer');

      g.append('text')
        .attr('x', cx + cellW / 2)
        .attr('y', cy + cellH / 2 + 3.5)
        .attr('text-anchor', 'middle')
        .attr('fill', textColor)
        .attr('font-family', 'DM Sans, sans-serif')
        .attr('font-size', 9.5)
        .attr('font-weight', col.kind === 'peak' || val >= 0 ? '700' : '500')
        .style('pointer-events', 'none')
        .text((Math.abs(val) < 0.005 ? 0 : val).toFixed(2));

      cell.on('mouseenter', function(event) {
        const aslValue = val + FULL_POOL_MASL;
        const peakRow = col.kind === 'peak'
          ? (byYear[year] || []).reduce(
              (best, cur) => cur.level != null && cur.level > (best?.level ?? -Infinity) ? cur : best,
              null
            )
          : null;
        d3.select(this).attr('stroke', T.cellStrokeHov).attr('stroke-width', 2);
        showTip(
          `<strong>${year} · ${col.label}</strong><br>` +
          `${col.kind === 'peak' ? 'Annual daily peak' : 'Monthly mean'}: <strong>${aslValue.toFixed(3)} m ASL</strong>` +
          `${peakRow ? `<br><span style="color:${T.tipMuted}">Peak day: ${approxMonthDay(year, peakRow.doy)}</span>` : ''}` +
          `<br><span style="color:${T.tipMuted}">${describeFullPoolOffset(val, 3)}</span>`,
          event
        );
      });
      cell.on('mousemove', moveTip);
      cell.on('mouseleave', function() {
        d3.select(this)
          .attr('stroke', isSelected ? T.cellStrokeSel : (col.kind === 'peak' ? 'rgba(22,46,74,0.22)' : T.cellStroke))
          .attr('stroke-width', isSelected ? 1.6 : (col.kind === 'peak' ? 1 : 0.5));
        hideTip();
      });
      cell.on('click', () => selectYearGlobal(year));
    });

    g.append('text')
      .attr('x', -8)
      .attr('y', yi * cellH + cellH / 2 + 4)
      .attr('text-anchor', 'end')
      .attr('fill', year === state.selectedYear ? 'var(--accent)' : 'var(--muted)')
      .attr('font-family', 'DM Sans, sans-serif')
      .attr('font-size', 11)
      .attr('font-weight', year === state.selectedYear ? '700' : '400')
      .style('cursor', 'pointer')
      .text(year)
      .on('click', () => selectYearGlobal(year));
  });

  const legendX = pw + 34;
  const legendY = 4;
  const legendH = ph - 8;

  const defs = svg.append('defs');
  const grad = defs.append('linearGradient')
    .attr('id', 'heat-grad')
    .attr('x1', '0%').attr('y1', '0%')
    .attr('x2', '0%').attr('y2', '100%');

  d3.range(0, 1.01, 0.05).forEach(t => {
    const v = vMax - (vMax - vMin) * t;
    grad.append('stop')
      .attr('offset', `${t * 100}%`)
      .attr('stop-color', color(v));
  });

  g.append('rect')
    .attr('x', legendX)
    .attr('y', legendY)
    .attr('width', 14)
    .attr('height', legendH)
    .attr('rx', 7)
    .attr('fill', 'url(#heat-grad)')
    .attr('stroke', 'var(--border)')
    .attr('stroke-width', 0.5);

  const legendScale = d3.scaleLinear()
    .domain([vMax, vMin])
    .range([legendY, legendY + legendH]);

  const tickValues = Array.from(new Set([
    +vMax.toFixed(2),
    +aboveMid.toFixed(2),
    0,
    +belowMid.toFixed(2),
    +vMin.toFixed(2)
  ])).sort((a, b) => b - a);

  g.append('g')
    .attr('class', 'axis')
    .attr('transform', `translate(${legendX + 22}, 0)`)
    .call(
      d3.axisRight(legendScale)
        .tickValues(tickValues)
        .tickFormat(d => fmtSignedMeters(d, 2).replace(' m', ''))
    );

  if (0 >= vMin && 0 <= vMax) {
    const fullPoolY = legendScale(0);

    g.append('line')
      .attr('x1', legendX - 4)
      .attr('x2', legendX + 18)
      .attr('y1', fullPoolY)
      .attr('y2', fullPoolY)
      .attr('stroke', T.fullPoolLine)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '4 3');

    g.append('text')
      .attr('x', legendX + 60)
      .attr('y', fullPoolY)
      .attr('dy', '0.32em')
      .attr('fill', T.fullPoolLabel)
      .attr('font-family', 'DM Sans, sans-serif')
      .attr('font-size', 9.5)
      .attr('font-weight', '600')
      .attr('text-anchor', 'start')
      .text('Full Pool (342.48 m ASL)');
  }

  g.append('text')
    .attr('x', legendX + 40)
    .attr('y', legendY - 10)
    .attr('text-anchor', 'middle')
    .attr('fill', 'var(--muted)')
    .attr('font-family', 'DM Sans, sans-serif')
    .attr('font-size', 9.5)
    .attr('letter-spacing', '0.04em')
    .text('m from full pool');
}

// Sync year selection across all charts
function selectYearGlobal(year) {
  state.selectedYear = year;
  document.querySelectorAll('.year-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.year, 10) === year);
  });
  renderHeatmap();
  if (state.chartsInit[1]) renderTimeSeries();
  if (state.chartsInit[3]) renderDrivers();
  if (state.chartsInit[4]) {
    state.impactsDayIndex = 0;
    renderImpacts();
  }
}

/* ──────────────────────────────────────────────────────────────
   Section 3 — Driver panels
────────────────────────────────────────────────────────────── */
function initDrivers() {
  buildYearSelector('year-selector-3', () => {
    document.querySelectorAll('#year-selector-1 .year-btn').forEach(b => {
      b.classList.toggle('active', parseInt(b.dataset.year, 10) === state.selectedYear);
    });
    renderTimeSeries();
    renderHeatmap();
    renderDrivers();
  });
  renderDrivers();
}

function renderDrivers() {
  const svg = d3.select('#drivers-chart');
  svg.selectAll('*').remove();

  const W = 900, H = 620;
  const M = { top: 16, right: 88, bottom: 44, left: 62 };
  const pw      = W - M.left - M.right;
  const totalPh = H - M.top - M.bottom;
  const gap     = 14;
  const panelH  = (totalPh - 3 * gap) / 4;

  const g = svg.append('g').attr('transform', `translate(${M.left},${M.top})`);
  const x = d3.scaleLinear().domain([0, 364]).range([0, pw]);

  const monthDoys  = [15,  46,  74, 105, 135, 166, 196, 227, 258, 288, 319, 349];
  const monthStart = [0,   31,  59,  90, 120, 151, 181, 212, 243, 273, 304, 334];

  const yearData = byYear[state.selectedYear] || [];
  const ref2017Data = byYear[2017] || [];

  const sweY0  = 0;
  const sweVals = chartRows.map(d => d.swe).filter(v => v != null);
  const sweMax  = Math.max(500, d3.max(sweVals) || 0);
  const sweY    = d3.scaleLinear().domain([0, sweMax]).range([sweY0 + panelH, sweY0]);
  const sweSmoothed = smooth(yearData, 'swe');
  const ref2017SweSmoothed = smooth(ref2017Data, 'swe');
  const sweBandData = smoothStatsSeries(sweDoyStats);

  drawPanel(g, 'SWE (mm)', sweY0, panelH, x, sweY, pw);

  g.append('path').datum(sweBandData)
    .attr('fill', T.sweMeanFill).attr('stroke', 'none')
    .attr('d', d3.area()
      .x(d => x(d.doy))
      .y0(d => sweY(Math.max(0, d.lo)))
      .y1(d => sweY(Math.max(0, d.hi)))
      .curve(d3.curveBasis));

  if (state.selectedYear !== 2017) {
    g.append('path')
      .datum(ref2017Data)
      .attr('fill', 'none')
      .attr('stroke', T.outflow2017).attr('stroke-width', 1.4)
      .attr('d', d3.line()
        .x(d => x(d.doy))
        .y((d, i) => ref2017SweSmoothed[i] != null ? sweY(Math.max(0, ref2017SweSmoothed[i])) : null)
        .defined((d, i) => ref2017SweSmoothed[i] != null)
        .curve(d3.curveBasis));
  }

  g.append('path')
    .datum(yearData)
    .attr('fill',         'none')
    .attr('stroke',       T.sweLine)
    .attr('stroke-width', 1.8)
    .attr('d', d3.line()
      .x(d => x(d.doy))
      .y((d, i) => sweSmoothed[i] != null ? sweY(Math.max(0, sweSmoothed[i])) : null)
      .defined((d, i) => sweSmoothed[i] != null)
      .curve(d3.curveBasis));

  const meltRow = yearData.find((d, i) =>
    d.month >= 3 &&
    sweSmoothed[i] != null &&
    sweSmoothed[i] < 10 &&
    (i === 0 || sweSmoothed[i - 1] > 10)
  );
  if (meltRow) {
    g.append('line')
      .attr('x1', x(meltRow.doy)).attr('x2', x(meltRow.doy))
      .attr('y1', sweY0).attr('y2', sweY0 + panelH)
      .attr('stroke',           T.snowmeltLine)
      .attr('stroke-dasharray', '4 3').attr('stroke-width', 1);
    g.append('text')
      .attr('x', x(meltRow.doy) + 4).attr('y', sweY0 + 14)
      .attr('fill', T.snowmeltLine)
      .attr('font-family', 'DM Sans, sans-serif').attr('font-size', 9)
      .text('snowmelt complete');
  }

  const tempY0 = panelH + gap;
  const tempVals = chartRows.map(d => d.temp).filter(v => v != null);
  const tMin = Math.min(-15, d3.min(tempVals) || 0);
  const tMax = Math.max(35,  d3.max(tempVals) || 0);
  const tempY = d3.scaleLinear().domain([tMin, tMax]).range([tempY0 + panelH, tempY0]);
  const tempSmoothed = smooth(yearData, 'temp');
  const ref2017TempSmoothed = smooth(ref2017Data, 'temp');
  const tempBandData = smoothStatsSeries(tempDoyStats);

  drawPanel(g, 'Temp (°C)', tempY0, panelH, x, tempY, pw);

  g.append('line')
    .attr('x1', 0).attr('x2', pw)
    .attr('y1', tempY(0)).attr('y2', tempY(0))
    .attr('stroke', T.tempZero).attr('stroke-dasharray', '3 3').attr('stroke-width', 1);

  g.append('path').datum(tempBandData)
    .attr('fill', T.tempColdFill).attr('stroke', 'none')
    .attr('d', d3.area()
      .x(d => x(d.doy))
      .y0(d => tempY(clamp(d.lo, tMin, tMax)))
      .y1(d => tempY(clamp(d.hi, tMin, tMax)))
      .curve(d3.curveBasis));

  if (state.selectedYear !== 2017) {
    g.append('path').datum(ref2017Data)
      .attr('fill', 'none')
      .attr('stroke', T.outflow2017).attr('stroke-width', 1.4)
      .attr('d', d3.line()
        .x(d => x(d.doy))
        .y((d, i) => ref2017TempSmoothed[i] != null ? tempY(clamp(ref2017TempSmoothed[i], tMin, tMax)) : null)
        .defined((d, i) => ref2017TempSmoothed[i] != null)
        .curve(d3.curveBasis));
  }

  g.append('path').datum(yearData)
    .attr('fill', 'none')
    .attr('stroke', T.tempLine).attr('stroke-width', 1.8)
    .attr('d', d3.line()
      .x(d => x(d.doy))
      .y((d, i) => tempSmoothed[i] != null ? tempY(clamp(tempSmoothed[i], tMin, tMax)) : null)
      .defined((d, i) => tempSmoothed[i] != null)
      .curve(d3.curveBasis));

  const outY0  = 2 * (panelH + gap);
  const outVals = chartRows.map(d => d.outflow).filter(v => v != null);
  const outMin  = Math.max(0, d3.min(outVals) - 4);
  const outMax  = d3.max(outVals) + 4;
  const outY    = d3.scaleLinear().domain([outMin, outMax]).range([outY0 + panelH, outY0]);

  drawPanel(g, 'Outflow (m³/s)', outY0, panelH, x, outY, pw);

  const downstreamCapacity = 60;
  if (downstreamCapacity >= outMin && downstreamCapacity <= outMax) {
    g.append('line')
      .attr('x1', 0).attr('x2', pw)
      .attr('y1', outY(downstreamCapacity)).attr('y2', outY(downstreamCapacity))
      .attr('stroke', T.outflowCapacity).attr('stroke-width', 1)
      .attr('stroke-dasharray', '4 3');

    g.append('text')
      .attr('x', pw - 4).attr('y', outY(downstreamCapacity) - 4)
      .attr('text-anchor', 'end')
      .attr('class', 'chart-annotation')
      .attr('fill', T.outflowCapacity)
      .text('Downstream capacity (60 m³/s)');
  }

  const outBandData = smoothStatsSeries(outflowDoyStats);

  g.append('path').datum(outBandData)
    .attr('fill', T.outflowBand).attr('stroke', 'none')
    .attr('d', d3.area()
      .x(d => x(d.doy))
      .y0(d => outY(clamp(d.lo, outMin, outMax)))
      .y1(d => outY(clamp(d.hi, outMin, outMax)))
      .curve(d3.curveBasis));

  if (state.selectedYear !== 2017) {
    g.append('path').datum(byYear[2017] || [])
      .attr('fill', 'none')
      .attr('stroke', T.outflow2017).attr('stroke-width', 1.4)
      .attr('d', makeLine(x, outY, outMin, outMax, 'outflow'));
  }

  const outColor = state.selectedYear === 2017 ? T.outflowSel : T.outflowSelOther;
  g.append('path').datum(yearData)
    .attr('fill', 'none')
    .attr('stroke', outColor).attr('stroke-width', 1.8)
    .attr('d', makeLine(x, outY, outMin, outMax, 'outflow'));

  const lvlY0  = 3 * (panelH + gap);
  const lvlVals = chartRows.map(d => d.level).filter(v => v != null);
  const [lvlMin, lvlMax] = extentPad(lvlVals, 0.08, 0.10);
  const lvlY = d3.scaleLinear().domain([lvlMin, lvlMax]).range([lvlY0 + panelH, lvlY0]);

  drawPanel(g, 'Lake level (m)', lvlY0, panelH, x, lvlY, pw);

  const lvlBandData = smoothStatsSeries(levelDoyStats);

  g.append('path').datum(lvlBandData)
    .attr('fill', T.levelBand).attr('stroke', 'none')
    .attr('d', d3.area()
      .x(d => x(d.doy))
      .y0(d => lvlY(clamp(d.lo, lvlMin, lvlMax)))
      .y1(d => lvlY(clamp(d.hi, lvlMin, lvlMax)))
      .curve(d3.curveBasis));

  g.append('line')
    .attr('x1', 0).attr('x2', pw)
    .attr('y1', lvlY(FULL_POOL_MASL)).attr('y2', lvlY(FULL_POOL_MASL))
    .attr('stroke', T.outflowCapacity).attr('stroke-width', 1)
    .attr('stroke-dasharray', '4 3');

  g.append('text')
    .attr('x', pw - 4).attr('y', lvlY(FULL_POOL_MASL) - 4)
    .attr('text-anchor', 'end')
    .attr('class', 'chart-annotation')
    .attr('fill', T.outflowCapacity)
    .text('Full Pool (342.48 m ASL)');

  if (state.selectedYear !== 2017) {
    g.append('path').datum(byYear[2017] || [])
      .attr('fill', 'none')
      .attr('stroke', T.outflow2017).attr('stroke-width', 1.4)
      .attr('d', makeLine(x, lvlY, lvlMin, lvlMax, 'level'));
  }

  const selColor = T.levelSelected;
  g.append('path').datum(yearData)
    .attr('fill', 'none')
    .attr('stroke', selColor).attr('stroke-width', 1.8)
    .attr('d', makeLine(x, lvlY, lvlMin, lvlMax, 'level'));

  g.append('g').attr('class', 'axis')
    .attr('transform', `translate(0,${totalPh})`)
    .call(d3.axisBottom(x).tickValues(monthDoys).tickFormat((d, i) => MONTHS[i]));

  monthStart.slice(1).forEach(doy => {
    g.append('line')
      .attr('x1', x(doy)).attr('x2', x(doy))
      .attr('y1', 0).attr('y2', totalPh)
      .attr('stroke', T.monthSep).attr('stroke-width', 1);
  });

  const vline = g.append('line')
    .attr('y1', 0).attr('y2', totalPh)
    .attr('stroke', T.hoverLine).attr('stroke-width', 1)
    .style('display', 'none');

  g.append('rect')
    .attr('width', pw).attr('height', totalPh)
    .attr('fill', 'transparent').style('cursor', 'crosshair')
    .on('mousemove', function(event) {
      const [mx] = d3.pointer(event);
      const doy  = Math.max(0, Math.min(364, Math.round(x.invert(mx))));
      vline.style('display', null).attr('x1', mx).attr('x2', mx);

      const row = yearData.find(d => d.doy === doy);
      if (!row) return;

      showTip(
        `<strong>${approxMonthDay(state.selectedYear, doy)}, ${state.selectedYear}</strong><br>` +
        `<span style="color:${T.sweLine}">SWE: ${fmt(row.swe, 0, ' mm')}</span><br>` +
        `<span style="color:${T.tempLine}">Temp: ${fmt(row.temp, 1, ' °C')}</span><br>` +
        `<span style="color:${T.outflowSel}">Outflow: ${fmt(row.outflow, 1, ' m³/s')}</span><br>` +
        `<span style="color:${T.levelSelected}">Level: ${fmt(row.level, 3, ' m')}</span>`,
        event
      );
    })
    .on('mouseleave', () => { vline.style('display', 'none'); hideTip(); });
}

/* ──────────────────────────────────────────────────────────────
   Shared: drawPanel (grid + y-axis + label)
────────────────────────────────────────────────────────────── */
function drawPanel(g, label, y0, pH, x, yScale, pw) {
  g.append('g').attr('class', 'grid')
    .call(d3.axisLeft(yScale).ticks(3).tickSize(-pw).tickFormat(''));

  g.append('g').attr('class', 'axis')
    .call(d3.axisLeft(yScale).ticks(3));

  g.append('text')
    .attr('x', -42).attr('y', y0 + pH / 2)
    .attr('text-anchor', 'middle')
    .attr('transform',   `rotate(-90, -42, ${y0 + pH / 2})`)
    .attr('fill',        'var(--muted)')
    .attr('font-family', 'DM Sans, sans-serif')
    .attr('font-size',   9.5)
    .attr('letter-spacing', '0.05em')
    .text(label);
}

/* ──────────────────────────────────────────────────────────────
   Section 4 — Impacts schematic
────────────────────────────────────────────────────────────── */
function initImpacts() {
  buildYearSelector('year-selector-4', () => {
    state.impactsDayIndex = 0;
    stopImpactsAnimation();
    selectYearGlobal(state.selectedYear);
  });

  const playBtn = document.getElementById('impact-play-btn');
  if (playBtn) {
    playBtn.addEventListener('click', () => {
      if (state.impactsPlaying) {
        stopImpactsAnimation();
        return;
      }
      startImpactsAnimation();
    });
  }

  const slider = document.getElementById('impact-day-slider');
  if (slider) {
    slider.addEventListener('input', event => {
      state.impactsDayIndex = +event.target.value;
      renderImpacts();
    });
  }

  const speedSelect = document.getElementById('impact-speed');
  if (speedSelect) {
    speedSelect.value = String(impactsSpeedMs);
    speedSelect.addEventListener('change', event => {
      impactsSpeedMs = +event.target.value;
      if (state.impactsPlaying) startImpactsAnimation();
    });
  }

  renderImpacts();
}

function renderImpacts() {
  const svg = d3.select('#impacts-chart');
  svg.selectAll('*').remove();

  const yearData = (byYear[state.selectedYear] || []).filter(d => d.level != null);
  if (!yearData.length) return;
  if (state.impactsDayIndex >= yearData.length) state.impactsDayIndex = 0;
  const dayRow = yearData[state.impactsDayIndex];
  updateImpactsControls(yearData);

  const W = 900, H = 430;
  const M = { top: 32, right: 188, bottom: 36, left: 58 };
  const pw = W - M.left - M.right;
  const ph = H - M.top - M.bottom;

  // Reference elevations (m ASL)
  const EL = {
    fullPool:   342.48,
    shore:      342.50,
    crawlFloor: 342.86,
    gradeFront: 343.05,
    gradeRear:  343.15,
    fcl:        343.66,
    finFloor:   343.94,
  };

  const yMin = 341.20;
  const yMax = 345.60;
  const y = d3.scaleLinear().domain([yMin, yMax]).range([ph, 0]);
  const g = svg.append('g').attr('transform', `translate(${M.left},${M.top})`);

  // ── SVG defs: water gradient, sky gradient ──────────────────
  const defs = svg.append('defs');

  const waterGrad = defs.append('linearGradient')
    .attr('id', 'imp-water-grad').attr('x1', '0').attr('y1', '0').attr('x2', '0').attr('y2', '1');
  waterGrad.append('stop').attr('offset', '0%').attr('stop-color', '#4ea8d8').attr('stop-opacity', 0.55);
  waterGrad.append('stop').attr('offset', '100%').attr('stop-color', '#1d72b8').attr('stop-opacity', 0.28);

  const lotGrad = defs.append('linearGradient')
    .attr('id', 'imp-lot-grad').attr('x1', '0').attr('y1', '0').attr('x2', '0').attr('y2', '1');
  lotGrad.append('stop').attr('offset', '0%').attr('stop-color', '#c9a96e').attr('stop-opacity', 0.70);
  lotGrad.append('stop').attr('offset', '100%').attr('stop-color', '#a07848').attr('stop-opacity', 0.85);

  const wallGrad = defs.append('linearGradient')
    .attr('id', 'imp-wall-grad').attr('x1', '0').attr('y1', '0').attr('x2', '0').attr('y2', '1');
  wallGrad.append('stop').attr('offset', '0%').attr('stop-color', '#faf6ec');
  wallGrad.append('stop').attr('offset', '100%').attr('stop-color', '#ede4cb');

  const csGrad = defs.append('linearGradient')
    .attr('id', 'imp-cs-grad').attr('x1', '0').attr('y1', '0').attr('x2', '0').attr('y2', '1');
  csGrad.append('stop').attr('offset', '0%').attr('stop-color', '#d6c8a2');
  csGrad.append('stop').attr('offset', '100%').attr('stop-color', '#c4b080');

  const roofGrad = defs.append('linearGradient')
    .attr('id', 'imp-roof-grad').attr('x1', '0').attr('y1', '0').attr('x2', '1').attr('y2', '1');
  roofGrad.append('stop').attr('offset', '0%').attr('stop-color', '#7a4030');
  roofGrad.append('stop').attr('offset', '100%').attr('stop-color', '#a05545');

  // Flood water fill gradient
  const floodGrad = defs.append('linearGradient')
    .attr('id', 'imp-flood-grad').attr('x1', '0').attr('y1', '0').attr('x2', '0').attr('y2', '1');
  floodGrad.append('stop').attr('offset', '0%').attr('stop-color', '#3a9fd6').attr('stop-opacity', 0.52);
  floodGrad.append('stop').attr('offset', '100%').attr('stop-color', '#1a62a4').attr('stop-opacity', 0.28);

  const lv  = dayRow.level;
  const wY  = y(lv);

  // ── Layout constants ─────────────────────────────────────────
  const shoreX  = 130;
  const houseL  = 360;
  const houseR  = 565;
  const hW      = houseR - houseL;
  const hCentX  = houseL + hW / 2;

  const yFP     = y(EL.fullPool);
  const yShore  = y(EL.shore);
  const yCS     = y(EL.crawlFloor);
  const yGrF    = y(EL.gradeFront);
  const yGrR    = y(EL.gradeRear);
  const yFCL    = y(EL.fcl);
  const yWallTop= y(EL.finFloor + 1.10);
  const yPeak   = y(EL.finFloor + 2.00);

  // ── Grid & y-axis ────────────────────────────────────────────
  g.append('g').attr('class', 'grid')
    .call(
      d3.axisLeft(y)
        .tickValues((() => {
          const ticks = y.ticks(8);
          const firstAboveFcl = ticks.find(v => v > EL.fcl);
          return ticks.filter(v => v <= EL.fcl || v === firstAboveFcl);
        })())
        .tickSize(-pw)
        .tickFormat(d => d.toFixed(1))
    );

  // ── Background sky band (above lot, below chart top) ─────────
  // ── Lot / ground surface ─────────────────────────────────────
  const lotSurfacePts = [
    [shoreX, yShore],
    [houseL, yGrF],
    [houseR, yGrR],
    [pw,     y(EL.gradeRear + 0.10)]
  ];
  // Fill below grade
  g.append('path')
    .attr('d', d3.line()(lotSurfacePts) + ` L ${pw},${ph + 4} L ${shoreX},${ph + 4} Z`)
    .attr('fill', 'url(#imp-lot-grad)');
  // Grade surface line
  g.append('path')
    .attr('d', d3.line()(lotSurfacePts))
    .attr('fill', 'none')
    .attr('stroke', '#7a5630')
    .attr('stroke-width', 2.2)
    .attr('stroke-linejoin', 'round');

  // ── Lake water body (left of shore) ──────────────────────────
  g.append('rect')
    .attr('x', 0).attr('y', wY)
    .attr('width', shoreX + 1).attr('height', ph - wY + 4)
    .attr('fill', 'url(#imp-water-grad)');

  // Water surface line in lake
  g.append('line')
    .attr('x1', 0).attr('x2', shoreX + 1)
    .attr('y1', wY).attr('y2', wY)
    .attr('stroke', '#1d72b8').attr('stroke-width', 2.2)
    .attr('stroke-linecap', 'round');

  // ── Retaining wall (simple grey rect at shore edge) ───────────
  g.append('rect')
    .attr('x', shoreX - 1).attr('y', yShore - 12)
    .attr('width', 8).attr('height', ph - yShore + 16)
    .attr('fill', '#888');

  // ── Overland flooding (water overtops retaining wall, creeps up lot) ─
  if (lv > EL.shore) {
    // Interpolate how far across the lot the water reaches
    let lotEdgeX;
    if (lv >= EL.gradeFront) {
      lotEdgeX = houseL;
    } else {
      const t = (lv - EL.shore) / (EL.gradeFront - EL.shore);
      lotEdgeX = shoreX + t * (houseL - shoreX);
    }

    // Build flood polygon following grade surface then back along water line
    const floodPoly = [[shoreX, yShore]];
    if (lv >= EL.gradeFront) {
      floodPoly.push([houseL, yGrF]);
      floodPoly.push([houseL, wY]);
    } else {
      floodPoly.push([lotEdgeX, wY]);
    }
    floodPoly.push([shoreX, wY]);

    g.append('polygon')
      .attr('points', floodPoly.map(p => p.join(',')).join(' '))
      .attr('fill', 'url(#imp-flood-grad)');

    // Leading edge of flood water
    g.append('line')
      .attr('x1', shoreX).attr('x2', lotEdgeX)
      .attr('y1', wY).attr('y2', wY)
      .attr('stroke', '#1d72b8').attr('stroke-width', 2.2)
      .attr('stroke-linecap', 'round');
  }

  // ── Reference level lines ─────────────────────────────────────
  // Full pool
  g.append('line').attr('x1', 0).attr('x2', pw)
    .attr('y1', yFP).attr('y2', yFP)
    .attr('stroke', T.fullPoolLine).attr('stroke-dasharray', '6 4').attr('stroke-width', 1.5);
  // FCL
  g.append('line').attr('x1', 0).attr('x2', pw)
    .attr('y1', yFCL).attr('y2', yFCL)
    .attr('stroke', 'rgba(22,46,74,0.32)').attr('stroke-dasharray', '5 3').attr('stroke-width', 1.2);
  // Crawlspace floor
  g.append('line').attr('x1', 0).attr('x2', pw)
    .attr('y1', yCS).attr('y2', yCS)
    .attr('stroke', 'rgba(21,98,164,0.42)').attr('stroke-dasharray', '3 5').attr('stroke-width', 1.0);
  // Lot grade at house
  g.append('line').attr('x1', 0).attr('x2', pw)
    .attr('y1', yGrF).attr('y2', yGrF)
    .attr('stroke', 'rgba(100,75,40,0.40)').attr('stroke-dasharray', '3 5').attr('stroke-width', 1.0);

  // ── House drawing group ───────────────────────────────────────
  const hG = g.append('g').attr('class', 'impacts-house');

  // — Roof (drawn first, sits behind chimney) —
  const roofOverhang = 14;
  const roofPts = [
    [houseL - roofOverhang, yWallTop],
    [hCentX, yPeak],
    [houseR + roofOverhang, yWallTop]
  ];
  // Roof fill
  hG.append('path')
    .attr('d', d3.line()(roofPts) + ` L ${houseR + roofOverhang},${yWallTop} Z`)
    .attr('fill', 'url(#imp-roof-grad)')
    .attr('opacity', 0.88);
  // Roof outline
  hG.append('path')
    .attr('d', `M ${houseL - roofOverhang},${yWallTop} L ${hCentX},${yPeak} L ${houseR + roofOverhang},${yWallTop}`)
    .attr('fill', 'none')
    .attr('stroke', '#5a2e22').attr('stroke-width', 2.2)
    .attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round');
  // Roof ridge highlight
  hG.append('line')
    .attr('x1', houseL - roofOverhang + 6).attr('x2', hCentX - 2)
    .attr('y1', yWallTop + 3).attr('y2', yPeak + 2)
    .attr('stroke', 'rgba(255,220,200,0.30)').attr('stroke-width', 3)
    .attr('stroke-linecap', 'round');

  // — Chimney —
  const chimX = hCentX + 22;
  const chimW = 14;
  const chimTop = yPeak + 2;
  const chimBot = yWallTop + 4;
  hG.append('rect')
    .attr('x', chimX).attr('y', chimTop)
    .attr('width', chimW).attr('height', chimBot - chimTop)
    .attr('fill', '#a06050').attr('stroke', '#5a2e22').attr('stroke-width', 1);
  hG.append('rect')
    .attr('x', chimX - 2).attr('y', chimTop - 4)
    .attr('width', chimW + 4).attr('height', 5)
    .attr('fill', '#7a4030');

  // — Main wall (above FCL) —
  hG.append('rect')
    .attr('x', houseL).attr('y', yWallTop)
    .attr('width', hW).attr('height', yFCL - yWallTop)
    .attr('fill', 'url(#imp-wall-grad)')
    .attr('stroke', 'rgba(82,64,44,0.65)').attr('stroke-width', 1.4);

  // Wall shadow (right side)
  hG.append('rect')
    .attr('x', houseR - 4).attr('y', yWallTop)
    .attr('width', 4).attr('height', yFCL - yWallTop)
    .attr('fill', 'rgba(0,0,0,0.07)');

  // — Crawlspace zone (below FCL, above crawl floor) —
  hG.append('rect')
    .attr('x', houseL).attr('y', yFCL)
    .attr('width', hW).attr('height', yCS - yFCL)
    .attr('fill', 'url(#imp-cs-grad)')
    .attr('stroke', 'rgba(108,86,56,0.55)').attr('stroke-width', 1.2);

  // Crawlspace inner face (slightly inset)
  hG.append('rect')
    .attr('x', houseL + 3).attr('y', yFCL + 2)
    .attr('width', hW - 6).attr('height', yCS - yFCL - 4)
    .attr('fill', 'rgba(210,192,148,0.65)');

  // FCL floor beam (thick line at base of main floor)
  hG.append('line')
    .attr('x1', houseL).attr('x2', houseR)
    .attr('y1', yFCL).attr('y2', yFCL)
    .attr('stroke', '#5a3c1e').attr('stroke-width', 4);

  // — Crawlspace vents —
  const ventMidY = yFCL + (yCS - yFCL) * 0.52;
  const ventCount = 4;
  const ventSpacing = (hW - 20) / ventCount;
  d3.range(ventCount).forEach(vi => {
    const vx = houseL + 10 + vi * ventSpacing;
    hG.append('rect')
      .attr('x', vx).attr('y', ventMidY - 4)
      .attr('width', 18).attr('height', 7)
      .attr('fill', 'rgba(90,60,30,0.50)').attr('rx', 2).attr('ry', 2);
    // vent grille lines
    [0, 1, 2].forEach(gi => {
      hG.append('line')
        .attr('x1', vx + 4 + gi * 4).attr('x2', vx + 4 + gi * 4)
        .attr('y1', ventMidY - 3).attr('y2', ventMidY + 3)
        .attr('stroke', 'rgba(90,60,30,0.30)').attr('stroke-width', 0.7);
    });
  });

  // — Grade extensions (foundation footing lines) —
  hG.append('line')
    .attr('x1', houseL - 14).attr('x2', houseL + 8)
    .attr('y1', yGrF + 1).attr('y2', yGrF + 1)
    .attr('stroke', 'rgba(100,75,40,0.55)').attr('stroke-width', 1.6);
  hG.append('line')
    .attr('x1', houseR - 8).attr('x2', houseR + 14)
    .attr('y1', yGrR + 1).attr('y2', yGrR + 1)
    .attr('stroke', 'rgba(100,75,40,0.55)').attr('stroke-width', 1.6);

  // — Windows (main floor) —
  const winTop    = yWallTop + 18;
  const winH      = Math.max(22, yFCL - winTop - 70);
  const winW      = 32;
  const winPositions = [houseL + 18, hCentX - winW / 2 - 4, houseR - 18 - winW];
  winPositions.forEach(xw => {
    // Window frame
    hG.append('rect')
      .attr('x', xw - 1).attr('y', winTop - 1)
      .attr('width', winW + 2).attr('height', winH + 2)
      .attr('fill', 'rgba(82,64,44,0.45)').attr('rx', 1);
    // Window glass
    hG.append('rect')
      .attr('x', xw).attr('y', winTop)
      .attr('width', winW).attr('height', winH)
      .attr('fill', '#c8e0ef').attr('rx', 1);
    // Window pane dividers
    hG.append('line')
      .attr('x1', xw + winW / 2).attr('x2', xw + winW / 2)
      .attr('y1', winTop).attr('y2', winTop + winH)
      .attr('stroke', 'rgba(82,64,44,0.30)').attr('stroke-width', 1);
    hG.append('line')
      .attr('x1', xw).attr('x2', xw + winW)
      .attr('y1', winTop + winH * 0.48).attr('y2', winTop + winH * 0.48)
      .attr('stroke', 'rgba(82,64,44,0.30)').attr('stroke-width', 1);
    // Window sill
    hG.append('line')
      .attr('x1', xw - 2).attr('x2', xw + winW + 2)
      .attr('y1', winTop + winH + 2).attr('y2', winTop + winH + 2)
      .attr('stroke', 'rgba(82,64,44,0.50)').attr('stroke-width', 1.5);
    // Window glare highlight
    hG.append('line')
      .attr('x1', xw + 3).attr('x2', xw + winW * 0.4)
      .attr('y1', winTop + 3).attr('y2', winTop + winH * 0.35)
      .attr('stroke', 'rgba(255,255,255,0.45)').attr('stroke-width', 1.5)
      .attr('stroke-linecap', 'round');
  });

  // — Front door —
  const doorW  = 26;
  const doorH  = 62;
  const doorX  = hCentX - doorW / 2 + 22; // slightly off-centre (asymmetric facade)
  hG.append('rect')
    .attr('x', doorX - 1).attr('y', yFCL - doorH - 1)
    .attr('width', doorW + 2).attr('height', doorH + 2)
    .attr('fill', 'rgba(82,64,44,0.40)').attr('rx', 1);
  hG.append('rect')
    .attr('x', doorX).attr('y', yFCL - doorH)
    .attr('width', doorW).attr('height', doorH)
    .attr('fill', '#b8834e').attr('rx', 1);
  // Door panel inset
  hG.append('rect')
    .attr('x', doorX + 4).attr('y', yFCL - doorH + 6)
    .attr('width', doorW - 8).attr('height', (doorH - 10) * 0.45)
    .attr('fill', 'none').attr('stroke', 'rgba(82,64,44,0.35)').attr('stroke-width', 0.8);
  hG.append('rect')
    .attr('x', doorX + 4).attr('y', yFCL - doorH + 6 + (doorH - 10) * 0.45 + 4)
    .attr('width', doorW - 8).attr('height', (doorH - 10) * 0.45)
    .attr('fill', 'none').attr('stroke', 'rgba(82,64,44,0.35)').attr('stroke-width', 0.8);
  // Door knob
  hG.append('circle')
    .attr('cx', doorX + doorW - 7).attr('cy', yFCL - doorH * 0.40)
    .attr('r', 2.2)
    .attr('fill', '#d4a060');

  // — Entry steps (stair on left side of door) —
  const stepCount  = 4;
  const stepRun    = 11;
  const stepDrop   = (yGrF - yFCL) / stepCount;
  const stairStartX = doorX - 4;
  const stairPts = [];
  for (let s = 0; s <= stepCount; s++) {
    stairPts.push([stairStartX - s * stepRun,       yFCL + s * stepDrop]);
    if (s < stepCount) {
      stairPts.push([stairStartX - (s + 1) * stepRun, yFCL + s * stepDrop]);
    }
  }
  hG.append('path')
    .attr('d', d3.line()(stairPts))
    .attr('fill', 'none')
    .attr('stroke', 'rgba(100,78,44,0.62)').attr('stroke-width', 1.8)
    .attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round');

  // — Water inside crawlspace —
  if (lv > EL.crawlFloor) {
    const csWaterTop = Math.min(lv, EL.fcl);
    const csWaterTopY = y(csWaterTop);
    hG.append('rect')
      .attr('x', houseL + 3).attr('y', csWaterTopY)
      .attr('width', hW - 6).attr('height', yCS - csWaterTopY)
      .attr('fill', 'rgba(42,124,198,0.45)');
    hG.append('line')
      .attr('x1', houseL + 3).attr('x2', houseR - 3)
      .attr('y1', csWaterTopY).attr('y2', csWaterTopY)
      .attr('stroke', '#1d72b8').attr('stroke-width', 1.6)
      .attr('stroke-dasharray', '4 3');
  }

  // — Water inside main floor —
  if (lv > EL.fcl) {
    const mainWaterTop  = Math.min(lv, EL.finFloor + 0.5);
    const mainWaterTopY = y(mainWaterTop);
    hG.append('rect')
      .attr('x', houseL + 3).attr('y', mainWaterTopY)
      .attr('width', hW - 6).attr('height', yFCL - mainWaterTopY)
      .attr('fill', 'rgba(42,124,198,0.35)');
    hG.append('line')
      .attr('x1', houseL + 3).attr('x2', houseR - 3)
      .attr('y1', mainWaterTopY).attr('y2', mainWaterTopY)
      .attr('stroke', '#1d72b8').attr('stroke-width', 1.6)
      .attr('stroke-dasharray', '4 3');
  }

  // ── Annotation labels (right margin) ─────────────────────────
  const lbX = houseR + 102;
  const labelData = [
    { el: EL.fcl,        txt: `FCL  ${EL.fcl} m`,         color: 'rgba(22,46,74,0.82)', fw: '600', fs: 10.5 },
    { el: EL.crawlFloor, txt: `Crawlspace  ${EL.crawlFloor} m`, color: 'rgba(21,98,164,0.82)', fw: '500', fs: 9.5 },
    { el: EL.gradeFront, txt: `Lot grade  ${EL.gradeFront} m`, color: 'rgba(100,75,40,0.78)', fw: '500', fs: 9.5 },
    { el: EL.fullPool,   txt: `Full pool  ${EL.fullPool} m`, color: T.fullPoolLabel,       fw: '600', fs: 10 },
  ];
  labelData.forEach(({ el, txt, color, fw, fs }) => {
    // Tick mark
    g.append('line')
      .attr('x1', pw - 4).attr('x2', pw + 5)
      .attr('y1', y(el)).attr('y2', y(el))
      .attr('stroke', color).attr('stroke-width', 1.2);
    g.append('text')
      .attr('x', lbX).attr('y', y(el) + 4)
      .attr('fill', color)
      .attr('font-family', 'DM Sans, sans-serif')
      .attr('font-size', fs).attr('font-weight', fw)
      .text(txt);
  });
  // ── Animated water level readout ─────────────────────────────
  const abovePool   = lv - EL.fullPool;
  const readoutAbove = wY > 26;
  const readoutY    = readoutAbove ? wY - 10 : wY + 18;
  const readoutBgH  = 18;
  const readoutBgW  = 230;

  g.append('rect')
    .attr('x', 2).attr('y', readoutY - readoutBgH + 3)
    .attr('width', readoutBgW).attr('height', readoutBgH)
    .attr('fill', 'rgba(255,255,255,0.82)').attr('rx', 3);

  g.append('text')
    .attr('x', 8).attr('y', readoutY)
    .attr('fill', '#1562a4')
    .attr('font-family', 'DM Sans, sans-serif')
    .attr('font-size', 11.5).attr('font-weight', '700')
    .text(`${approxMonthDay(state.selectedYear, dayRow.doy)}, ${state.selectedYear} - ${lv.toFixed(3)} m ASL`);

  // ── Disclaimer ────────────────────────────────────────────────
  // ── Sidecar stats ─────────────────────────────────────────────
  const depthAboveFCL = Math.max(0, lv - EL.fcl);
  const boardFCL      = EL.fcl - lv;
  const sidecar = document.getElementById('impacts-sidecar');
  if (sidecar) {
    const fclColor = depthAboveFCL > 0 ? 'color:#c84e14;font-weight:600;' : '';
    sidecar.innerHTML = `
      <div class="impact-stat-card">
        <div class="impact-stat-label">Date</div>
        <div class="impact-stat-value">${approxMonthDay(state.selectedYear, dayRow.doy)}, ${state.selectedYear}</div>
      </div>
      <div class="impact-stat-card">
        <div class="impact-stat-label">Lake elevation</div>
        <div class="impact-stat-value">${lv.toFixed(3)} m ASL</div>
        <div class="impact-stat-sub">${describeFullPoolOffset(lv - EL.fullPool, 3)}</div>
      </div>
      <div class="impact-stat-card">
        <div class="impact-stat-label">Impact stage</div>
        <div class="impact-stat-value">${impactStageLabel(lv)}</div>
        <div class="impact-stat-sub" style="${fclColor}">
          ${depthAboveFCL > 0
            ? `${depthAboveFCL.toFixed(3)} m above FCL`
            : `${boardFCL.toFixed(3)} m below FCL`}
        </div>
      </div>
    `;
  }
}

/* ──────────────────────────────────────────────────────────────
   Scroll / IntersectionObserver
────────────────────────────────────────────────────────────── */
function initScroll() {
  const scrollContainer = document.getElementById('scroll-container');
  const dots            = document.querySelectorAll('.progress-nav .dot');
  const sections        = document.querySelectorAll('.story-section');

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const idx = [...sections].indexOf(entry.target);
      state.currentSection = idx;
      dots.forEach((d, i) => d.classList.toggle('active', i === idx));

      if (idx === 1 && !state.chartsInit[1]) { state.chartsInit[1] = true; initTimeSeries(); }
      if (idx === 2 && !state.chartsInit[2]) { state.chartsInit[2] = true; initHeatmap();    }
      if (idx === 3 && !state.chartsInit[3]) { state.chartsInit[3] = true; initDrivers();    }
      if (idx === 4 && !state.chartsInit[4]) { state.chartsInit[4] = true; initImpacts();    }
      if (idx !== 4 && state.impactsPlaying) stopImpactsAnimation();
    });
  }, { root: scrollContainer, threshold: 0.55 });

  sections.forEach(s => observer.observe(s));

  dots.forEach(dot => {
    dot.addEventListener('click', () => {
      const idx = parseInt(dot.dataset.section, 10);
      sections[idx].scrollIntoView({ behavior: 'smooth' });
    });
  });
}

/* ──────────────────────────────────────────────────────────────
   Boot
────────────────────────────────────────────────────────────── */
async function init() {
  try {
    initPhotoLightbox();
    initSourceDetails();
    await loadData();
    processData();
    initMap();
    initScroll();
  } catch (error) {
    console.error('Data loading error:', error);

    const mapStatus = document.getElementById('map-status');
    if (mapStatus) {
      mapStatus.textContent = 'Data loading error. Check CSV filenames and relative paths.';
    }

    const heroText = document.querySelector('.hero-copy p');
    if (heroText) {
      heroText.textContent = error.message;
    }
  }
}

init();

})();
