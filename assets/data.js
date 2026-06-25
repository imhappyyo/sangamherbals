/*
 * Sangam Herbals — storefront data layer.
 *
 * Plain browser script (NOT an ES module). Attaches window.loadCatalog().
 *
 * window.loadCatalog() -> Promise<{
 *   fx_rub_eur: number,
 *   featured_product_id: string,
 *   site_notice: { enabled: boolean, text: string },
 *   categories: [...],
 *   products: [...]
 * }>
 * resolving to the SAME shape as data/catalog.json (plus settings fields).
 *
 * Source selection:
 *   1. If window.SH_CONFIG.supabaseUrl AND .supabaseAnonKey are both non-empty,
 *      it reads live data from Supabase via the PostgREST REST API using plain
 *      fetch() (no SDK, no external dependencies).
 *   2. On ANY error — or when the config is empty — it falls back to the bundled
 *      data/catalog.json so the site always keeps working.
 *
 * This function NEVER throws: it always resolves to a usable catalog.
 */
(function () {
  "use strict";

  var FALLBACK_FX_RUB_EUR        = 0.011;
  var FALLBACK_FEATURED_ID       = "296624096";

  function fetchFallback() {
    return fetch("data/catalog.json").then(function (r) { return r.json(); });
  }

  function loadFromCatalogJson(reason) {
    return fetchFallback().then(function (catalog) {
      console.info("[Sangam] Catalog source: data/catalog.json (fallback)" + (reason ? " — " + reason : ""));
      return catalog;
    });
  }

  function loadFromSupabase(url, anonKey) {
    var base    = String(url).replace(/\/+$/, "");
    var restBase = base + "/rest/v1";
    var headers  = { apikey: anonKey, Authorization: "Bearer " + anonKey };

    function getJson(path) {
      return fetch(restBase + path, { headers: headers }).then(function (r) {
        if (!r.ok) throw new Error("Supabase request failed (" + r.status + ") for " + path);
        return r.json();
      });
    }

    return Promise.all([
      getJson("/products?active=eq.true&select=*&order=sort_order.asc"),
      getJson("/categories?select=*"),
      getJson("/settings?key=in.(fx_rub_eur,featured_product_id,site_notice)&select=key,value")
    ]).then(function (results) {
      var products   = results[0] || [];
      var categories = results[1] || [];
      var settingsRows = results[2] || [];

      // Supabase is reachable but not populated yet → fall back to catalog.json
      if (!products.length) {
        return loadFromCatalogJson("Supabase connected but has 0 products yet");
      }

      // Parse settings rows into a flat map { key: value }
      var settings = {};
      settingsRows.forEach(function (row) { if (row && row.key) settings[row.key] = row.value; });

      // fx_rub_eur
      var fx = FALLBACK_FX_RUB_EUR;
      var rawFx = settings["fx_rub_eur"];
      if (rawFx != null) {
        var num = typeof rawFx === "number" ? rawFx : parseFloat(rawFx);
        if (isFinite(num) && num > 0) fx = num;
      }

      // featured_product_id (stored as a JSON string: "\"296624096\"")
      var featuredId = FALLBACK_FEATURED_ID;
      var rawFid = settings["featured_product_id"];
      if (rawFid) {
        var fid = typeof rawFid === "string" ? rawFid.replace(/^"|"$/g, "") : String(rawFid);
        if (fid) featuredId = fid;
      }

      // site_notice { enabled: bool, text: string }
      var siteNotice = { enabled: false, text: "" };
      var rawNotice = settings["site_notice"];
      if (rawNotice && typeof rawNotice === "object") {
        siteNotice = { enabled: !!rawNotice.enabled, text: String(rawNotice.text || "") };
      }

      var catalog = {
        fx_rub_eur:           fx,
        featured_product_id:  featuredId,
        site_notice:          siteNotice,
        categories:           categories,
        products:             products
      };

      console.info("[Sangam] Catalog source: Supabase (" +
        products.length + " products, fx=" + fx +
        ", featured=" + featuredId + ")");

      return catalog;
    });
  }

  window.loadCatalog = function loadCatalog() {
    var cfg     = window.SH_CONFIG || {};
    var url     = cfg.supabaseUrl;
    var anonKey = cfg.supabaseAnonKey;
    var hasConfig = typeof url === "string" && url.trim() !== "" &&
                    typeof anonKey === "string" && anonKey.trim() !== "";

    if (!hasConfig) return loadFromCatalogJson("Supabase config not set");

    return loadFromSupabase(url.trim(), anonKey.trim()).catch(function (err) {
      console.warn("[Sangam] Supabase load failed, falling back:", err && err.message ? err.message : err);
      return loadFromCatalogJson("Supabase error").catch(function (err2) {
        console.error("[Sangam] Fallback also failed:", err2 && err2.message ? err2.message : err2);
        return { fx_rub_eur: FALLBACK_FX_RUB_EUR, featured_product_id: FALLBACK_FEATURED_ID,
                 site_notice: { enabled: false, text: "" }, categories: [], products: [] };
      });
    });
  };
})();
