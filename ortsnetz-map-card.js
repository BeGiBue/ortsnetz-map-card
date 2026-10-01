// Ortsnetz Map Card v1.0.1
const MAPLIBRE_VERSION = "5.7.1";
const MAPLIBRE_JS = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`;
const MAPLIBRE_CSS = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`;
const OPENFREEMAP_LIGHT_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const OPENFREEMAP_DARK_STYLE = "https://tiles.openfreemap.org/styles/dark";

const DEFAULT_CONFIG = {
  zoom: 10,
  phase: "auto",
  refresh_interval: 300,
  show_status: true,
};

let mapLibrePromise;

function loadMapLibre() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (mapLibrePromise) return mapLibrePromise;

  mapLibrePromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${MAPLIBRE_CSS}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = MAPLIBRE_CSS;
      document.head.appendChild(link);
    }

    const existing = document.querySelector(`script[src="${MAPLIBRE_JS}"]`);
    if (existing) {
      if (window.maplibregl) {
        resolve(window.maplibregl);
      } else {
        existing.addEventListener("load", () => resolve(window.maplibregl), { once: true });
        existing.addEventListener("error", reject, { once: true });
      }
      return;
    }

    const script = document.createElement("script");
    script.src = MAPLIBRE_JS;
    script.onload = () => resolve(window.maplibregl);
    script.onerror = reject;
    document.head.appendChild(script);
  });

  return mapLibrePromise;
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
    this._resizeObserver = null;
    this._refreshTimer = null;
    this._lastThemeDark = null;
    this._currentData = null;
    this._initialized = false;
    this._popup = null;
    this._mapLoaded = false;
  }

  setConfig(config) {
    const merged = { ...DEFAULT_CONFIG, ...config };
    merged.zoom = clamp(merged.zoom, 1, 19, 10);
    merged.refresh_interval = clamp(merged.refresh_interval, 60, 3600, 300);
    merged.phase = ["auto", "L1", "L2", "L3"].includes(String(merged.phase))
      ? String(merged.phase)
      : "auto";
    merged.show_status = merged.show_status !== false;
    this._config = merged;

    if (this._initialized && this.isConnected && this._hass) this._reinitialize();
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
    if (this._popup) {
      this._popup.remove();
      this._popup = null;
    }
    if (this._map) {
      this._map.remove();
      this._map = null;
    }
    this._mapElement = null;
    this._statusElement = null;
    this._initialized = false;
    this._mapLoaded = false;
    this._lastThemeDark = null;
    if (clearMarkup) this.innerHTML = "";
  }

  async _initialize() {
    if (this._initialized || this._map || !this._hass) return;
    this._initialized = true;

    this.innerHTML = `
      <ha-card>
        <style>
          @import url("${MAPLIBRE_CSS}");
          :host { display:block; width:100%; height:100%; min-height:0; }
          ha-card { display:block; box-sizing:border-box; width:100%; height:100%; min-height:0; overflow:hidden; }
          .ortsnetz-wrap { position:relative; overflow:hidden; border-radius:var(--ha-card-border-radius, 12px); width:100%; height:100%; min-height:168px; }
          .ortsnetz-map { width:100%; height:100%; min-height:168px; background:var(--primary-background-color); }
          .ortsnetz-status { position:absolute; z-index:5; left:10px; bottom:28px; padding:6px 9px; border-radius:7px; font-size:11px; background:color-mix(in srgb, var(--card-background-color) 92%, transparent); color:var(--primary-text-color); box-shadow:0 1px 4px rgba(0,0,0,.2); pointer-events:none; }
          .ortsnetz-status[hidden] { display:none; }
          .maplibregl-popup-content { background:var(--card-background-color); color:var(--primary-text-color); border-radius:10px; box-shadow:0 2px 10px rgba(0,0,0,.25); }
          .maplibregl-popup-anchor-bottom .maplibregl-popup-tip { border-top-color:var(--card-background-color); }
          .maplibregl-popup-anchor-top .maplibregl-popup-tip { border-bottom-color:var(--card-background-color); }
          .maplibregl-popup-anchor-left .maplibregl-popup-tip { border-right-color:var(--card-background-color); }
          .maplibregl-popup-anchor-right .maplibregl-popup-tip { border-left-color:var(--card-background-color); }
          .maplibregl-popup-close-button { color:var(--primary-text-color); font-size:18px; }
          .maplibregl-ctrl-group { background:var(--card-background-color); }
          .maplibregl-ctrl-group button { color:var(--primary-text-color); }
          .maplibregl-ctrl-attrib { background:color-mix(in srgb, var(--card-background-color) 88%, transparent) !important; color:var(--secondary-text-color); font-size:9px; }
          .maplibregl-ctrl-attrib a { color:var(--primary-color); }
          .popup-title { font-size:15px; font-weight:700; margin-bottom:8px; }
          .popup-value { font-weight:600; }
          .popup-time { margin-top:8px; font-size:11px; opacity:.7; }
          .popup-warning { margin-top:8px; font-size:12px; }
        </style>
        <div class="ortsnetz-wrap">
          <div class="ortsnetz-map"></div>
          <div class="ortsnetz-status" ${this._config.show_status ? "" : "hidden"}>Lade Messwerte …</div>
        </div>
      </ha-card>`;

    this._mapElement = this.querySelector(".ortsnetz-map");
    this._statusElement = this.querySelector(".ortsnetz-status");

    try {
      const maplibregl = await loadMapLibre();
      const latitude = Number(this._config.latitude ?? this._hass.config.latitude);
      const longitude = Number(this._config.longitude ?? this._hass.config.longitude);
      const dark = this._isDarkTheme();
      this._lastThemeDark = dark;

      this._map = new maplibregl.Map({
        container: this._mapElement,
        style: dark ? OPENFREEMAP_DARK_STYLE : OPENFREEMAP_LIGHT_STYLE,
        center: [longitude, latitude],
        zoom: Number(this._config.zoom),
        attributionControl: true,
      });

      this._map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");

      this._map.on("load", async () => {
        this._mapLoaded = true;
        this._installPointInteractions(maplibregl);
        await this._loadMeasurements();
      });

      this._map.on("style.load", () => {
        if (!this._mapLoaded) return;
        this._renderPoints(this._currentData);
      });

      const refreshSeconds = Math.max(60, Number(this._config.refresh_interval) || 300);
      this._refreshTimer = setInterval(() => this._loadMeasurements(), refreshSeconds * 1000);

      this._resizeObserver = new ResizeObserver(() => this._map?.resize());
      this._resizeObserver.observe(this._mapElement);
      setTimeout(() => this._map?.resize(), 250);
    } catch (error) {
      this._setStatus(`Fehler: ${error.message || error}`);
      console.error("Ortsnetz Map initialization failed", error);
    }
  }

  _installPointInteractions(maplibregl) {
    this._map.on("mouseenter", "ortsnetz-points", () => {
      this._map.getCanvas().style.cursor = "pointer";
    });
    this._map.on("mouseleave", "ortsnetz-points", () => {
      this._map.getCanvas().style.cursor = "";
    });
    this._map.on("click", "ortsnetz-points", (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      const p = feature.properties || {};
      if (this._popup) this._popup.remove();
      this._popup = new maplibregl.Popup({ closeButton: true, maxWidth: "320px" })
        .setLngLat(feature.geometry.coordinates)
        .setHTML(`
          <div>
            <div class="popup-title">Ortsnetz-Messpunkt</div>
            L1: <span class="popup-value">${this._fmtV(p.l1_v)}</span><br>
            L2: <span class="popup-value">${this._fmtV(p.l2_v)}</span><br>
            L3: <span class="popup-value">${this._fmtV(p.l3_v)}</span><br><br>
            Frequenz: <span class="popup-value">${p.grid_frequency_hz !== "" ? Number(p.grid_frequency_hz).toFixed(2) + " Hz" : "–"}</span><br>
            Messungen: <span class="popup-value">${p.sample_count || "–"}</span>
            ${p.stale === true || p.stale === "true" ? '<div class="popup-warning">⚠️ Messwert möglicherweise veraltet</div>' : ""}
            <div class="popup-time">Letzte Messung: ${this._formatDate(p.observed_at)}</div>
          </div>`)
        .addTo(this._map);
    });
  }

  _isDarkTheme() {
    if (typeof this._hass?.themes?.darkMode === "boolean") return this._hass.themes.darkMode;

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
    if (!this._map) return;
    const dark = this._isDarkTheme();
    if (dark === this._lastThemeDark) return;
    this._lastThemeDark = dark;
    this._map.setStyle(dark ? OPENFREEMAP_DARK_STYLE : OPENFREEMAP_LIGHT_STYLE);
  }

  async _loadMeasurements() {
    if (!this._hass?.connection) return;
    this._setStatus("Lade Messwerte …");

    try {
      const data = await this._hass.connection.sendMessagePromise({ type: "ortsnetz_map/get_points" });
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
    if (!this._map || !this._mapLoaded || !Array.isArray(data?.points)) return;
    if (!this._map.isStyleLoaded()) return;

    const scale = data.scale || {
      criticalLow: 207,
      warningLow: 218,
      warningHigh: 242,
      criticalHigh: 253,
      colors: ["#1d4ed8", "#38bdf8", "#16a34a", "#f59e0b", "#b91c1c"],
    };
    const phase = this._config.phase === "auto" ? (data.phase || "L1") : String(this._config.phase).toUpperCase();

    const features = data.points
      .filter((point) => point.latitude != null && point.longitude != null)
      .map((point) => {
        const voltage = phase === "L2" ? point.l2_v : phase === "L3" ? point.l3_v : point.l1_v;
        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: [Number(point.longitude), Number(point.latitude)] },
          properties: {
            color: this._voltageColor(voltage, scale),
            stale: Boolean(point.stale),
            l1_v: point.l1_v ?? "",
            l2_v: point.l2_v ?? "",
            l3_v: point.l3_v ?? "",
            grid_frequency_hz: point.grid_frequency_hz ?? "",
            sample_count: point.sample_count ?? "",
            observed_at: point.observed_at ?? "",
          },
        };
      });

    const geojson = { type: "FeatureCollection", features };
    const existingSource = this._map.getSource("ortsnetz-points");
    if (existingSource) {
      existingSource.setData(geojson);
      return;
    }

    this._map.addSource("ortsnetz-points", { type: "geojson", data: geojson });
    this._map.addLayer({
      id: "ortsnetz-points",
      type: "circle",
      source: "ortsnetz-points",
      paint: {
        "circle-radius": 6,
        "circle-color": ["get", "color"],
        "circle-stroke-color": ["get", "color"],
        "circle-stroke-width": 2,
        "circle-opacity": ["case", ["==", ["get", "stale"], true], 0.30, 0.85],
        "circle-stroke-opacity": ["case", ["==", ["get", "stale"], true], 0.55, 1],
      },
    });
  }

  _voltageColor(value, scale) {
    if (value == null || value === "") return "#888888";
    if (value < scale.criticalLow) return scale.colors[0];
    if (value < scale.warningLow) return scale.colors[1];
    if (value <= scale.warningHigh) return scale.colors[2];
    if (value <= scale.criticalHigh) return scale.colors[3];
    return scale.colors[4];
  }

  _fmtV(value) {
    return value !== "" && value != null ? `${Number(value).toFixed(1)} V` : "–";
  }

  _formatDate(value) {
    if (!value) return "unbekannt";
    return new Date(value).toLocaleString("de-DE", {
      day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  }

  _setStatus(text) {
    if (this._statusElement) this._statusElement.textContent = text;
  }

  getCardSize() { return 6; }

  getGridOptions() {
    return {
      columns: 12,
      rows: 8,
      min_columns: 3,
      min_rows: 3,
    };
  }

  static getConfigElement() { return document.createElement("ortsnetz-map-card-editor"); }

  static getStubConfig() {
    return { zoom: 10, phase: "auto", refresh_interval: 300, show_status: true };
  }
}

class OrtsnetzMapCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = { ...DEFAULT_CONFIG };
    this._hass = null;
  }

  set hass(hass) { this._hass = hass; if (this.shadowRoot) this._render(); }
  setConfig(config) { this._config = { ...DEFAULT_CONFIG, ...config }; this._render(); }
  _usesHaLocation() { return this._config.latitude == null || this._config.longitude == null; }

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
        input, select { box-sizing:border-box; width:100%; min-height:44px; padding:9px 12px; border:1px solid var(--divider-color); border-radius:8px; background:var(--card-background-color); color:var(--primary-text-color); font:inherit; font-size:14px; }
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
            <label class="field">Zoom<input data-key="zoom" type="number" min="1" max="19" step="1" value="${this._config.zoom}"></label>
            <label class="field">Phase für Markerfarbe<select data-key="phase">
              <option value="auto" ${this._config.phase === "auto" ? "selected" : ""}>Automatisch</option>
              <option value="L1" ${this._config.phase === "L1" ? "selected" : ""}>L1</option>
              <option value="L2" ${this._config.phase === "L2" ? "selected" : ""}>L2</option>
              <option value="L3" ${this._config.phase === "L3" ? "selected" : ""}>L3</option>
            </select></label>
            <label class="field">Aktualisierung<div class="value-row"><input data-key="refresh_interval" type="number" min="60" max="3600" step="60" value="${this._config.refresh_interval}"><span class="unit">s</span></div></label>
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
      detail: { config: next }, bubbles: true, composed: true,
    }));
    if (key === "use_ha_location") this._render();
  }
}

if (!customElements.get("ortsnetz-map-card-editor")) customElements.define("ortsnetz-map-card-editor", OrtsnetzMapCardEditor);
if (!customElements.get("ortsnetz-map-card")) customElements.define("ortsnetz-map-card", OrtsnetzMapCard);

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "ortsnetz-map-card")) {
  window.customCards.push({
    type: "ortsnetz-map-card",
    name: "Ortsnetz Map",
    description: "Zeigt Messpunkte von ortsnetz-auslastung.de rund um den Home-Assistant-Standort.",
    preview: false,
  });
}
