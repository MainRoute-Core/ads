/**
 * MainRoute Ads Engine v1.0.0
 * Lightweight, zero-dependency, self-hosted client-side ad server.
 * https://MainRoute-Core.github.io/ads/
 */
(function () {
  "use strict";

  // Prevent double-injection collision while allowing shared singletons
  const GLOBAL_NAMESPACE = "__MR_ADS_ENGINE__";
  window[GLOBAL_NAMESPACE] = window[GLOBAL_NAMESPACE] || {
    dbPromise: null,
    instances: new Set(),
    debug: false
  };

  const runtime = window[GLOBAL_NAMESPACE];

  /**
   * Safe Logger
   */
  const log = {
    info: (...args) => runtime.debug && console.info("[MainRoute Ads]", ...args),
    warn: (...args) => console.warn("[MainRoute Ads]", ...args),
    error: (...args) => console.error("[MainRoute Ads]", ...args)
  };

  /**
   * Security & Utility Helpers
   */
  const Security = {
    ALLOWED_PROTOCOLS: ["https:", "http:"],

    sanitizeUrl(rawUrl) {
      if (!rawUrl || typeof rawUrl !== "string") return null;
      try {
        const parsed = new URL(rawUrl, window.location.href);
        if (this.ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
          return parsed.href;
        }
      } catch (_) {
        // Fallback for invalid absolute/relative URLs
      }
      return null;
    },

    resolveAssetUrl(path, dbBaseUrl) {
      if (!path || typeof path !== "string") return "";
      if (path.startsWith("http://") || path.startsWith("https://")) {
        return this.sanitizeUrl(path) || "";
      }
      try {
        const resolved = new URL(path, dbBaseUrl);
        return this.sanitizeUrl(resolved.href) || "";
      } catch (_) {
        return "";
      }
    }
  };

  /**
   * Client-side Frequency & Impression Storage (Rolling 24-Hour window)
   */
  const FrequencyManager = {
    STORAGE_KEY: "mr_ads_impressions",
    ROLLING_WINDOW_MS: 24 * 60 * 60 * 1000,

    getStore() {
      try {
        const data = localStorage.getItem(this.STORAGE_KEY);
        return data ? JSON.parse(data) : {};
      } catch (err) {
        log.warn("LocalStorage inaccessible for frequency tracking.", err);
        return {};
      }
    },

    saveStore(store) {
      try {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(store));
      } catch (err) {
        log.warn("Failed to write to LocalStorage.", err);
      }
    },

    isAllowed(adId, maxTimes) {
      if (!maxTimes || maxTimes <= 0) return true;
      const store = this.getStore();
      const now = Date.now();
      const timestamps = store[adId]?.timestamps || [];
      const validTimestamps = timestamps.filter(ts => (now - ts) < this.ROLLING_WINDOW_MS);
      return validTimestamps.length < maxTimes;
    },

    record(adId) {
      if (!adId) return;
      const store = this.getStore();
      const now = Date.now();
      const current = store[adId]?.timestamps || [];
      const validTimestamps = current.filter(ts => (now - ts) < this.ROLLING_WINDOW_MS);
      validTimestamps.push(now);
      store[adId] = { timestamps: validTimestamps };
      this.saveStore(store);
    }
  };

  /**
   * Database Loader with Single-Flight Promise Sharing
   */
  function fetchDatabase(dbUrl) {
    if (!runtime.dbPromise) {
      const fetchUrl = new URL(dbUrl);
      fetchUrl.searchParams.set("v", Date.now().toString());

      runtime.dbPromise = fetch(fetchUrl.href, { cache: "no-store" })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
          return res.json();
        })
        .then((json) => {
          if (!json || typeof json !== "object" || !json.settings) {
            throw new Error("Invalid adsdb.json structure");
          }
          return json;
        })
        .catch((err) => {
          log.error("Unable to load ad database:", err.message);
          runtime.dbPromise = null; // Allow retry on subsequent execution if needed
          return null;
        });
    }
    return runtime.dbPromise;
  }

  /**
   * Inject Essential Namespaced CSS Once
   */
  function injectStyles() {
    const STYLE_ID = "mr-ads-core-styles";
    if (document.getElementById(STYLE_ID)) return;

    const css = `
      .mr-ads-slot {
        display: block;
        width: 100%;
        box-sizing: border-box;
        margin: 10px 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        line-height: 1.4;
      }
      .mr-ads-container {
        display: flex;
        overflow: hidden;
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        color: #1a202c;
        text-decoration: none;
        box-sizing: border-box;
        transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
      }
      .mr-ads-container:hover {
        border-color: #cbd5e1;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
        transform: translateY(-1px);
      }
      .mr-ads-container:focus-visible {
        outline: 2px solid #2563eb;
        outline-offset: 2px;
      }

      /* Format: Default */
      .mr-ads-default {
        padding: 12px 14px;
        align-items: center;
        gap: 12px;
      }
      .mr-ads-default .mr-ads-logo {
        width: 44px;
        height: 44px;
        border-radius: 6px;
        object-fit: cover;
        flex-shrink: 0;
        background: #f1f5f9;
      }
      .mr-ads-default .mr-ads-content {
        flex: 1 1 auto;
        min-width: 0;
      }
      .mr-ads-default .mr-ads-name {
        font-size: 14px;
        font-weight: 600;
        color: #0f172a;
        margin: 0 0 2px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .mr-ads-default .mr-ads-desc {
        font-size: 12px;
        color: #64748b;
        margin: 0;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .mr-ads-default .mr-ads-cta {
        font-size: 12px;
        font-weight: 600;
        color: #2563eb;
        white-space: nowrap;
        padding-left: 8px;
      }

      /* Format: Banner (6:1 Aspect Ratio) */
      .mr-ads-banner {
        position: relative;
        width: 100%;
        aspect-ratio: 6 / 1;
        background: #0f172a;
        align-items: center;
        justify-content: center;
      }
      .mr-ads-banner img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      /* Format: Card */
      .mr-ads-card {
        flex-direction: column;
        width: 100%;
        max-width: 340px;
      }
      .mr-ads-card .mr-ads-banner-wrap {
        width: 100%;
        aspect-ratio: 6 / 1;
        background: #f1f5f9;
        overflow: hidden;
      }
      .mr-ads-card .mr-ads-banner-wrap img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .mr-ads-card .mr-ads-card-body {
        padding: 14px;
        display: flex;
        gap: 12px;
        align-items: flex-start;
      }
      .mr-ads-card .mr-ads-logo {
        width: 40px;
        height: 40px;
        border-radius: 6px;
        object-fit: cover;
        flex-shrink: 0;
      }
      .mr-ads-card .mr-ads-content {
        flex: 1 1 auto;
      }
      .mr-ads-card .mr-ads-name {
        font-size: 15px;
        font-weight: 600;
        color: #0f172a;
        margin: 0 0 4px;
      }
      .mr-ads-card .mr-ads-desc {
        font-size: 13px;
        color: #64748b;
        margin: 0;
      }

      /* Format: Compact (Sidebars / Toolbars) */
      .mr-ads-compact {
        padding: 6px 10px;
        align-items: center;
        gap: 8px;
      }
      .mr-ads-compact .mr-ads-logo {
        width: 24px;
        height: 24px;
        border-radius: 4px;
        object-fit: cover;
        flex-shrink: 0;
      }
      .mr-ads-compact .mr-ads-name {
        font-size: 12px;
        font-weight: 600;
        color: #0f172a;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* Format: Both (Banner on top, standard info below) */
      .mr-ads-both {
        flex-direction: column;
      }
      .mr-ads-both .mr-ads-banner-wrap {
        width: 100%;
        aspect-ratio: 6 / 1;
        overflow: hidden;
      }
      .mr-ads-both .mr-ads-banner-wrap img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .mr-ads-both .mr-ads-bottom {
        padding: 10px 14px;
        display: flex;
        align-items: center;
        gap: 10px;
      }

      /* Native Ad Badge */
      .mr-ads-badge {
        position: absolute;
        top: 4px;
        right: 4px;
        background: rgba(15, 23, 42, 0.7);
        color: #ffffff;
        font-size: 9px;
        font-weight: 700;
        text-transform: uppercase;
        padding: 2px 4px;
        border-radius: 3px;
        pointer-events: none;
        letter-spacing: 0.5px;
      }
    `;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  /**
   * Ad Unit Instance Class
   */
  class MainRouteAdUnit {
    constructor(scriptEl) {
      this.scriptEl = scriptEl;
      this.app = scriptEl.getAttribute("data-app");
      this.format = scriptEl.getAttribute("data-format") || "default";
      this.placement = scriptEl.getAttribute("data-placement") || null;
      this.slotEl = null;
      this.timerId = null;
      this.currentAdId = null;
      this.dbBaseUrl = "";
    }

    init() {
      if (!this.app) {
        log.error("Initialization rejected: Required attribute 'data-app' is missing on script tag.", this.scriptEl);
        return;
      }

      // Compute base URL from script src
      const scriptSrc = this.scriptEl.src;
      this.dbBaseUrl = new URL(scriptSrc, window.location.href).href.replace(/script\.js(?:\?.*)?$/, "");
      const dbUrl = new URL("adsdb.json", this.dbBaseUrl).href;

      // Create placeholder slot right before the script tag
      this.slotEl = document.createElement("div");
      this.slotEl.className = "mr-ads-slot";
      this.slotEl.setAttribute("data-mr-app", this.app);
      if (this.placement) this.slotEl.setAttribute("data-mr-placement", this.placement);
      this.scriptEl.parentNode.insertBefore(this.slotEl, this.scriptEl);

      injectStyles();

      // Begin loading DB
      fetchDatabase(dbUrl).then((db) => {
        if (!db) return;
        this.runLoop(db);
      });
    }

    runLoop(db) {
      if (this.timerId) clearTimeout(this.timerId);

      const ad = this.resolveAd(db);
      if (!ad) {
        this.slotEl.innerHTML = "";
        this.slotEl.style.display = "none";
        return;
      }

      this.renderAd(ad, db);
      FrequencyManager.record(ad.id);

      const duration = (ad.duration || db.settings?.defaultDuration || 10) * 1000;
      this.timerId = setTimeout(() => {
        this.runLoop(db);
      }, duration);
    }

    resolveAd(db) {
      if (!db.settings?.enabled) return null;

      const appConfig = db.apps?.[this.app];
      if (!appConfig || appConfig.enabled === false) return null;

      let candidates = [];

      // Priority 1: Exact App + Placement
      if (this.placement && appConfig.placements?.[this.placement]) {
        candidates = candidates.concat(appConfig.placements[this.placement]);
      }

      // Priority 2: App-wide Fallback
      if (candidates.length === 0 && Array.isArray(appConfig.ads)) {
        candidates = candidates.concat(appConfig.ads);
      }

      // Priority 3: Global Fallback
      if (candidates.length === 0 && Array.isArray(db.global)) {
        candidates = candidates.concat(db.global);
      }

      // Deduplicate by ID
      const uniqueMap = new Map();
      candidates.forEach((ad) => {
        if (ad && ad.id && !uniqueMap.has(ad.id)) {
          uniqueMap.set(ad.id, ad);
        }
      });
      const uniqueCandidates = Array.from(uniqueMap.values());

      // Filter
      const defaultTimes = db.settings?.defaultTimes || 6;
      const eligible = uniqueCandidates.filter((ad) => this.filterAd(ad, defaultTimes));
      if (eligible.length === 0) return null;

      // Select Ad (Fair randomized rotation, avoid immediate repetition if > 1 eligible)
      if (eligible.length === 1) return eligible[0];

      const pool = eligible.filter((ad) => ad.id !== this.currentAdId);
      const selected = pool.length > 0
        ? pool[Math.floor(Math.random() * pool.length)]
        : eligible[Math.floor(Math.random() * eligible.length)];

      this.currentAdId = selected.id;
      return selected;
    }

    filterAd(ad, defaultTimes) {
      if (!ad || typeof ad !== "object") return false;
      if (!ad.id || !ad.name || !ad.link) return false;

      // Status check
      if (ad.status === "in") return false;

      // Expiry check for temporary ads
      if (ad.status === "tem") {
        if (!ad.expire) return false;
        const expiryDate = new Date(ad.expire);
        if (isNaN(expiryDate.getTime()) || Date.now() >= expiryDate.getTime()) {
          return false;
        }
      }

      // Frequency limit
      const maxImpressions = ad.times !== undefined ? ad.times : defaultTimes;
      if (!FrequencyManager.isAllowed(ad.id, maxImpressions)) {
        return false;
      }

      // Sanitized destination verification
      if (!Security.sanitizeUrl(ad.link)) return false;

      // Format-specific asset verification
      if (this.format === "banner" && !ad.banner) return false;

      return true;
    }

    renderAd(ad, db) {
      const destination = Security.sanitizeUrl(ad.link);
      const logoUrl = Security.resolveAssetUrl(ad.logo, this.dbBaseUrl);
      const bannerUrl = Security.resolveAssetUrl(ad.banner, this.dbBaseUrl);

      // Clean container
      this.slotEl.innerHTML = "";
      this.slotEl.style.display = "block";

      const anchor = document.createElement("a");
      anchor.className = `mr-ads-container mr-ads-${this.format}`;
      anchor.href = destination;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.setAttribute("aria-label", `Advertisement: ${ad.name}`);

      switch (this.format) {
        case "banner":
          this.renderBanner(anchor, bannerUrl, ad.name);
          break;
        case "card":
          this.renderCard(anchor, bannerUrl, logoUrl, ad);
          break;
        case "compact":
          this.renderCompact(anchor, logoUrl, ad);
          break;
        case "both":
          this.renderBoth(anchor, bannerUrl, logoUrl, ad);
          break;
        case "default":
        default:
          this.renderDefault(anchor, logoUrl, ad);
          break;
      }

      this.slotEl.appendChild(anchor);
    }

    renderDefault(container, logoUrl, ad) {
      if (logoUrl) {
        const img = document.createElement("img");
        img.className = "mr-ads-logo";
        img.src = logoUrl;
        img.alt = "";
        img.loading = "lazy";
        container.appendChild(img);
      }

      const content = document.createElement("div");
      content.className = "mr-ads-content";

      const name = document.createElement("div");
      name.className = "mr-ads-name";
      name.textContent = ad.name;
      content.appendChild(name);

      if (ad.desc) {
        const desc = document.createElement("p");
        desc.className = "mr-ads-desc";
        desc.textContent = ad.desc;
        content.appendChild(desc);
      }
      container.appendChild(content);

      const cta = document.createElement("span");
      cta.className = "mr-ads-cta";
      cta.textContent = "Learn More →";
      cta.setAttribute("aria-hidden", "true");
      container.appendChild(cta);
    }

    renderBanner(container, bannerUrl, adName) {
      const img = document.createElement("img");
      img.src = bannerUrl;
      img.alt = adName;
      img.loading = "lazy";
      container.appendChild(img);

      const badge = document.createElement("span");
      badge.className = "mr-ads-badge";
      badge.textContent = "Ad";
      container.appendChild(badge);
    }

    renderCard(container, bannerUrl, logoUrl, ad) {
      if (bannerUrl) {
        const wrap = document.createElement("div");
        wrap.className = "mr-ads-banner-wrap";
        const img = document.createElement("img");
        img.src = bannerUrl;
        img.alt = "";
        wrap.appendChild(img);
        container.appendChild(wrap);
      }

      const body = document.createElement("div");
      body.className = "mr-ads-card-body";

      if (logoUrl) {
        const logo = document.createElement("img");
        logo.className = "mr-ads-logo";
        logo.src = logoUrl;
        logo.alt = "";
        body.appendChild(logo);
      }

      const content = document.createElement("div");
      content.className = "mr-ads-content";

      const name = document.createElement("div");
      name.className = "mr-ads-name";
      name.textContent = ad.name;
      content.appendChild(name);

      if (ad.desc) {
        const desc = document.createElement("p");
        desc.className = "mr-ads-desc";
        desc.textContent = ad.desc;
        content.appendChild(desc);
      }

      body.appendChild(content);
      container.appendChild(body);
    }

    renderCompact(container, logoUrl, ad) {
      if (logoUrl) {
        const img = document.createElement("img");
        img.className = "mr-ads-logo";
        img.src = logoUrl;
        img.alt = "";
        container.appendChild(img);
      }

      const name = document.createElement("span");
      name.className = "mr-ads-name";
      name.textContent = ad.name;
      container.appendChild(name);
    }

    renderBoth(container, bannerUrl, logoUrl, ad) {
      if (bannerUrl) {
        const wrap = document.createElement("div");
        wrap.className = "mr-ads-banner-wrap";
        const img = document.createElement("img");
        img.src = bannerUrl;
        img.alt = "";
        wrap.appendChild(img);
        container.appendChild(wrap);
      }

      const bottom = document.createElement("div");
      bottom.className = "mr-ads-bottom";
      this.renderDefault(bottom, logoUrl, ad);
      container.appendChild(bottom);
    }

    destroy() {
      if (this.timerId) clearTimeout(this.timerId);
      if (this.slotEl && this.slotEl.parentNode) {
        this.slotEl.parentNode.removeChild(this.slotEl);
      }
    }
  }

  // Bind to current executing script tag immediately
  const activeScript = document.currentScript;
  if (activeScript && !activeScript.dataset.mrLoaded) {
    activeScript.dataset.mrLoaded = "true";
    const unit = new MainRouteAdUnit(activeScript);
    runtime.instances.add(unit);
    unit.init();
  }
})();
