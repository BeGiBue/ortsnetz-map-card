// Ortsnetz Map Card v1.0.0
const LEAFLET_VERSION = "1.9.4";
const LEAFLET_JS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;
const LEAFLET_CSS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;

const DEFAULT_CONFIG = {
  zoom: 10,
  phase: "auto",
  refresh_interval: 300,
  show_status: true,
};

let leafletPromise;

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;

  leafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }

    const existing = document.querySelector(`script[src="${LEAFLET_JS}"]`);
    if (existing) {
      if (window.L) {
        resolve(window.L);
      } else {
        existing.addEventListener("load", () => resolve(window.L), { once: true });
        existing.addEventListener("error", reject, { once: true });
      }
      return;
    }

    const script = document.createElement("script");
    script.src = LEAFLET_JS;
    script.onload = () => resolve(window.L);
    script.onerror = reject;
    document.head.appendChild(script);
  });

  return leafletPromise;
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

class OrtsnetzMapCard extends HTMLElement {
  constructor() {
    super();
    this._config = { ...DEFAULT_CONFIG };
    this._hass = null;
    this._map = null;
    this._measurementLayer = null;
    this._resizeObserver = null;
    this._refreshTimer = null;
    this._lastThemeDark = null;
    this._currentData = null;
    this._initialized = false;
  }

  setConfig(config) {
    const merged = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    merged.zoom = clamp(merged.zoom, 1, 19, 10);
    merged.refresh_interval = clamp(merged.refresh_interval, 60, 3600, 300);
    merged.phase = ["auto", "L1", "L2", "L3"].includes(String(merged.phase))
      ? String(merged.phase)
      : "auto";
    merged.show_status = merged.show_status !== false;

    this._config = merged;

    if (this._initialized && this.isConnected && this._hass) {
      this._reinitialize();
    }
  }

  set hass(hass) {
    const firstSet = !this._hass;
    this._hass = hass;

    if (firstSet && this.isConnected) {
      this._initialize();
    } else if (this._map) {
      this._applyTheme();
    }
  }

  connectedCallback() {
    if (this._hass) this._initialize();
  }

  disconnectedCallback() {
    this._destroy();
  }

  async _reinitialize() {
    this._destroy(false);
    await this._initialize();
  }

  _destroy(clearMarkup = true) {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._map) {
      this._map.remove();
      this._map = null;
    }
    this._measurementLayer = null;
    this._mapElement = null;
    this._statusElement = null;
    this._initialized = false;
    if (clearMarkup) this.innerHTML = "";
  }


  async _initialize() {
    if (this._initialized || this._map || !this._hass) return;
    this._initialized = true;

    this.innerHTML = `
      <ha-card>
        <style>
          @import url("${LEAFLET_CSS}");
          :host { display:block; width:100%; height:100%; min-height:0; }
          ha-card { display:block; box-sizing:border-box; width:100%; height:100%; min-height:0; }
          .leaflet-container { overflow: hidden; position: relative; outline-offset: 1px; }
          .leaflet-pane, .leaflet-tile, .leaflet-marker-icon, .leaflet-marker-shadow, .leaflet-tile-container, .leaflet-pane > svg, .leaflet-pane > canvas, .leaflet-zoom-box, .leaflet-image-layer, .leaflet-layer { position: absolute; left: 0; top: 0; }
          .leaflet-container { -webkit-tap-highlight-color: transparent; }
          .leaflet-tile, .leaflet-marker-icon, .leaflet-marker-shadow { -webkit-user-select: none; -moz-user-select: none; user-select: none; -webkit-user-drag: none; }
          .leaflet-tile::selection { background: transparent; }
          .leaflet-safari .leaflet-tile { image-rendering: -webkit-optimize-contrast; }
          .leaflet-safari .leaflet-tile-container { width: 1600px; height: 1600px; -webkit-transform-origin: 0 0; }
          .leaflet-marker-icon, .leaflet-marker-shadow { display: block; }
          .leaflet-container .leaflet-overlay-pane svg { max-width: none !important; max-height: none !important; }
          .leaflet-container .leaflet-marker-pane img, .leaflet-container .leaflet-shadow-pane img, .leaflet-container .leaflet-tile-pane img, .leaflet-container img.leaflet-image-layer, .leaflet-container .leaflet-tile { max-width: none !important; max-height: none !important; width: auto; padding: 0; }
          .leaflet-container.leaflet-touch-zoom { touch-action: pan-x pan-y; }
          .leaflet-container.leaflet-touch-drag { touch-action: none; touch-action: pinch-zoom; }
          .leaflet-container.leaflet-touch-drag.leaflet-touch-zoom { touch-action: none; }
          .leaflet-control-container .leaflet-top, .leaflet-control-container .leaflet-bottom { position: absolute; z-index: 1000; pointer-events: none; }
          .leaflet-control-container .leaflet-top { top: 0; }
          .leaflet-control-container .leaflet-right { right: 0; }
          .leaflet-control-container .leaflet-bottom { bottom: 0; }
          .leaflet-control-container .leaflet-left { left: 0; }
          .leaflet-control { position: relative; z-index: 800; pointer-events: auto; float: left; clear: both; }
          .leaflet-right .leaflet-control { float: right; }
          .leaflet-top .leaflet-control { margin-top: 10px; }
          .leaflet-bottom .leaflet-control { margin-bottom: 10px; }
          .leaflet-left .leaflet-control { margin-left: 10px; }
          .leaflet-right .leaflet-control { margin-right: 10px; }
          .leaflet-zoom-animated { transform-origin: 0 0; }
          .leaflet-zoom-box { width: 0; height: 0; box-sizing: border-box; z-index: 800; }
          .leaflet-pane { z-index: 400; }
          .leaflet-tile-pane { z-index: 200; }
          .leaflet-overlay-pane { z-index: 400; }
          .leaflet-shadow-pane { z-index: 500; }
          .leaflet-marker-pane { z-index: 600; }
          .leaflet-tooltip-pane { z-index: 650; }
          .leaflet-popup-pane { z-index: 700; }
          .leaflet-map-pane canvas { z-index: 100; }
          .leaflet-map-pane svg { z-index: 200; }
          .ortsnetz-wrap { position:relative; overflow:hidden; border-radius:var(--ha-card-border-radius, 12px); width:100%; height:100%; min-height:168px; }
          .ortsnetz-map { width:100%; height:100%; min-height:168px; background:var(--primary-background-color); }
          .ortsnetz-map.dark .leaflet-tile-pane { filter: brightness(.65) invert(1) contrast(1.15) hue-rotate(180deg) saturate(.65); }
          .ortsnetz-map.dark .leaflet-overlay-pane, .ortsnetz-map.dark .leaflet-marker-pane, .ortsnetz-map.dark .leaflet-popup-pane, .ortsnetz-map.dark .leaflet-shadow-pane { filter: none; }
          .ortsnetz-status { position: absolute; z-index: 1000; left: 10px; bottom: 24px; padding: 6px 9px; border-radius: 7px; font-size: 11px; background: color-mix(in srgb, var(--card-background-color) 92%, transparent); color: var(--primary-text-color); box-shadow: 0 1px 4px rgba(0,0,0,.2); pointer-events: none; }
          .ortsnetz-status[hidden] { display: none; }
          .leaflet-popup-content-wrapper, .leaflet-popup-tip { background: var(--card-background-color); color: var(--primary-text-color); }
          .leaflet-control-attribution { font-size: 9px; }
          .ortsnetz-map.dark .leaflet-control-zoom a { background:var(--card-background-color); color:var(--primary-text-color); border-color:var(--divider-color); }
          .ortsnetz-map.dark .leaflet-control-attribution { background:color-mix(in srgb, var(--card-background-color) 88%, transparent); color:var(--secondary-text-color); }
          .ortsnetz-map.dark .leaflet-control-attribution a { color:var(--primary-color); }
          .popup-title { font-size: 15px; font-weight: 700; margin-bottom: 8px; }
          .popup-value { font-weight: 600; }
          .popup-time { margin-top: 8px; font-size: 11px; opacity: .7; }
          .popup-warning { margin-top: 8px; font-size: 12px; }
        </style>
        <div class="ortsnetz-wrap">
          <div class="ortsnetz-map"></div>
          <div class="ortsnetz-status" ${this._config.show_status ? "" : "hidden"}>Lade Messwerte …</div>
        </div>
      </ha-card>`;

    this._mapElement = this.querySelector(".ortsnetz-map");
    this._statusElement = this.querySelector(".ortsnetz-status");

    try {
      const L = await loadLeaflet();
      const latitude = Number(this._config.latitude ?? this._hass.config.latitude);
      const longitude = Number(this._config.longitude ?? this._hass.config.longitude);

      this._map = L.map(this._mapElement, {
        zoomControl: true,
        attributionControl: true,
      }).setView([latitude, longitude], Number(this._config.zoom));

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(this._map);

      this._measurementLayer = L.layerGroup().addTo(this._map);
      this._applyTheme();
      await this._loadMeasurements();

      const refreshSeconds = Math.max(60, Number(this._config.refresh_interval) || 300);
      this._refreshTimer = setInterval(() => this._loadMeasurements(), refreshSeconds * 1000);

      this._resizeObserver = new ResizeObserver(() => this._map?.invalidateSize());
      this._resizeObserver.observe(this._mapElement);
      setTimeout(() => this._map?.invalidateSize(), 250);
    } catch (error) {
      this._setStatus(`Fehler: ${error.message || error}`);
      console.error("Ortsnetz Map initialization failed", error);
    }
  }

  _isDarkTheme() {
    // Primary source: Home Assistant's currently active theme state.
    // This follows per-user/per-dashboard theme changes immediately.
    if (typeof this._hass?.themes?.darkMode === "boolean") {
      return this._hass.themes.darkMode;
    }

    // Fallback for HA versions/themes that do not expose darkMode.
    const hostStyles = getComputedStyle(this);
    const bg = (
      hostStyles.getPropertyValue("--primary-background-color") ||
      getComputedStyle(document.documentElement).getPropertyValue("--primary-background-color")
    ).trim();

    const rgb = bg.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    if (rgb) {
      const brightness = (Number(rgb[1]) * 299 + Number(rgb[2]) * 587 + Number(rgb[3]) * 114) / 1000;
      return brightness < 128;
    }

    if (bg.startsWith("#")) {
      let hex = bg.slice(1);
      if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
      if (hex.length === 6) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return (r * 299 + g * 587 + b * 114) / 1000 < 128;
      }
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  _applyTheme() {
    if (!this._mapElement) return;
    const dark = this._isDarkTheme();
    if (dark !== this._lastThemeDark) {
      this._mapElement.classList.toggle("dark", dark);
      this._lastThemeDark = dark;
    }
  }

  async _loadMeasurements() {
    if (!this._hass?.connection) return;
    this._setStatus("Lade Messwerte …");

    try {
      const data = await this._hass.connection.sendMessagePromise({
        type: "ortsnetz_map/get_points",
      });
      this._currentData = data;
      this._renderPoints(data);
      const time = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
      this._setStatus(`${data.points?.length ?? 0} Messpunkte · ${time}`);
    } catch (error) {
      console.error("Could not load Ortsnetz points", error);
      this._setStatus("Backend nicht erreichbar – Integration prüfen");
    }
  }

  _renderPoints(data) {
    if (!this._measurementLayer || !window.L || !Array.isArray(data?.points)) return;
    this._measurementLayer.clearLayers();

    const scale = data.scale || {
      criticalLow: 207,
      warningLow: 218,
      warningHigh: 242,
      criticalHigh: 253,
      colors: ["#1d4ed8", "#38bdf8", "#16a34a", "#f59e0b", "#b91c1c"],
    };

    const phase = this._config.phase === "auto" ? (data.phase || "L1") : String(this._config.phase).toUpperCase();

    for (const point of data.points) {
      if (point.latitude == null || point.longitude == null) continue;
      const voltage = phase === "L2" ? point.l2_v : phase === "L3" ? point.l3_v : point.l1_v;
      const color = this._voltageColor(voltage, scale);

      const marker = window.L.circleMarker([Number(point.latitude), Number(point.longitude)], {
        radius: 6,
        color,
        weight: 2,
        opacity: point.stale ? 0.55 : 1,
        fillColor: color,
        fillOpacity: point.stale ? 0.30 : 0.85,
      });

      marker.bindPopup(`
        <div>
          <div class="popup-title">Ortsnetz-Messpunkt</div>
          L1: <span class="popup-value">${this._fmtV(point.l1_v)}</span><br>
          L2: <span class="popup-value">${this._fmtV(point.l2_v)}</span><br>
          L3: <span class="popup-value">${this._fmtV(point.l3_v)}</span><br><br>
          Frequenz: <span class="popup-value">${point.grid_frequency_hz != null ? Number(point.grid_frequency_hz).toFixed(2) + " Hz" : "–"}</span><br>
          Messungen: <span class="popup-value">${point.sample_count ?? "–"}</span>
          ${point.stale ? '<div class="popup-warning">⚠️ Messwert möglicherweise veraltet</div>' : ""}
          <div class="popup-time">Letzte Messung: ${this._formatDate(point.observed_at)}</div>
        </div>`);

      marker.addTo(this._measurementLayer);
    }
  }

  _voltageColor(value, scale) {
    if (value == null) return "#888888";
    if (value < scale.criticalLow) return scale.colors[0];
    if (value < scale.warningLow) return scale.colors[1];
    if (value <= scale.warningHigh) return scale.colors[2];
    if (value <= scale.criticalHigh) return scale.colors[3];
    return scale.colors[4];
  }

  _fmtV(value) {
    return value != null ? `${Number(value).toFixed(1)} V` : "–";
  }

  _formatDate(value) {
    if (!value) return "unbekannt";
    return new Date(value).toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  _setStatus(text) {
    if (this._statusElement) this._statusElement.textContent = text;
  }

  getCardSize() {
    // Only used by masonry views. In Sections views, size comes entirely
    // from Home Assistant's Layout controls via getGridOptions().
    return 6;
  }

  getGridOptions() {
    return {
      columns: 12,
      rows: 8,
      min_columns: 3,
      min_rows: 3,
      // Intentionally no max_columns: Home Assistant can offer the native
      // "Full" width option in Sections layout.
    };
  }

  static getConfigElement() {
    return document.createElement("ortsnetz-map-card-editor");
  }

  static getStubConfig() {
    return {
      zoom: 10,
      phase: "auto",
      refresh_interval: 300,
      show_status: true,
    };
  }
}

class OrtsnetzMapCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = { ...DEFAULT_CONFIG };
    this._hass = null;
  }

  set hass(hass) {
    this._hass = hass;
    if (this.shadowRoot) this._render();
  }

  setConfig(config) {
    this._config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
    this._render();
  }

  _usesHaLocation() {
    return this._config.latitude == null || this._config.longitude == null;
  }

  _render() {
    if (!this.shadowRoot) return;
    const useHaLocation = this._usesHaLocation();
    const lat = useHaLocation ? (this._hass?.config?.latitude ?? "") : this._config.latitude;
    const lon = useHaLocation ? (this._hass?.config?.longitude ?? "") : this._config.longitude;

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; color:var(--primary-text-color); }
        .editor { display:grid; gap:16px; padding:8px 0; }
        .section { display:grid; gap:12px; }
        .section-title { font-size:14px; font-weight:600; color:var(--primary-text-color); }
        .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
        label.field { display:grid; gap:6px; font-size:12px; color:var(--secondary-text-color); }
        input, select {
          box-sizing:border-box; width:100%; min-height:44px; padding:9px 12px;
          border:1px solid var(--divider-color); border-radius:8px;
          background:var(--card-background-color); color:var(--primary-text-color);
          font:inherit; font-size:14px;
        }
        input:focus, select:focus { outline:2px solid var(--primary-color); outline-offset:1px; }
        .check { display:flex; align-items:center; gap:10px; min-height:36px; font-size:14px; }
        .check input { width:20px; height:20px; min-height:0; }
        .hint { font-size:12px; line-height:1.4; color:var(--secondary-text-color); }
        .coords[hidden] { display:none; }
        .value-row { display:flex; gap:8px; align-items:center; }
        .value-row input { flex:1; }
        .unit { min-width:28px; color:var(--secondary-text-color); font-size:13px; }
        @media (max-width:520px) { .grid { grid-template-columns:1fr; } }
      </style>

      <div class="editor">
        <div class="section">
          <div class="section-title">Darstellung</div>
          <div class="grid">
            <label class="field">
              Zoom
              <input data-key="zoom" type="number" min="1" max="19" step="1" value="${this._config.zoom}">
            </label>
            <label class="field">
              Phase für Markerfarbe
              <select data-key="phase">
                <option value="auto" ${this._config.phase === "auto" ? "selected" : ""}>Automatisch</option>
                <option value="L1" ${this._config.phase === "L1" ? "selected" : ""}>L1</option>
                <option value="L2" ${this._config.phase === "L2" ? "selected" : ""}>L2</option>
                <option value="L3" ${this._config.phase === "L3" ? "selected" : ""}>L3</option>
              </select>
            </label>
            <label class="field">
              Aktualisierung
              <div class="value-row"><input data-key="refresh_interval" type="number" min="60" max="3600" step="60" value="${this._config.refresh_interval}"><span class="unit">s</span></div>
            </label>
          </div>
          <label class="check"><input data-key="show_status" type="checkbox" ${this._config.show_status !== false ? "checked" : ""}>Status unten links anzeigen</label>
          <div class="hint">Breite und Höhe werden ausschließlich über Home Assistants Tab „Layout“ eingestellt. Die Karte füllt den dort zugewiesenen Bereich automatisch vollständig aus.</div>
        </div>

        <div class="section">
          <div class="section-title">Kartenmittelpunkt</div>
          <label class="check"><input data-key="use_ha_location" type="checkbox" ${useHaLocation ? "checked" : ""}>Home-Assistant-Standort verwenden</label>
          <div class="grid coords" ${useHaLocation ? "hidden" : ""}>
            <label class="field">Breitengrad<input data-key="latitude" type="number" min="-90" max="90" step="0.000001" value="${lat}"></label>
            <label class="field">Längengrad<input data-key="longitude" type="number" min="-180" max="180" step="0.000001" value="${lon}"></label>
          </div>
          <div class="hint">Wenn aktiviert, folgt die Karte automatisch dem unter Einstellungen → System → Allgemein hinterlegten Home-Assistant-Standort.</div>
        </div>
      </div>`;

    this.shadowRoot.querySelectorAll("input, select").forEach((element) => {
      element.addEventListener("change", (event) => this._valueChanged(event));
    });
  }

  _valueChanged(event) {
    const target = event.currentTarget;
    const key = target.dataset.key;
    if (!key) return;

    const next = { ...this._config };

    if (key === "use_ha_location") {
      if (target.checked) {
        delete next.latitude;
        delete next.longitude;
      } else {
        next.latitude = Number(this._hass?.config?.latitude ?? 0);
        next.longitude = Number(this._hass?.config?.longitude ?? 0);
      }
    } else if (key === "show_status") {
      next.show_status = target.checked;
    } else if (["zoom", "refresh_interval", "latitude", "longitude"].includes(key)) {
      next[key] = Number(target.value);
    } else {
      next[key] = target.value;
    }

    this._config = next;
    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config: next },
      bubbles: true,
      composed: true,
    }));

    if (key === "use_ha_location") this._render();
  }
}

if (!customElements.get("ortsnetz-map-card-editor")) {
  customElements.define("ortsnetz-map-card-editor", OrtsnetzMapCardEditor);
}

if (!customElements.get("ortsnetz-map-card")) {
  customElements.define("ortsnetz-map-card", OrtsnetzMapCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "ortsnetz-map-card")) {
  window.customCards.push({
    type: "ortsnetz-map-card",
    name: "Ortsnetz Map",
    description: "Zeigt Messpunkte von ortsnetz-auslastung.de rund um den Home-Assistant-Standort.",
    preview: false,
  });
}
