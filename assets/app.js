/* ============================================================
   SANGAM HERBALS — The Materia Medica of Confluence · app
   ============================================================ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const LS = { lang: 'sh_lang', region: 'sh_region', cart: 'sh_cart' };
const RM = matchMedia('(prefers-reduced-motion:reduce)');
const FREE_SHIP = 35; // € threshold for free EU shipping

const state = {
  regions: null, catalog: null, i18n: {}, en: {},
  lang: 'en', region: null,
  catByUid: new Map(),
  filter: { section: 'all', subcat: null, concern: null, dosha: null, query: '', sort: 'featured' },
  shown: 24,
  soldOut: new Set(),
  doshas: {},
};

/* ---------- sold-out rotation: 10% of products shown as sold-out, rotates every 24 h ---------- */
function _seededRng(seed) {
  // mulberry32 — fast, good distribution
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function buildSoldOutSet(products) {
  // Seed = UTC day number so the set changes every 24 h and is identical for all visitors on the same day
  const day = Math.floor(Date.now() / 86400000);
  const rng = _seededRng(day * 2654435761); // spread seeds across days
  const ids = products.map(p => String(p.id));
  // Fisher-Yates shuffle with seeded RNG
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  const count = Math.max(1, Math.round(ids.length * 0.10));
  return new Set(ids.slice(0, count));
}

/* ---------- shop-by-concern: each product carries its own audited `concerns` array (data/catalog.json) ---------- */
const CONCERN_LABELS = {
  digestion: 'Digestion & Gut', immunity: 'Immunity & Vitality', energy: 'Strength & Energy',
  respiratory: 'Respiratory & Seasonal', stress: 'Stress, Sleep & Mind', joints: 'Joints & Muscles',
  womens: "Women's Wellbeing", skin: 'Skin & Face', hair: 'Hair & Scalp', oral: 'Oral Care',
  food: 'Food, Teas & Spices', fragrance: 'Fragrance & Ritual',
};
function matchesConcern(p, ckey) { return (p.concerns || []).includes(ckey); }
const concernLabel = ckey => t('edu.c_' + ckey + '_l') || CONCERN_LABELS[ckey] || ckey;

/* ---------- currency: euro-area countries use EUR; the rest keep their own ---------- */
const NON_EURO = {
  // EU non-euro
  CZ: 'CZK', DK: 'DKK', HU: 'HUF', PL: 'PLN', RO: 'RON', SE: 'SEK',
  // wider Europe
  GB: 'GBP', CH: 'CHF', NO: 'NOK', IS: 'ISK', TR: 'TRY',
  // North America
  US: 'USD', CA: 'CAD', MX: 'MXN', PR: 'USD',
  // Middle East
  AE: 'AED', QA: 'QAR', SA: 'SAR', JO: 'JOD', IL: 'ILS',
  // Asia / Pacific
  AU: 'AUD', NZ: 'NZD', CN: 'CNY', HK: 'HKD', TW: 'TWD', MO: 'MOP',
  JP: 'JPY', KR: 'KRW', SG: 'SGD', MY: 'MYR', TH: 'THB', IN: 'INR', ZA: 'ZAR',
};
/* indicative EUR → local rates (prices are indicative throughout the site) */
const FX_EUR = {
  CZK: 25.3, DKK: 7.46, HUF: 398, PLN: 4.30, RON: 4.97, SEK: 11.30,
  GBP: 0.85, CHF: 0.96, NOK: 11.5, ISK: 150, TRY: 38,
  USD: 1.08, CAD: 1.47, MXN: 18.5,
  AED: 3.97, QAR: 3.93, SAR: 4.05, JOD: 0.77, ILS: 4.0,
  AUD: 1.63, NZD: 1.78, CNY: 7.85, HKD: 8.45, TWD: 35, MOP: 8.7,
  JPY: 168, KRW: 1480, SGD: 1.46, MYR: 5.1, THB: 38, INR: 92, ZAR: 19.8,
};
const ZERO_DEC = new Set(['HUF', 'JPY', 'KRW', 'ISK', 'TWD']); // currencies shown without decimals
const regionCurrency = () => NON_EURO[state.region] || 'EUR';
function money(eur) {
  if (eur == null) return '—';
  const cur = regionCurrency();
  const amount = eur * (cur === 'EUR' ? 1 : (FX_EUR[cur] || 1));
  const frac = ZERO_DEC.has(cur) ? 0 : 2;
  const locale = (state.lang || 'en') + (state.region ? '-' + state.region : '');
  try { return new Intl.NumberFormat(locale, { style: 'currency', currency: cur, minimumFractionDigits: frac, maximumFractionDigits: frac }).format(amount); }
  catch (e) { return new Intl.NumberFormat('en', { style: 'currency', currency: cur, minimumFractionDigits: frac, maximumFractionDigits: frac }).format(amount); }
}
const EUR = money; // back-compat alias: all prices now follow the selected country's currency
/* image proxy — Tilda 425KB & Ozon 1.29MB JPEGs → ~16-19KB WebP */
const thumb = (u, w = 360) => u ? `https://images.weserv.nl/?url=${encodeURIComponent(u.replace(/^https?:\/\//, ''))}&w=${w}&output=webp&q=82` : '';
const vt = fn => (document.startViewTransition && !RM.matches) ? document.startViewTransition(fn) : fn();
const esc = s => (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- a11y: dialog focus management + live region ---------- */
const announce = msg => { const s = $('#sr-status'); if (s) { s.textContent = ''; setTimeout(() => { s.textContent = msg; }, 40); } };
let _restoreFocus = null;
const _bg = () => ['#header', '#top', '.footer'].map(s => $(s)).filter(Boolean);
function _trap(e) {
  if (e.key !== 'Tab') return;
  const panel = e.currentTarget;
  const f = [...panel.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])')].filter(el => el.offsetWidth || el.offsetHeight || el === document.activeElement);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
function openDialog(panel) {
  if (!panel) return;
  if (!_restoreFocus) _restoreFocus = document.activeElement;
  _bg().forEach(el => { el.inert = true; });
  document.body.classList.add('locked');
  panel.addEventListener('keydown', _trap);
  requestAnimationFrame(() => { try { panel.focus({ preventScroll: true }); } catch (e) {} });
}
function closeDialog(panel) {
  if (panel) panel.removeEventListener('keydown', _trap);
  if (document.querySelectorAll('.gate:not([hidden]),.modal:not([hidden]),.drawer:not([hidden]),.nav-drawer:not([hidden])').length <= 1) {
    _bg().forEach(el => { el.inert = false; });
    document.body.classList.remove('locked');
    if (_restoreFocus && _restoreFocus.focus) { try { _restoreFocus.focus({ preventScroll: true }); } catch (e) {} }
    _restoreFocus = null;
  }
}

/* ---------- i18n ---------- */
function t(path) {
  const get = o => path.split('.').reduce((a, k) => (a && a[k] != null ? a[k] : undefined), o);
  return get(state.i18n) ?? get(state.en) ?? path;
}
const catName = (slug, fb) => (state.i18n.categories && state.i18n.categories[slug]) || (state.en.categories && state.en.categories[slug]) || fb || slug;
const secName = (slug, fb) => (state.i18n.sections && state.i18n.sections[slug]) || (state.en.sections && state.en.sections[slug]) || fb || slug;
function applyI18n() {
  document.documentElement.lang = state.lang;
  // direction follows the active language's meta.dir (rtl for Arabic/Hebrew), default ltr
  document.documentElement.dir = (state.i18n && state.i18n.meta && state.i18n.meta.dir) || 'ltr';
  $$('[data-i18n]').forEach(el => {
    const val = t(el.dataset.i18n);
    if (val == null || val === el.dataset.i18n) return; // never overwrite with a missing-key fallback
    const attr = el.dataset.i18nAttr;
    if (attr) attr.split(',').forEach(a => el.setAttribute(a.trim(), val));
    else el.textContent = val;
  });
}

/* ---------- product helpers ---------- */
const pTitle = p => p.title_en || p.title_ru;
function pPrimaryCat(p) {
  for (const uid of p.category_uids || []) { const c = state.catByUid.get(uid); if (c && !c.is_section) return c; }
  for (const uid of p.category_uids || []) { const c = state.catByUid.get(uid); if (c) return c; }
  return null;
}
function pCatLabel(p) { const c = pPrimaryCat(p); if (!c) return secName(p.section_slug, p.section_en); return c.is_section ? secName(c.section_slug, c.title_en) : catName(c.slug, c.title_en); }
const sections = () => state.catalog.categories.filter(c => c.is_section);
const subcatsOf = slug => state.catalog.categories.filter(c => !c.is_section && c.section_slug === slug);
const secCount = slug => state.catalog.products.filter(p => p.section_slug === slug).length;
const subCount = cat => state.catalog.products.filter(p => (p.category_uids || []).includes(cat.uid)).length;

/* ---------- CSP-safe delegated handlers (replace inline onerror / onsubmit) ---------- */
// Image fallback: <img data-fallback="..." data-fallback-class="..."> swaps src on load error.
document.addEventListener('error', e => {
  const el = e.target;
  if (el && el.tagName === 'IMG' && el.dataset.fallback) {
    const fb = el.dataset.fallback; delete el.dataset.fallback; // one-shot, avoids loops
    el.src = fb; if (el.dataset.fallbackClass) el.classList.add(el.dataset.fallbackClass);
  }
}, true); // capture phase — error events don't bubble
// Static forms (hero search) never submit to a server.
document.addEventListener('submit', e => { if (e.target && e.target.tagName === 'FORM') e.preventDefault(); });
// Disable copy / right-click (allow in form fields)
const _isField = el => el && ['INPUT','TEXTAREA','SELECT'].includes(el.tagName);
document.addEventListener('copy',        e => { if (!_isField(e.target)) e.preventDefault(); });
document.addEventListener('cut',         e => { if (!_isField(e.target)) e.preventDefault(); });
document.addEventListener('contextmenu', e => { if (!_isField(e.target)) e.preventDefault(); });
document.addEventListener('dragstart',   e => { if (!_isField(e.target)) e.preventDefault(); });

/* ---------- boot ---------- */
async function boot() {
  const [regions, catalog, doshas] = await Promise.all([
    fetch('data/regions.json').then(r => r.json()),
    (typeof window.loadCatalog === 'function' ? window.loadCatalog() : fetch('data/catalog.json').then(r => r.json())),
    fetch('data/doshas.json').then(r => r.json()).catch(() => ({})),
  ]);
  state.regions = regions; state.catalog = catalog;
  // Merge: static doshas.json as base; product.doshas from Supabase overrides per-product
  const merged = Object.assign({}, doshas);
  catalog.products.forEach(p => { if (p.doshas && p.doshas.length) merged[String(p.id)] = p.doshas; });
  state.doshas = merged;
  state.soldOut = buildSoldOutSet(catalog.products);
  catalog.categories.forEach(c => state.catByUid.set(c.uid, c));
  state.en = await fetch('i18n/en.json').then(r => r.json());

  // a ?lang= in the URL (the hreflang alternates all point to one) wins over the
  // saved choice, so a crawler or a search-result click lands on localized content
  const urlLangRaw = new URLSearchParams(location.search).get('lang');
  const validLangs = new Set((regions.languages || []).map(l => l.code));
  const urlLang = urlLangRaw && validLangs.has(urlLangRaw) ? urlLangRaw : null;

  state.lang = urlLang || localStorage.getItem(LS.lang) || '';
  state.region = localStorage.getItem(LS.region) || '';

  // load the language for the page that sits behind the gate (stored choice, or English)
  await setLanguage(state.lang || 'en', true);

  // keep the canonical tag self-referencing for whichever language URL was requested
  if (urlLang && urlLang !== 'en') {
    const canon = document.querySelector('link[rel="canonical"]');
    if (canon) canon.setAttribute('href', 'https://sangamherbals.com/?lang=' + urlLang);
  }

  buildGate();
  renderTicker(); renderStreams(); renderDoshas(); renderChips(); renderTokens(); renderGrid();
  renderFooterCats(); renderHeroChips(); renderRemedy(); renderTrust();
  applyI18n(); wireUI(); initReveal();
  state.booted = true;
  $('#year').textContent = new Date().getFullYear();

  // the region + language selector always greets the visitor on open
  openGate();

  // deep-link: ?product=ID opens that product's own page (with a home entry behind it)
  const pid = new URLSearchParams(location.search).get('product');
  if (pid && state.catalog.products.some(x => x.id == pid)) {
    history.replaceState({}, '', location.pathname);
    openProductPage(pid, true);
  }
  // payment return: ?checkout=success|cancel after Stripe/PayPal
  handleCheckoutReturn();
}

/* ---------- gate · Tesla-style region selector + informative preview ---------- */
const countryRow = code => state.regions.countries.find(c => c[0] === code);
const langNative = code => { const l = state.regions.languages.find(x => x.code === code); return l ? l.native : (code || '').toUpperCase(); };
// fallback grouping if regions.json carries no "regions" array
const REGION_FALLBACK = [
  { key: 'na', codes: ['US', 'CA', 'MX', 'PR'] },
  { key: 'eu', codes: ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IS', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'CH', 'TR', 'GB'] },
  { key: 'me', codes: ['AE', 'QA', 'SA', 'JO', 'IL'] },
  { key: 'ap', codes: ['AU', 'NZ', 'CN', 'HK', 'TW', 'MO', 'JP', 'KR', 'SG', 'MY', 'TH', 'IN', 'ZA'] },
];

function buildGate() {
  const cc = $('#gate-countries'), go = $('#gate-go');
  const groups = (state.regions.regions && state.regions.regions.length) ? state.regions.regions : REGION_FALLBACK;

  // Tesla-style newspaper flow: region heading, then each country (native name over its language links), NO flags
  cc.innerHTML = groups.map(r => {
    const cells = r.codes.map(countryRow).filter(Boolean).map(([code, name, flag, def, langs, en]) => {
      const list = (langs && langs.length) ? langs : [def];
      const sName = `${name} ${en || ''} ${code}`.toLowerCase();
      const locs = list.map(lg => `<button class="gx__loc" role="option" aria-selected="false" data-code="${code}" data-lang="${lg}" lang="${lg}">${esc(langNative(lg))}</button>`).join('');
      return `<div class="gx__country" data-code="${code}" data-name="${esc(sName)}">`
        + `<span class="gx__cname">${esc(name)}</span>`
        + `<span class="gx__locs">${locs}</span></div>`;
    }).join('');
    const label = esc(t('gate.region_' + r.key));
    return `<h3 class="gx__region" data-i18n="gate.region_${r.key}">${label}</h3>${cells}`;
  }).join('');

  let selLang = localStorage.getItem(LS.lang) || null;
  let selCode = localStorage.getItem(LS.region) || null;
  const markSel = () => {
    $$('.gx__country', cc).forEach(c => c.classList.remove('is-selected'));
    $$('.gx__loc', cc).forEach(x => {
      const on = x.dataset.code === selCode && x.dataset.lang === selLang;
      x.setAttribute('aria-selected', String(on));
      if (on) { const p = x.closest('.gx__country'); if (p) p.classList.add('is-selected'); }
    });
  };
  const refresh = () => { go.disabled = !(selLang && selCode); previewChoice(selLang, selCode); };
  if (selCode && selLang) markSel();
  refresh();

  // pick a country+language locale in one click (Tesla model)
  cc.addEventListener('click', e => {
    const b = e.target.closest('.gx__loc'); if (!b) return;
    selCode = b.dataset.code; selLang = b.dataset.lang; markSel(); refresh();
    const c = countryRow(selCode);
    announce(`${c ? c[1] : selCode} — ${langNative(selLang)}`);
  });

  // CONTINUE — unchanged contract: persist pair, switch language, close gate
  go.addEventListener('click', async () => {
    localStorage.setItem(LS.region, selCode); localStorage.setItem(LS.lang, selLang);
    state.region = selCode; await setLanguage(selLang); closeGate();
  });

  // SEARCH — filters the flat flow; hides a region heading when no country under it matches
  const filter = $('#gate-filter');
  if (filter) filter.addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    const kids = [...cc.children]; let vis = 0;
    kids.forEach(el => { if (el.classList.contains('gx__country')) { const hit = !q || (el.dataset.name || '').includes(q); el.hidden = !hit; if (hit) vis++; } });
    for (let i = 0; i < kids.length; i++) {
      if (!kids[i].classList.contains('gx__region')) continue;
      let has = false;
      for (let j = i + 1; j < kids.length && !kids[j].classList.contains('gx__region'); j++) {
        if (kids[j].classList.contains('gx__country') && !kids[j].hidden) { has = true; break; }
      }
      kids[i].hidden = !has;
    }
    const cnt = $('#gate-country-count'); if (cnt) cnt.textContent = vis;
    const none = $('#gate-noresult'); if (none) none.hidden = vis !== 0;
  });

  // close affordance — only when a prior valid choice exists (never strand a first visitor)
  const closeBtn = $('#gate-close');
  if (closeBtn) {
    closeBtn.hidden = !(selLang && selCode);
    closeBtn.addEventListener('click', () => { if (!closeBtn.hidden) closeGate(); });
  }
}

/* clean footer summary bar — country headline + language·currency sub-line + Enter */
function updateGateSummary(l, c) { return previewChoice(l, c); } // back-compat alias
function previewChoice(langCode, code) {
  const head = $('#gate-summary'), sub = $('#gate-bar-sub'), go = $('#gate-go'), gl = $('#gate-go-label');
  const c = code && countryRow(code);

  if (!c) {                                   // nothing chosen yet — placeholder state
    if (head) { head.dataset.empty = '1'; head.textContent = head.dataset.placeholder || (t('gate.select_prompt') || ''); }
    if (sub) sub.textContent = '';
    if (gl) gl.textContent = t('gate.continue') || 'Enter store';
    if (go) go.removeAttribute('aria-label');
    return;
  }
  const [ccode, name, fl, def] = c;
  const lang = langNative(langCode || def);
  if (head) { delete head.dataset.empty; head.textContent = (t('gate.preview_head') || "You're shopping from {country}").replace('{country}', name); }

  // compact, language-neutral sub-line: selected language · currency
  const cur = NON_EURO[ccode];
  if (sub) sub.textContent = `${lang}  ·  ${cur || 'EUR'}`;

  if (gl) gl.textContent = t('gate.continue') || 'Enter store';
  if (go) go.setAttribute('aria-label', `${t('gate.continue') || 'Enter store'}, ${name}, ${lang}`);
}
function openGate() {
  const closeBtn = $('#gate-close');
  if (closeBtn) closeBtn.hidden = !(localStorage.getItem(LS.lang) && localStorage.getItem(LS.region));
  $('#gate').hidden = false;
  openDialog($('.gate__card'));
}
function closeGate() { $('#gate').hidden = true; closeDialog($('.gate__card')); window.scrollTo({ top: 0 }); }

/* ---------- language ---------- */
async function setLanguage(code, silent) {
  state.lang = code;
  try { state.i18n = code === 'en' ? state.en : await fetch(`i18n/${code}.json`).then(r => { if (!r.ok) throw 0; return r.json(); }); }
  catch { state.i18n = state.en; state.lang = 'en'; }
  localStorage.setItem(LS.lang, state.lang);
  updateRegionBtn(); applyI18n();
  if (!silent) {
    renderTicker(); renderStreams(); renderDoshas(); renderChips(); renderTokens(); renderGrid(); renderFooterCats(); renderHeroChips(); renderRemedy(); renderTrust();
    // freshly re-rendered .reveal blocks were never seen by the boot IntersectionObserver, so they'd
    // stay at opacity:0 — reveal them immediately (same proven pattern as renderTrust's founder/credibility).
    if (state.booted) $$('.reveal:not(.in)').forEach(e => e.classList.add('in'));
    // re-localize an OPEN gate's dynamic preview (the JS-built rows aren't covered by applyI18n)
    if ($('#gate') && !$('#gate').hidden) previewChoice(localStorage.getItem(LS.lang), localStorage.getItem(LS.region));
  }
}
function updateRegionBtn() {
  const c = state.regions.countries.find(x => x[0] === state.region);
  const flag = c ? c[2] : '🌐'; const code = (state.lang || 'en').toUpperCase();
  $('#region-flag').textContent = flag; $('#region-lang').textContent = code;
  const f2 = $('#region-flag-2'), l2 = $('#region-lang-2'); if (f2) f2.textContent = flag; if (l2) l2.textContent = code;
}

/* ---------- ticker ---------- */
function renderTicker() {
  const track = $('#marquee-track'); if (!track) return;
  const N = state.catalog.products.length;
  const items = [
    `${N} ${t('hero.stat_products')}`,
    ...sections().map(s => secName(s.section_slug, s.title_en)),
    t('product.origin'), t('product.ships'),
  ];
  const line = `<span style="display:inline-flex;gap:2.6rem;padding-inline-end:2.6rem">${items.map(x => `<i style="font-style:normal">✦ ${esc(x)}</i>`).join('')}</span>`;
  $('#marquee-track').innerHTML = line + line;
}
function renderHeroChips() {
  const wanted = ['ayurveda', 'cosmetics', 'food', 'oils', 'aromatherapy'];
  $('#hero-chips').innerHTML = wanted.map(s => `<button class="hero__chip" data-section="${s}">${esc(secName(s))}</button>`).join('');
}

/* ---------- dosha section ---------- */
const DOSHAS = [
  { key: 'vata',  symbol: '◌', element: t('doshas.vata_element') || 'Air & Space', tagline: t('doshas.vata_tag') || 'Grounding · Warming · Nourishing' },
  { key: 'pitta', symbol: '△', element: t('doshas.pitta_element') || 'Fire & Water', tagline: t('doshas.pitta_tag') || 'Cooling · Soothing · Clarifying' },
  { key: 'kapha', symbol: '◇', element: t('doshas.kapha_element') || 'Earth & Water', tagline: t('doshas.kapha_tag') || 'Energising · Lightening · Stimulating' },
];
function renderDoshas() {
  if (!$('#dosha-cards')) return;
  const unit = t('shop.results') || 'products';
  const active = state.filter.dosha;
  $('#dosha-cards').innerHTML = DOSHAS.map(d => {
    const count = doshaCount(d.key);
    const el = t(`doshas.${d.key}_element`) || d.element;
    const tag = t(`doshas.${d.key}_tag`) || d.tagline;
    return `<button class="dosha-card reveal${active === d.key ? ' is-active' : ''}" data-dosha="${d.key}" aria-pressed="${active === d.key}">
      <span class="dosha-card__sym" aria-hidden="true">${d.symbol}</span>
      <strong class="dosha-card__name">${esc(t(`doshas.${d.key}`) || d.key.charAt(0).toUpperCase()+d.key.slice(1))}</strong>
      <span class="dosha-card__el">${esc(el)}</span>
      <span class="dosha-card__tag">${esc(tag)}</span>
      <span class="dosha-card__count">${count} ${esc(unit)}</span>
    </button>`;
  }).join('');
  // Re-rendered cards are new DOM nodes — the boot IntersectionObserver already
  // unobserved the old ones, so these would stay opacity:0 forever. Force-reveal
  // immediately when already booted (section is already in view at this point).
  if (state.booted) $$('#dosha-cards .reveal').forEach(e => e.classList.add('in'));
  else state._reveal?.();
}

/* ---------- category index ---------- */
const SECTION_PINS = { cosmetics: '296624096', oils: '1768240112' };
function sectionImage(slug) {
  const pin = SECTION_PINS[slug];
  if (pin) { const p = state.catalog.products.find(x => String(x.id) === pin && x.image); if (p) return p.image; }
  const p = state.catalog.products.find(x => x.section_slug === slug && x.image); return p ? p.image : '';
}
function renderStreams() {
  const unit = t('shop.results') || 'products';
  $('#pillars').innerHTML = sections().map(c => {
    const slug = c.section_slug; const img = sectionImage(slug);
    return `<button class="cat-card reveal" data-section="${slug}">
      <div class="cat-card__img">${img ? `<img loading="lazy" src="${thumb(img, 340)}" alt="">` : ''}</div>
      <h3 class="cat-card__name">${esc(secName(slug, c.title_en))}</h3>
      <span class="cat-card__count">${secCount(slug)} ${esc(unit)}</span>
    </button>`;
  }).join('');
}

/* ---------- facet rail ---------- */
function renderChips() {
  const f = state.filter;
  let html = `<button class="fgroup ${f.section === 'all' ? 'is-active' : ''}" data-section="all" aria-pressed="${f.section === 'all'}"><span>${esc(t('shop.all'))}</span><span class="fgroup__c">${state.catalog.products.length}</span></button>`;
  sections().forEach(c => {
    const active = f.section === c.section_slug;
    html += `<button class="fgroup ${active ? 'is-active' : ''}" data-section="${c.section_slug}" aria-pressed="${active}"><span>${esc(secName(c.section_slug, c.title_en))}</span><span class="fgroup__c">${secCount(c.section_slug)}</span></button>`;
    if (active) {
      const subs = subcatsOf(c.section_slug);
      if (subs.length) html += `<div class="fsub">${subs.map(s => `<button class="fsubitem ${f.subcat === s.slug ? 'is-active' : ''}" data-subcat="${s.slug}" aria-pressed="${f.subcat === s.slug}"><span>${esc(catName(s.slug, s.title_en))}</span><span class="fgroup__c">${subCount(s)}</span></button>`).join('')}</div>`;
    }
  });
  $('#chips').innerHTML = html;
}
function renderTokens() {
  const f = state.filter; const toks = [];
  if (f.dosha) toks.push({ k: 'dosha', label: (t(`doshas.${f.dosha}`) || f.dosha.charAt(0).toUpperCase()+f.dosha.slice(1)) });
  if (f.concern) toks.push({ k: 'concern', label: concernLabel(f.concern) });
  if (f.section !== 'all') toks.push({ k: 'section', label: secName(f.section) });
  if (f.subcat) { const c = state.catalog.categories.find(x => x.slug === f.subcat); if (c) toks.push({ k: 'subcat', label: catName(c.slug, c.title_en) }); }
  if (f.query) toks.push({ k: 'query', label: `”${f.query}”` });
  $('#filter-tokens').innerHTML = toks.map(x => `<button type=”button” class=”token” data-token=”${x.k}”>${esc(x.label)} <b>×</b></button>`).join('');
}

const doshaCount = d => state.catalog.products.filter(p => (state.doshas[String(p.id)] || []).includes(d)).length;

/* ---------- filter + grid ---------- */
function filtered() {
  let list = state.catalog.products.slice(); const f = state.filter;
  if (f.dosha) list = list.filter(p => (state.doshas[String(p.id)] || []).includes(f.dosha));
  if (f.concern) list = list.filter(p => matchesConcern(p, f.concern));
  if (f.section !== 'all') list = list.filter(p => p.section_slug === f.section);
  if (f.subcat) { const cat = state.catalog.categories.find(c => c.slug === f.subcat); if (cat) list = list.filter(p => (p.category_uids || []).includes(cat.uid)); }
  if (f.query) { const q = f.query.toLowerCase(); list = list.filter(p => (pTitle(p) || '').toLowerCase().includes(q) || (p.title_ru || '').toLowerCase().includes(q)); }
  switch (f.sort) {
    case 'price_low': list.sort((a, b) => (a.price_eur || 0) - (b.price_eur || 0)); break;
    case 'price_high': list.sort((a, b) => (b.price_eur || 0) - (a.price_eur || 0)); break;
    case 'az': list.sort((a, b) => (pTitle(a) || '').localeCompare(pTitle(b) || '')); break;
  }
  return list;
}
function cardHTML(p, idx) {
  const desc = p.blurb_en || '';
  const so = state.soldOut.has(String(p.id));
  return `<article class="card${so ? ' card--soldout' : ''}" data-id="${p.id}" role="button" tabindex="0" aria-label="${esc(pTitle(p))}${p.price_eur != null ? ', ' + EUR(p.price_eur) : ''}">
    <div class="card__media">
      ${p.image ? `<img loading="lazy" decoding="async" width="232" height="232" src="${thumb(p.image, 360)}" alt="${esc(pTitle(p))}">` : ''}
      ${so ? `<span class="card__soldout-badge">${esc(t('shop.sold_out') || 'Sold Out')}</span>` : ''}
    </div>
    <div class="card__body">
      <span class="card__cat">${esc(secName(p.section_slug, p.section_en))}</span>
      <h3 class="card__title">${esc(pTitle(p))}</h3>
      ${desc ? `<p class="card__desc">${esc(desc)}</p>` : ''}
      <div class="card__foot">
        <div class="card__price">${p.price_eur != null ? EUR(p.price_eur) : '—'}</div>
        ${so
          ? `<button class="card__add card__add--so" disabled>${esc(t('shop.sold_out') || 'Sold Out')}</button>`
          : `<button class="card__add" data-add="${p.id}">${esc(t('shop.add'))}</button>`}
      </div>
    </div>
  </article>`;
}
function paintGrid() {
  const list = filtered();
  $('#result-count').textContent = String(list.length).padStart(3, '0');
  $('#result-total').textContent = state.catalog.products.length;
  $('#product-grid').innerHTML = list.slice(0, state.shown).map((p, i) => cardHTML(p, i)).join('');
  $('#shop-empty').hidden = list.length !== 0;
  $('#load-more').hidden = list.length <= state.shown;
}
function renderGrid() { vt(paintGrid); }

function renderFooterCats() {
  $('#footer-cats').innerHTML = sections().map(c => `<a href="#shop" data-section="${c.section_slug}">${esc(secName(c.section_slug, c.title_en))}</a>`).join('');
}

/* ---------- trust architecture (bar / founder / standards / seals / credibility / faq) ---------- */
const SVGI = {
  lock: '<path d="M6 11V8a6 6 0 0 1 12 0v3"/><rect x="4" y="11" width="16" height="10" rx="2"/><circle cx="12" cy="16" r="1.4"/>',
  return: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/>',
  parcel: '<path d="M3.5 8 12 4l8.5 4-8.5 4z"/><path d="M3.5 8v8L12 20l8.5-4V8"/><path d="M12 12v8"/>',
  mortar: '<path d="M5 10h14a7 7 0 0 1-7 7 7 7 0 0 1-7-7Z"/><path d="M9 10 7 4"/><path d="M15 10l2-6"/>',
  label: '<path d="M3 5h9l8 7-8 7H3z"/><circle cx="8" cy="12" r="1.4"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
};
const icon = (k) => `<svg class="ti" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SVGI[k] || ''}</svg>`;
function trustBarHTML() { const items = t('trust.bar') || []; return items.map(x => `<span class="trustbar__item">${esc(x)}</span>`).join(''); }
function badgesHTML() { const b = t('trust.badges') || []; return b.map(x => `<div class="tbadge"><span class="tbadge__l">${esc(x.label)}</span><span class="tbadge__t">${esc(x.text)}</span></div>`).join(''); }
function standardsHTML() { const s = t('trust.std_items') || []; return `<div class="std-grid">${s.map((it, i) => `<div class="std"><span class="std__n mono">${String(i + 1).padStart(2, '0')}</span><div><h3 class="std__l">${esc(it.label)}</h3><p class="std__t">${esc(it.text)}</p></div></div>`).join('')}</div>`; }
function sealsHTML() { const s = t('trust.seals') || []; return `<div class="seals-grid">${s.map(it => `<div class="seal">${icon(it.icon)}<div><h3 class="seal__l">${esc(it.label)}</h3><p class="seal__t">${esc(it.sub)}</p></div></div>`).join('')}</div>`; }
function sealsMiniHTML() { const s = t('trust.seals') || []; return `<ul class="seals-mini">${s.slice(0, 4).map(it => `<li>${icon(it.icon)}<span>${esc(it.label)}</span></li>`).join('')}</ul>`; }
function trustFaqHTML() { const f = t('trust.faq') || []; return f.map(x => `<details class="pdp__acc"><summary class="pdp__acc-q">${esc(x.q)}<span class="pdp__acc-i" aria-hidden="true">+</span></summary><div class="pdp__acc-a"><p>${esc(x.a)}</p></div></details>`).join(''); }
function renderTrust() {
  const tb = $('#trust-bar'); if (tb) tb.innerHTML = `<div class="wrap trustbar__row">${trustBarHTML()}</div>`;
  const fd = $('#founder'); if (fd) { const f = t('founder') || {}; const paras = (f.paragraphs || []).map(p => `<p>${esc(p)}</p>`).join(''); fd.innerHTML = `<div class="wrap founder__grid reveal"><figure class="founder__seal"><img src="assets/founder.jpg" alt="${esc(f.signature || 'Dr. Praveen Rathi')}" class="founder__portrait" data-fallback="assets/tree.svg" data-fallback-class="founder__portrait--mark"><figcaption class="founder__cred mono">${esc(f.credential || '')}</figcaption></figure><div class="founder__body"><span class="ihead__kicker mono">${esc(f.eyebrow || '')}</span><h2 class="founder__h">${esc(f.heading || '')}</h2>${paras}<p class="founder__sign">${esc(f.signature || '')}</p><span class="founder__signsub mono">${esc(f.signature || '')}</span></div></div>`; }
  const st = $('#standards'); if (st) st.innerHTML = `<div class="wrap"><header class="ihead reveal"><span class="ihead__kicker mono">${esc(t('trust.std_kicker'))}</span><h2 class="ihead__title">${esc(t('trust.std_title'))}</h2><p class="ihead__intro">${esc(t('trust.std_intro'))}</p></header>${standardsHTML()}</div>`;
  const cr = $('#credibility'); if (cr) { const lines = t('trust.credibility') || []; cr.innerHTML = `<div class="wrap reveal"><span class="ihead__kicker mono cred__kicker">${esc(t('trust.cred_title') || '')}</span><ul class="cred__list">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul></div>`; }
  const gb = $('#guarantee'); if (gb) gb.innerHTML = `<div class="wrap guarantee__inner"><span class="ihead__kicker mono">${esc(t('trust.seals_title') || t('trust.g_kicker'))}</span><h2 class="guarantee__h">${esc(t('trust.g_title'))}</h2><p class="guarantee__promise">${esc(t('trust.g_promise'))}</p>${sealsHTML()}</div>`;
  const sn = $('#safety-note'); if (sn) sn.textContent = t('trust.safety_note') || '';
  // on a language re-render the freshly injected .reveal blocks aren't observed — show them immediately
  if (state.booted) $$('#founder .reveal, #credibility .reveal, #standards .reveal').forEach(e => e.classList.add('in'));
}

/* ---------- hero flagship ---------- */
function flagship() {
  const P = state.catalog.products;
  return P.find(p => /chyawanprash|чаванпраш/i.test((p.title_en || '') + (p.title_ru || '')) && p.image)
    || P.find(p => p.section_slug === 'ayurveda' && p.image) || P.find(p => p.image);
}
/* ---------- Remedy spotlight ---------- */
function renderRemedy() {
  const P = state.catalog.products;
  const fid = (flagship() || {}).id;
  const FEATURED_ID = String(state.catalog.featured_product_id || '296624096');
  const pick = P.find(p => String(p.id) === FEATURED_ID && p.image)
    || P.find(p => p.section_slug === 'cosmetics' && p.image && p.id !== fid)
    || P.find(p => p.section_slug === 'oils' && p.image && p.id !== fid)
    || P.find(p => p.image && p.id !== fid) || P[0];
  if (!pick) return;
  $('#remedy').hidden = false;
  $('#remedy-img').src = thumb(pick.image, 720); $('#remedy-img').alt = pTitle(pick);
  $('#remedy-title').textContent = pTitle(pick);
  $('#remedy-desc').textContent = pick.blurb_en || pick.desc_ru || '';
  $('#remedy-price').textContent = pick.price_eur != null ? EUR(pick.price_eur) : '';
  $('#remedy-add').onclick = () => addToCart(pick.id, $('#remedy-img'));
}

/* ---------- product modal ---------- */
function openProduct(id, fromImg) {
  const p = state.catalog.products.find(x => x.id == id); if (!p) return;
  const fill = () => {
    $('#pm-img').src = thumb(p.image, 760); $('#pm-img').alt = pTitle(p);
    $('#pm-cat').textContent = pCatLabel(p);
    $('#pm-title').textContent = pTitle(p);
    $('#pm-price').innerHTML = (p.price_eur != null ? EUR(p.price_eur) : '—');
    $('#pm-desc').textContent = p.blurb_en || p.desc_ru || '';
    const meta = [];
    if (p.sku) meta.push([t('shop.sku') || 'SKU', p.sku]);
    meta.push([t('product.category'), pCatLabel(p)]);
    meta.push([t('product.origin'), '🇮🇳 India']);
    $('#pm-meta').innerHTML = meta.map(([k, v]) => `<li><span>${esc(k)}</span><b>${esc(v)}</b></li>`).join('');
    $('#pm-add').onclick = () => { addToCart(p.id, $('#pm-img')); const b = $('#pm-add'); b.classList.add('added'); b.textContent = '✓'; setTimeout(() => { b.classList.remove('added'); applyI18n(); }, 1000); };
    $('#product-modal').hidden = false; openDialog($('.modal__card'));
  };
  // shared-element morph
  if (document.startViewTransition && !RM.matches && fromImg) {
    fromImg.style.viewTransitionName = 'pm-hero';
    const tr = document.startViewTransition(() => { fromImg.style.viewTransitionName = ''; $('#pm-img').style.viewTransitionName = 'pm-hero'; fill(); });
    tr.finished.finally(() => { $('#pm-img').style.viewTransitionName = ''; fromImg.style.viewTransitionName = ''; });
  } else fill();
}
function closeModal() {
  const img = $('#pm-img'); img.style.viewTransitionName = '';
  $('#product-modal').hidden = true; closeDialog($('.modal__card'));
}

/* ---------- product PAGE (own URL ?product=ID, Ordinary-style) ---------- */
function pdpRelated(p) {
  const key = (p.concerns || [])[0]; if (!key) return [];
  return state.catalog.products.filter(x => x.id !== p.id && (x.concerns || []).includes(key) && x.image).slice(0, 4);
}
function cartTotalEur() { return getCart().reduce((a, x) => { const pp = state.catalog.products.find(z => z.id == x.id); return a + ((pp && pp.price_eur || 0) * x.q); }, 0); }
function shipNudge(total) {
  if (total >= FREE_SHIP) return { cls: 'is-unlocked', text: t('pdp.freeship_unlocked') || '✓ Free EU delivery unlocked' };
  if (total > 0) return { cls: '', text: (t('pdp.freeship_away') || "You're {amount} away from free EU delivery").replace('{amount}', money(FREE_SHIP - total)) };
  return { cls: '', text: (t('pdp.freeship_over') || 'Free EU delivery over {amount}').replace('{amount}', money(FREE_SHIP)) };
}
function updatePdpShip() { const el = $('#pdp-ship-free'); if (!el) return; const s = shipNudge(cartTotalEur()); el.textContent = s.text; el.className = 'pdp__ship-free mono ' + s.cls; }
function pdpQty() { const el = $('#pdp-qty'); return Math.max(1, parseInt(el && el.textContent) || 1); }
function renderPDP(p) {
  const d = p.pdp || {};
  const imgs = [...new Set((Array.isArray(p.images) && p.images.length ? p.images : [p.image]).filter(Boolean))];
  const targets = (p.concerns || []).map(k => `<button class="pdp__tag" data-concern="${k}">${esc(concernLabel(k))}</button>`).join('');
  const lead = d.description || d.what || p.blurb_en || '';
  const related = pdpRelated(p);
  const fact = (label, value) => value ? `<div class="pdp__fact"><span class="pdp__fact-k">${esc(label)}</span><span class="pdp__fact-v">${value}</span></div>` : '';
  const acc = (label, html, open) => html ? `<details class="pdp__acc"${open ? ' open' : ''}><summary class="pdp__acc-q">${esc(label)}<span class="pdp__acc-i" aria-hidden="true">+</span></summary><div class="pdp__acc-a">${html}</div></details>` : '';
  const benefits = Array.isArray(d.benefits) && d.benefits.length ? `<ul class="pdp__list">${d.benefits.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : '';
  // key ingredients — explained list (fallback: split the plain string)
  let ings = Array.isArray(d.key_ingredients) && d.key_ingredients.length ? d.key_ingredients
    : (d.ingredients ? d.ingredients.split(/[,;·]/).map(s => ({ name: s.trim() })).filter(x => x.name) : []);
  const gtk = Array.isArray(d.good_to_know) ? d.good_to_know.filter(Boolean) : [];
  const cautionText = t('pdp.caution') || 'Traditional Ayurvedic information for education, not medical advice. If you are pregnant, breastfeeding, taking medication or under medical care, please consult your doctor before use.';
  const detailsDl = `<dl class="pdp__dl">
      ${d.format ? `<div><dt>${esc(t('pdp.format') || 'Format')}</dt><dd>${esc(d.format)}</dd></div>` : ''}
      <div><dt>${esc(t('product.category') || 'Category')}</dt><dd>${esc(pCatLabel(p))}</dd></div>
      ${p.sku ? `<div><dt>${esc(t('shop.sku') || 'SKU')}</dt><dd>${esc(p.sku)}</dd></div>` : ''}
      <div><dt>${esc(t('pdp.origin') || 'Origin')}</dt><dd>🇮🇳 ${esc(t('pdp.india') || 'India')}</dd></div>
    </dl>`;
  const howHtml = (d.how_to_use ? `<p>${esc(d.how_to_use)}</p>` : '') + (d.routine ? `<p class="pdp__acc-routine"><b>${esc(t('pdp.routine') || 'How it fits your routine')}.</b> ${esc(d.routine)}</p>` : '');
  const precHtml = (d.not_suited ? `<p><b>${esc(t('pdp.take_care') || 'Please take care if')}:</b> ${esc(d.not_suited)}</p>` : '') + `<p>${esc(cautionText)}</p>`;

  // reused, already-translated trust content
  const pillar = (i) => `<div class="pdp__pillar"><span class="pdp__pillar-n mono">0${i}</span><h3>${esc(t('edu.about_pr' + i + '_l'))}</h3><p>${esc(t('edu.about_pr' + i + '_t'))}</p></div>`;
  const faqItem = (i) => `<details class="pdp__acc"><summary class="pdp__acc-q">${esc(t('edu.faq' + i + '_q'))}<span class="pdp__acc-i" aria-hidden="true">+</span></summary><div class="pdp__acc-a"><p>${esc(t('edu.faq' + i + '_a'))}</p></div></details>`;
  const pdpFaq = (i) => t('pdp.faq' + i + '_q') ? `<details class="pdp__acc"><summary class="pdp__acc-q">${esc(t('pdp.faq' + i + '_q'))}<span class="pdp__acc-i" aria-hidden="true">+</span></summary><div class="pdp__acc-a"><p>${esc(t('pdp.faq' + i + '_a'))}</p></div></details>` : '';
  const assure = (lbl, txt) => `<div class="pdp__assure-item"><span class="pdp__assure-l mono">${esc(lbl)}</span><span class="pdp__assure-t">${esc(txt)}</span></div>`;

  return `
  <div class="pdp__inner">
    <div class="wrap">
      <button class="pdp__back" data-pdp-back><span class="arr">←</span> ${esc(t('pdp.back') || 'Back to shop')}</button>
      <div class="pdp__grid">
        <div class="pdp__gallery">
          <div class="pdp__stage">${imgs[0] ? `<img id="pdp-img" src="${thumb(imgs[0], 900)}" alt="${esc(pTitle(p))}">` : ''}</div>
          ${imgs.length > 1 ? `<div class="pdp__thumbs">${imgs.map((u, i) => `<button class="pdp__thumb${i === 0 ? ' is-active' : ''}" data-pdp-thumb="${esc(u)}"><img loading="lazy" src="${thumb(u, 130)}" alt=""></button>`).join('')}</div>` : ''}
        </div>
        <div class="pdp__panel">
          <p class="pdp__brand mono">${esc(pCatLabel(p))}</p>
          <h1 class="pdp__name">${esc(pTitle(p))}</h1>
          ${d.subtitle ? `<p class="pdp__subtitle">${esc(d.subtitle)}</p>` : ''}
          <div class="pdp__pricing">
            <span class="pdp__price">${p.price_eur != null ? money(p.price_eur) : '—'}</span>
            ${d.format && /\d|\b(g|kg|ml|l|caps?|capsules?|tablets?|sachets?|pcs)\b/i.test(d.format) ? `<span class="pdp__price-note">${esc(d.format)}</span>` : ''}
          </div>
          <div class="pdp__ship" id="pdp-ship">
            <span class="pdp__ship-deliver mono">${icon('parcel')}${esc(t('pdp.delivery_eu') || 'Tracked delivery to all 27 EU member states')}</span>
            <span class="pdp__ship-free mono ${shipNudge(cartTotalEur()).cls}" id="pdp-ship-free">${esc(shipNudge(cartTotalEur()).text)}</span>
          </div>
          <div class="pdp__buy">
            <div class="pdp__qty" role="group" aria-label="${esc(t('pdp.qty_label') || 'Quantity')}">
              <button class="pdp__qty-btn" data-qty="-1" type="button" aria-label="Decrease quantity">−</button>
              <span class="pdp__qty-n" id="pdp-qty" aria-live="polite">1</span>
              <button class="pdp__qty-btn" data-qty="1" type="button" aria-label="Increase quantity">+</button>
            </div>
            <button class="btn btn--solid pdp__add" id="pdp-add" data-pdp-add>${esc(t('shop.add') || 'Add to cart')}</button>
          </div>
          <p class="pdp__atc-reassure mono">${esc(t('pdp.cta_guarantee') || t('trust.atc_reassure') || '')}</p>
          <button class="pdp__authority" data-pdp-why type="button">
            <img src="assets/founder.jpg" alt="${esc((t('founder') || {}).signature || 'Dr. Praveen Rathi')}" class="pdp__authority-img" data-fallback="assets/tree.svg" data-fallback-class="pdp__authority-img--mark">
            <span class="pdp__authority-txt">${esc(t('pdp.authority_quote') || 'Formulated and overseen by Dr. Praveen Rathi.')} <span class="pdp__authority-go" aria-hidden="true">↗</span></span>
          </button>
          ${sealsMiniHTML()}
          ${lead ? `<p class="pdp__lead">${esc(lead)}</p>` : ''}
          ${benefits ? `<div class="pdp__benefits"><span class="pdp__benefits-h mono">${esc(t('pdp.benefits') || 'Traditionally used to support')}</span>${benefits}</div>` : ''}
          <div class="pdp__facts">
            ${targets ? `<div class="pdp__fact"><span class="pdp__fact-k">${esc(t('pdp.good_for') || 'Good for')}</span><span class="pdp__fact-v"><span class="pdp__tags">${targets}</span></span></div>` : ''}
            ${fact(t('pdp.format') || 'Format', d.format ? esc(d.format) : '')}
            ${fact(t('pdp.suited') || 'Suited to', d.suited_for ? esc(d.suited_for) : '')}
          </div>
          <div class="pdp__accs">
            ${acc(t('pdp.how') || 'How to use', howHtml, true)}
            ${acc(t('pdp.details') || 'Details', detailsDl)}
            ${acc(t('pdp.precautions') || 'Precautions', precHtml)}
          </div>
        </div>
      </div>
    </div>

    ${related.length ? `<section class="pdp__sec-block pdp__pairs-sec"><div class="wrap">
      <h2 class="pdp__h2">${esc(t('pdp.pairs_title') || 'Completes your routine')}</h2>
      <p class="pdp__h2-sub">${esc(t('pdp.pairs_sub') || '')}</p>
      <div class="pdp__pairs">${related.slice(0, 3).map(x => `<article class="pairc" data-id="${x.id}">
        <button class="pairc__media" data-id="${x.id}" aria-label="${esc(pTitle(x))}">${x.image ? `<img loading="lazy" src="${thumb(x.image, 200)}" alt="${esc(pTitle(x))}">` : ''}</button>
        <div class="pairc__body">
          <span class="pairc__cat mono">${esc(secName(x.section_slug, x.section_en))}</span>
          <h3 class="pairc__title" data-id="${x.id}">${esc(pTitle(x))}</h3>
          <div class="pairc__foot"><span class="pairc__price">${x.price_eur != null ? money(x.price_eur) : '—'}</span><button class="pairc__add" data-add="${x.id}">${esc(t('pdp.add_one') || 'Add')}</button></div>
        </div></article>`).join('')}</div>
    </div></section>` : ''}

    ${ings.length ? `<section class="pdp__sec-block"><div class="wrap pdp__sec-narrow">
      <h2 class="pdp__h2">${esc(t('pdp.ingredients') || 'Key ingredients')}</h2>
      <p class="pdp__h2-sub">${esc(t('pdp.transparency') || 'Every ingredient, listed openly')}</p>
      <ul class="pdp__ings">${ings.map(i => `<li><span class="pdp__ing-n">${esc(i.name)}</span>${i.note ? `<span class="pdp__ing-d">${esc(i.note)}</span>` : ''}</li>`).join('')}</ul>
    </div></section>` : ''}

    ${gtk.length ? `<section class="pdp__sec-block pdp__sec-alt"><div class="wrap pdp__sec-narrow">
      <h2 class="pdp__h2">${esc(t('pdp.good_to_know') || 'Good to know')}</h2>
      <ul class="pdp__gtk">${gtk.map(g => `<li>${esc(g)}</li>`).join('')}</ul>
    </div></section>` : ''}

    ${(t('pdp.compare_rows') || []).length ? `<section class="pdp__sec-block pdp__sec-alt"><div class="wrap pdp__sec-narrow">
      <h2 class="pdp__h2">${esc(t('pdp.compare_title') || 'Why choose Sangam')}</h2>
      <p class="pdp__h2-sub">${esc(t('pdp.compare_sub') || '')}</p>
      <div class="pdp__compare">
        <div class="pdp__compare-head"><span></span><span class="pdp__compare-us">${esc(t('pdp.compare_us') || 'Sangam Herbals')}</span><span class="pdp__compare-them">${esc(t('pdp.compare_them') || 'Typical')}</span></div>
        ${(t('pdp.compare_rows') || []).map(r => `<div class="pdp__compare-row"><span class="pdp__compare-l">${esc(r.label)}</span><span class="pdp__compare-us"><span class="pdp__tick" aria-hidden="true">✓</span>${esc(r.us)}</span><span class="pdp__compare-them">${esc(r.them)}</span></div>`).join('')}
      </div>
    </div></section>` : ''}

    <section class="pdp__why bleed">
      <div class="wrap pdp__why-inner">
        <span class="pdp__why-kicker mono">${esc(t('pdp.why_kicker') || 'Why shop with us')}</span>
        <h2 class="pdp__why-h">${esc(t('pdp.why_title') || 'The tradition, carried faithfully — and made at the source')}</h2>
        <p class="pdp__why-sub">${esc(t('pdp.why_sub') || '')}</p>
        <div class="pdp__pillars">${pillar(1)}${pillar(2)}${pillar(3)}${pillar(4)}</div>
        <figure class="pdp__why-founder">
          <img src="assets/founder.jpg" alt="${esc((t('founder') || {}).signature || 'Dr. Praveen Rathi')}" class="pdp__why-portrait" data-fallback="assets/tree.svg" data-fallback-class="pdp__why-portrait--mark">
          <figcaption class="pdp__why-cred mono">${esc(t('footer.director') || '')}</figcaption>
        </figure>
      </div>
    </section>

    <section class="pdp__sec-block"><div class="wrap">
      <h2 class="pdp__h2 pdp__h2--center">${esc(t('pdp.assure_title') || 'Ordering with confidence')}</h2>
      <div class="pdp__assures">
        ${assure(t('pdp.ship_label') || 'EU delivery', t('pdp.ship_text') || 'Tracked shipping to all 27 EU member states.')}
        ${assure(t('pdp.secure_label') || 'Made at the source', t('pdp.secure_text') || 'Crafted in India to classical Ayurvedic texts.')}
        ${assure(t('pdp.returns_label') || 'Honest labelling', t('pdp.returns_text') || 'Ingredients and traditional use listed openly.')}
        ${assure(t('pdp.help_label') || 'Here to help', t('pdp.help_text') || 'Questions before you buy? Reach us any time.')}
      </div>
    </div></section>

    ${related.length ? `<section class="pdp__sec-block"><div class="wrap">
      <h2 class="pdp__h2">${esc(t('pdp.related') || 'You may also like')}</h2>
      <div class="grid pdp__related-grid">${related.map((x, i) => cardHTML(x, i)).join('')}</div>
    </div></section>` : ''}

    <section class="pdp__sec-block pdp__sec-alt"><div class="wrap pdp__sec-narrow">
      <h2 class="pdp__h2">${esc(t('pdp.faq_title') || 'Frequently asked questions')}</h2>
      <div class="pdp__faqs">${faqItem(1)}${faqItem(2)}${pdpFaq(5)}${pdpFaq(6)}${faqItem(3)}${faqItem(4)}${trustFaqHTML()}</div>
      <p class="pdp__newto"><span>${esc(t('pdp.new_to') || 'New to Ayurveda?')}</span> <button class="pdp__newto-cta" data-pdp-learn>${esc(t('pdp.new_to_cta') || 'Start with the basics')} <span class="arr">→</span></button></p>
    </div></section>

    <div class="pdp__sticky" id="pdp-sticky" aria-hidden="true">
      <div class="pdp__sticky-info">
        ${imgs[0] ? `<img src="${thumb(imgs[0], 90)}" alt="" class="pdp__sticky-img">` : ''}
        <div class="pdp__sticky-meta"><span class="pdp__sticky-name">${esc(pTitle(p))}</span><span class="pdp__sticky-price">${p.price_eur != null ? money(p.price_eur) : ''}</span></div>
      </div>
      <button class="btn btn--solid pdp__sticky-add" data-pdp-add>${esc(t('shop.add') || 'Add to cart')}</button>
    </div>
  </div>`;
}
function openProductPage(id, push) {
  const p = state.catalog.products.find(x => x.id == id); if (!p) return;
  state.pdp = p;
  $('#pdp').innerHTML = renderPDP(p);
  const top = $('main#top'); if (top) top.hidden = true;
  $('#pdp').hidden = false;
  // sticky mobile buy-bar: reveal once the inline Add-to-cart scrolls out of view
  const anchor = $('#pdp-add'), sticky = $('#pdp-sticky');
  if (anchor && sticky && 'IntersectionObserver' in window) {
    if (state._pdpIO) state._pdpIO.disconnect();
    state._pdpIO = new IntersectionObserver(es => es.forEach(en => sticky.classList.toggle('is-visible', !en.isIntersecting)), { rootMargin: '-72px 0px 0px 0px' });
    state._pdpIO.observe(anchor);
  }
  if (push !== false) history.pushState({ product: String(id) }, '', '?product=' + id);
  document.title = pTitle(p) + ' · Sangam Herbals';
  window.scrollTo(0, 0);
  announce(pTitle(p));
}
function closeProductPage(push) {
  $('#pdp').hidden = true; $('#pdp').innerHTML = '';
  const top = $('main#top'); if (top) top.hidden = false;
  if (push !== false) history.pushState({}, '', location.pathname);
  document.title = t('seo.title') || 'Sangam Herbals';
}

/* ---------- cart ---------- */
function getCart() { try { return JSON.parse(localStorage.getItem(LS.cart) || '[]'); } catch { return []; } }
function setCart(c) { localStorage.setItem(LS.cart, JSON.stringify(c)); renderCart(); }
function addToCart(id, fromImg, qty = 1) { id = String(id); qty = Math.max(1, parseInt(qty) || 1); const c = getCart(); const it = c.find(x => x.id == id); if (it) it.q += qty; else c.push({ id, q: qty }); setCart(c); const p = state.catalog.products.find(x => x.id == id); announce(`${p ? pTitle(p) : ''} — ${t('shop.added') || 'Added'}`); if (fromImg) flyToCart(fromImg); else flashCart(); }
function flashCart() { const b = $('#cart-btn'); b.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.22)' }, { transform: 'scale(1)' }], { duration: 340 }); }
function flyToCart(img) {
  if (RM.matches || !img || !img.src) return flashCart();
  const g = $('#ghost'); const r = img.getBoundingClientRect(); const cart = $('#cart-btn').getBoundingClientRect();
  g.style.cssText += `;display:block;background-image:url('${img.src}');background-size:contain;background-repeat:no-repeat;background-position:center;`;
  g.animate([
    { left: r.left + r.width / 2 - 27 + 'px', top: r.top + r.height / 2 - 27 + 'px', opacity: .95, transform: 'scale(1)' },
    { left: cart.left + cart.width / 2 - 27 + 'px', top: cart.top + cart.height / 2 - 27 + 'px', opacity: .2, transform: 'scale(.3)' },
  ], { duration: 560, easing: 'cubic-bezier(.5,0,.6,1)' }).finished.then(() => { g.style.display = 'none'; flashCart(); });
}
function renderCart() {
  const c = getCart(); const count = c.reduce((a, x) => a + x.q, 0);
  const cc = $('#cart-count'); cc.textContent = count; cc.hidden = count === 0;
  let total = 0;
  $('#cart-items').innerHTML = c.map(x => {
    const p = state.catalog.products.find(pp => pp.id == x.id); if (!p) return '';
    total += (p.price_eur || 0) * x.q;
    return `<div class="cart-item">${p.image ? `<img src="${thumb(p.image, 120)}" alt="">` : ''}
      <div><div class="cart-item__t">${esc(pTitle(p))}</div><div class="cart-item__p">${x.q} × ${EUR(p.price_eur || 0)}</div></div>
      <button class="cart-item__rm" data-rm="${x.id}" aria-label="Remove">×</button></div>`;
  }).join('');
  $('#cart-empty').hidden = c.length !== 0;
  $('#cart-total').textContent = EUR(total);
  // free-ship progress
  const ship = $('#cart-ship'); const remain = Math.max(0, FREE_SHIP - total);
  ship.style.setProperty('--p', Math.min(1, total / FREE_SHIP));
  $('#cart-ship-text').textContent = c.length === 0 ? '' : (remain > 0 ? `${t('cart.add_more') || 'Add'} ${EUR(remain)} ${t('cart.free_ship') || 'for free EU shipping'}` : (t('cart.free_unlocked') || '✓ Free EU shipping unlocked'));
  ship.hidden = c.length === 0;
}

/* ---------- wire ---------- */
function wireUI() {
  const header = $('#header'), prog = $('#scroll-progress');
  const onScroll = () => {
    header.classList.toggle('scrolled', scrollY > 24);
    const max = document.documentElement.scrollHeight - innerHeight;
    prog.style.setProperty('--p', max > 0 ? (scrollY / max).toFixed(4) : 0);
  };
  onScroll(); addEventListener('scroll', onScroll, { passive: true });

  $('#region-btn').addEventListener('click', openGate);
  $('#region-btn-2')?.addEventListener('click', openGate);
  $('#search-btn').addEventListener('click', () => { $('#shop').scrollIntoView({ behavior: 'smooth' }); setTimeout(() => $('#search-input').focus(), 500); });

  // hero search mirrors shop search
  const applyQuery = v => { state.filter.query = v; state.shown = 24; $('#search-input').value = v; $('#hero-search').value = v; renderTokens(); renderGrid(); $('#hero-count').textContent = v ? `${filtered().length} ${t('shop.results')}` : ''; };
  let to; const debounced = v => { clearTimeout(to); to = setTimeout(() => applyQuery(v), 170); };
  let to2;
  const scrollToShop = () => { const shop = $('#shop'); if (shop) shop.scrollIntoView({ behavior: 'smooth' }); };
  $('#hero-search').addEventListener('input', e => { debounced(e.target.value); clearTimeout(to2); if (e.target.value) to2 = setTimeout(scrollToShop, 500); });
  $('#hero-search-form').addEventListener('submit', e => { e.preventDefault(); const v = $('#hero-search').value.trim(); if (v) { applyQuery(v); scrollToShop(); } });
  $('#search-input').addEventListener('input', e => debounced(e.target.value));
  $('#hero-chips').addEventListener('click', e => { const b = e.target.closest('[data-section]'); if (!b) return; setSection(b.dataset.section); $('#shop').scrollIntoView({ behavior: 'smooth' }); });

  function setSection(s) { state.filter.section = s; state.filter.subcat = null; state.filter.concern = null; state.shown = 24; renderChips(); renderTokens(); renderGrid(); }
  function setConcern(key) { state.filter.concern = key; state.filter.section = 'all'; state.filter.subcat = null; state.filter.query = ''; $('#search-input').value = ''; $('#hero-search').value = ''; $('#hero-count').textContent = ''; state.shown = 24; renderChips(); renderTokens(); renderGrid(); $('#shop').scrollIntoView({ behavior: 'smooth' }); announce(`${concernLabel(key)} — ${filtered().length} ${t('shop.results') || ''}`); }

  // shop-by-concern tiles + herb "shop this" buttons (also work from the product page)
  const leavePdpIfOpen = () => { if (!$('#pdp').hidden) closeProductPage(); };
  document.addEventListener('click', e => {
    if (e.target.closest('[data-browse-all]')) { leavePdpIfOpen(); state.filter = { section: 'all', subcat: null, concern: null, query: '', sort: state.filter.sort }; $('#search-input').value = ''; $('#hero-search').value = ''; $('#hero-count').textContent = ''; state.shown = 24; renderChips(); renderTokens(); renderGrid(); $('#shop').scrollIntoView({ behavior: 'smooth' }); return; }
    const con = e.target.closest('[data-concern]'); if (con) { leavePdpIfOpen(); setConcern(con.dataset.concern); return; }
    const herb = e.target.closest('[data-query]'); if (herb) { leavePdpIfOpen(); state.filter.concern = null; state.filter.section = 'all'; state.filter.subcat = null; applyQuery(herb.dataset.query); $('#shop').scrollIntoView({ behavior: 'smooth' }); }
  });

  $('#chips').addEventListener('click', e => {
    const sec = e.target.closest('[data-section]'), sub = e.target.closest('[data-subcat]');
    if (sub) { state.filter.subcat = state.filter.subcat === sub.dataset.subcat ? null : sub.dataset.subcat; state.shown = 24; renderChips(); renderTokens(); renderGrid(); }
    else if (sec) setSection(sec.dataset.section);
  });
  $('#pillars').addEventListener('click', e => { const p = e.target.closest('[data-section]'); if (!p) return; setSection(p.dataset.section); $('#shop').scrollIntoView({ behavior: 'smooth' }); });
  $('#footer-cats').addEventListener('click', e => { const a = e.target.closest('[data-section]'); if (!a) return; setSection(a.dataset.section); });
  $('#dosha-cards').addEventListener('click', e => {
    const btn = e.target.closest('[data-dosha]'); if (!btn) return;
    const d = btn.dataset.dosha;
    state.filter.dosha = state.filter.dosha === d ? null : d;
    state.filter.section = 'all'; state.filter.subcat = null; state.filter.concern = null;
    state.shown = 24; renderDoshas(); renderChips(); renderTokens(); renderGrid();
    $('#shop').scrollIntoView({ behavior: 'smooth' });
    announce((t(`doshas.${d}`) || d) + ' — ' + filtered().length + ' ' + (t('shop.results') || 'products'));
  });
  $('#filter-tokens').addEventListener('click', e => {
    const tkn = e.target.closest('[data-token]'); if (!tkn) return; const k = tkn.dataset.token;
    if (k === 'dosha') { state.filter.dosha = null; renderDoshas(); }
    else if (k === 'concern') state.filter.concern = null; else if (k === 'section') { state.filter.section = 'all'; state.filter.subcat = null; } else if (k === 'subcat') state.filter.subcat = null; else if (k === 'query') applyQuery('');
    state.shown = 24; renderChips(); renderTokens(); renderGrid();
  });
  $('#sort-select').addEventListener('change', e => { state.filter.sort = e.target.value; renderGrid(); });
  $('#load-more').addEventListener('click', () => { state.shown += 24; renderGrid(); });
  $('#clear-filters').addEventListener('click', () => { state.filter = { section: 'all', subcat: null, concern: null, dosha: null, query: '', sort: 'featured' }; $('#search-input').value = ''; $('#hero-search').value = ''; $('#hero-count').textContent = ''; state.shown = 24; renderDoshas(); renderChips(); renderTokens(); renderGrid(); });
  $('#rail-toggle').addEventListener('click', () => { const r = $('#rail'); const open = r.classList.toggle('open'); $('#rail-toggle').setAttribute('aria-expanded', open); });

  const cardAdd = (add) => { const card = add.closest('.card'); addToCart(add.dataset.add, card && card.querySelector('img')); add.classList.add('added'); add.textContent = '✓ ' + (t('shop.added') || 'Added'); setTimeout(() => { add.classList.remove('added'); add.textContent = t('shop.add'); }, 1000); };
  $('#product-grid').addEventListener('click', e => {
    const add = e.target.closest('[data-add]');
    if (add) { e.stopPropagation(); cardAdd(add); return; }
    const card = e.target.closest('.card'); if (card) openProductPage(card.dataset.id);
  });
  $('#product-grid').addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.card');
    if (card && !e.target.closest('[data-add]')) { e.preventDefault(); openProductPage(card.dataset.id); }
  });

  // product page: back, image thumbs, quantity, add-to-cart (inline + sticky), authority, related cards
  const pdpAdd = (btn) => {
    if (!state.pdp) return;
    addToCart(state.pdp.id, $('#pdp-img'), pdpQty());
    const label = t('shop.add') || 'Add to cart';
    btn.classList.add('added'); btn.textContent = '✓ ' + (t('shop.added') || 'Added');
    setTimeout(() => { btn.classList.remove('added'); btn.textContent = label; }, 1100);
    updatePdpShip();
  };
  $('#pdp').addEventListener('click', e => {
    if (e.target.closest('[data-pdp-back]')) { history.back(); return; }
    if (e.target.closest('[data-pdp-learn]')) { closeProductPage(); const l = $('#learn'); if (l) l.scrollIntoView({ behavior: 'smooth' }); return; }
    if (e.target.closest('[data-pdp-why]')) { const w = $('.pdp__why'); if (w) w.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const q = e.target.closest('[data-qty]');
    if (q) { const el = $('#pdp-qty'); let n = (parseInt(el.textContent) || 1) + parseInt(q.dataset.qty); el.textContent = Math.max(1, Math.min(99, n)); return; }
    const pa = e.target.closest('[data-pdp-add]'); if (pa) { pdpAdd(pa); return; }
    const th = e.target.closest('[data-pdp-thumb]');
    if (th) { const img = $('#pdp-img'); if (img) img.src = thumb(th.dataset.pdpThumb, 860); $$('.pdp__thumb').forEach(x => x.classList.toggle('is-active', x === th)); return; }
    const add = e.target.closest('[data-add]'); if (add) { e.stopPropagation(); cardAdd(add); updatePdpShip(); return; }
    const card = e.target.closest('.pairc, .card'); if (card && card.dataset.id) { openProductPage(card.dataset.id); return; }
  });
  // browser back/forward between home and product pages
  addEventListener('popstate', () => {
    const id = new URLSearchParams(location.search).get('product');
    if (id) openProductPage(id, false); else closeProductPage(false);
  });

  $$('[data-close]').forEach(el => el.addEventListener('click', () => vt(closeModal)));
  const openCart = () => { $('#cart-drawer').hidden = false; openDialog($('#cart-drawer .drawer__panel')); };
  const closeCart = () => { if ($('#cart-drawer').hidden) return; $('#cart-drawer').hidden = true; closeDialog($('#cart-drawer .drawer__panel')); };
  const closeNav = () => { if ($('#nav-drawer').hidden) return; $('#nav-drawer').hidden = true; closeDialog($('.nav-drawer__panel')); };
  $('#cart-btn').addEventListener('click', openCart);
  $$('[data-close-cart]').forEach(el => el.addEventListener('click', closeCart));
  $('#cart-items').addEventListener('click', e => { const rm = e.target.closest('[data-rm]'); if (rm) setCart(getCart().filter(x => x.id != rm.dataset.rm)); });
  $('#nav-toggle').addEventListener('click', () => { $('#nav-drawer').hidden = false; openDialog($('.nav-drawer__panel')); });
  $$('[data-close-nav]').forEach(el => el.addEventListener('click', closeNav));
  // checkout
  $('#cart-checkout')?.addEventListener('click', () => { closeCart(); openCheckout(); });
  $$('[data-close-checkout]').forEach(el => el.addEventListener('click', closeCheckout));
  $('#co-wa')?.addEventListener('click', orderViaWhatsApp);
  $('#co-email')?.addEventListener('click', orderViaEmail);
  $('#co-pay-card')?.addEventListener('click', startStripe);
  // order tracking
  $('#footer-track')?.addEventListener('click', (e) => { e.preventDefault(); openTracking(); });
  $('#track-form')?.addEventListener('submit', (e) => { e.preventDefault(); lookupOrder(); });
  $$('[data-close-track]').forEach(el => el.addEventListener('click', closeTracking));
  // newsletter
  $('#dispatch-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const email = form.querySelector('input[type="email"]').value.trim();
    const msg = $('#dispatch-msg');
    if (!email || !msg) return;
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    msg.hidden = true;
    const cfg = window.SH_CONFIG || {};
    try {
      const res = await fetch(`${cfg.supabaseUrl}/rest/v1/newsletter_subscribers`, {
        method: 'POST',
        headers: {
          'apikey': cfg.supabaseAnonKey,
          'Authorization': 'Bearer ' + cfg.supabaseAnonKey,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates',
        },
        body: JSON.stringify({ email }),
      });
      if (res.ok || res.status === 201) {
        msg.textContent = t('footer.subscribed') || '✓ You\'re subscribed!';
        msg.className = 'dispatch__msg dispatch__msg--ok';
        msg.hidden = false;
        form.reset();
      } else {
        const err = await res.json().catch(() => ({}));
        msg.textContent = err.message || (t('footer.subscribe_err') || 'Something went wrong. Try again.');
        msg.className = 'dispatch__msg dispatch__msg--err';
        msg.hidden = false;
      }
    } catch {
      msg.textContent = t('footer.subscribe_err') || 'Network error. Please try again.';
      msg.className = 'dispatch__msg dispatch__msg--err';
      msg.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
  // high-demand notice (dismissible, remembered)
  const notice = $('#site-notice');
  if (notice && !localStorage.getItem('sh_notice')) notice.hidden = false;
  $('#notice-close')?.addEventListener('click', () => { if (notice) notice.hidden = true; localStorage.setItem('sh_notice', '1'); });
  addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const gate = $('#gate'), gc = $('#gate-close');
    if (gate && !gate.hidden) { if (gc && !gc.hidden) closeGate(); return; } // only close when not stranding a first visit
    if (!$('#track-modal').hidden) closeTracking();
    else if (!$('#checkout-modal').hidden) closeCheckout();
    else if (!$('#product-modal').hidden) closeModal();
    else if (!$('#cart-drawer').hidden) closeCart();
    else if (!$('#nav-drawer').hidden) closeNav();
  });

  renderCart();
}

/* ---------- checkout ---------- */
const SHIP_FLAT = 4.90; // indicative shipping below the free-shipping threshold (EUR)
const shippingEur = sub => sub >= FREE_SHIP ? 0 : SHIP_FLAT;
const cfg = (k, d) => (window.SH_CONFIG && window.SH_CONFIG[k]) || d;

function openCheckout() {
  if (!getCart().length) { announce(t('checkout.empty') || 'Your cart is empty.'); return; }
  renderCheckout();
  $('#checkout-modal').hidden = false;
  openDialog($('#checkout-modal .checkout__card'));
}
function closeCheckout() { if ($('#checkout-modal').hidden) return; $('#checkout-modal').hidden = true; closeDialog($('#checkout-modal .checkout__card')); }

function renderCheckout() {
  const cart = getCart();
  const lines = cart.map(it => { const p = state.catalog.products.find(z => z.id == it.id); return p ? { p, q: it.q, line: (p.price_eur || 0) * it.q } : null; }).filter(Boolean);
  $('#co-items').innerHTML = lines.map(l => `<div class="co-item"><span class="co-item__n">${esc(pTitle(l.p))} <span class="co-item__q mono">×${l.q}</span></span><span class="co-item__p mono">${EUR(l.line)}</span></div>`).join('');
  const sub = lines.reduce((a, l) => a + l.line, 0); const ship = shippingEur(sub);
  $('#co-subtotal').textContent = EUR(sub);
  $('#co-shipping').textContent = ship === 0 ? (t('checkout.free') || 'Free') : EUR(ship);
  $('#co-total').textContent = EUR(sub + ship);
  // country select (built once; preselect the gate region)
  const sel = $('#co-country');
  if (sel && !sel.dataset.built) {
    sel.innerHTML = state.regions.countries.slice().sort((a, b) => a[1].localeCompare(b[1])).map(c => `<option value="${c[0]}">${esc(c[1])}</option>`).join('');
    sel.dataset.built = '1';
  }
  if (sel && state.region) sel.value = state.region;
  // card / PayPal buttons appear only once the owner pastes public keys (else WhatsApp/email)
  setupPayments();
}

function checkoutData() {
  const v = id => ($('#' + id) || {}).value || '';
  return { name: v('co-name').trim(), email: v('co-email').trim(), phone: v('co-phone').trim(), country: v('co-country'), address: v('co-address').trim(), city: v('co-city').trim(), postal: v('co-postal').trim(), note: v('co-note').trim() };
}
function validateCheckout() {
  const d = checkoutData(); const miss = [];
  if (!d.name) miss.push('name'); if (!/.+@.+\..+/.test(d.email)) miss.push('email');
  if (!d.address) miss.push('address'); if (!d.city) miss.push('city'); if (!d.postal) miss.push('postal');
  const err = $('#co-error');
  if (miss.length) { if (err) { err.hidden = false; err.textContent = t('checkout.fill_required') || 'Please add your name, a valid email, and your full address.'; } $('#co-' + miss[0])?.focus(); return null; }
  if (err) err.hidden = true; return d;
}
const newOrderId = () => (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : (String(Date.now()) + Math.random().toString(16).slice(2));
const trackUrl = (id) => `${location.origin}${location.pathname}?track=${id}`;
function orderText(ref) {
  const d = checkoutData(); const cart = getCart();
  const lines = cart.map(it => { const p = state.catalog.products.find(z => z.id == it.id); return p ? `• ${pTitle(p)} ×${it.q} — ${EUR((p.price_eur || 0) * it.q)}` : null; }).filter(Boolean);
  const sub = cartTotalEur(); const ship = shippingEur(sub);
  const c = state.regions.countries.find(x => x[0] === d.country);
  return [
    t('checkout.wa_intro') || 'New order — Sangam Herbals', '',
    ...lines, '',
    `${t('checkout.subtotal') || 'Subtotal'}: ${EUR(sub)}`,
    `${t('checkout.shipping') || 'Shipping'}: ${ship === 0 ? (t('checkout.free') || 'Free') : EUR(ship)}`,
    `${t('checkout.total') || 'Total'}: ${EUR(sub + ship)}`, '',
    `${t('checkout.name') || 'Name'}: ${d.name}`,
    `${t('checkout.email') || 'Email'}: ${d.email}`,
    d.phone ? `${t('checkout.phone') || 'Phone'}: ${d.phone}` : '',
    `${t('checkout.country') || 'Country'}: ${c ? c[1] : d.country}`,
    `${t('checkout.address') || 'Address'}: ${d.address}, ${d.city} ${d.postal}`,
    d.note ? `${t('checkout.note') || 'Note'}: ${d.note}` : '',
    ref ? '' : false, ref ? `${t('track.ref_label') || 'Order reference'}: ${ref}` : false,
    ref ? `${t('checkout.track_cta') || 'Track your order'}: ${trackUrl(ref)}` : false,
  ].filter(x => x !== false && x != null).join('\n');
}
function orderBody(d, method, id) {
  const cart = getCart(); const sub = cartTotalEur(); const ship = shippingEur(sub);
  const items = cart.map(it => { const p = state.catalog.products.find(z => z.id == it.id); return { id: it.id, title: p ? pTitle(p) : it.id, qty: it.q, price_eur: p ? p.price_eur : null }; });
  const b = { status: 'pending', payment_method: method, name: d.name, email: d.email, phone: d.phone, country: d.country, address: { line: d.address, city: d.city, postal: d.postal }, items, subtotal_eur: sub, shipping_eur: ship, total_eur: +(sub + ship).toFixed(2), currency: regionCurrency(), locale: state.lang, note: d.note };
  if (id) b.id = id; return b;
}
// best-effort save to Supabase orders (if configured); never blocks or throws. Returns the POST promise.
function saveOrder(d, method, id) {
  const url = cfg('supabaseUrl'), key = cfg('supabaseAnonKey'); if (!url || !key) return Promise.resolve();
  try {
    return fetch(url.replace(/\/$/, '') + '/rest/v1/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + key, Prefer: 'return=minimal' }, body: JSON.stringify(orderBody(d, method, id)) }).catch(() => {});
  } catch (e) { return Promise.resolve(); }
}
function orderViaWhatsApp() {
  const d = validateCheckout(); if (!d) return;
  const id = newOrderId(); saveOrder(d, 'whatsapp', id);
  const num = String(cfg('whatsapp', '919910602959')).replace(/[^0-9]/g, '');
  window.open(`https://wa.me/${num}?text=${encodeURIComponent(orderText(id))}`, '_blank', 'noopener');
  showCheckoutSuccess(id);
}
function orderViaEmail() {
  const d = validateCheckout(); if (!d) return;
  const id = newOrderId(); saveOrder(d, 'email', id);
  const to = cfg('orderEmail', 'sangamherbals@gmail.com');
  window.location.href = `mailto:${to}?subject=${encodeURIComponent(t('checkout.email_subject') || 'New order — Sangam Herbals')}&body=${encodeURIComponent(orderText(id))}`;
  showCheckoutSuccess(id);
}

/* ---------- card payments (Stripe / PayPal) — active only once keys are added ---------- */
function setupPayments() {
  const card = $('#co-pay-card');
  const stripeReady = cfg('stripeCheckoutUrl') && cfg('supabaseUrl') && cfg('supabaseAnonKey');
  if (card) card.hidden = !stripeReady;
  if (cfg('paypalClientId')) mountPayPal();
}
// Stripe hosted Checkout: create a pending order, then the Edge Function (which re-verifies
// the price from the DB) returns a Checkout URL we redirect to. Secret key stays server-side.
async function startStripe() {
  const d = validateCheckout(); if (!d) return;
  const ep = cfg('stripeCheckoutUrl'), url = cfg('supabaseUrl'), key = cfg('supabaseAnonKey');
  if (!ep || !url || !key) return;
  const err = $('#co-error'); const id = (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
  const btn = $('#co-pay-card'); if (btn) { btn.disabled = true; btn.textContent = t('checkout.redirecting') || 'Redirecting…'; }
  try {
    const ins = await fetch(url.replace(/\/$/, '') + '/rest/v1/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + key, Prefer: 'return=minimal' }, body: JSON.stringify(orderBody(d, 'stripe', id)) });
    if (!ins.ok) throw 0;
    const r = await fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_id: id }) });
    const j = await r.json();
    if (j && j.url) { window.location.href = j.url; return; }
    throw 0;
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = t('checkout.pay_card') || 'Pay by card'; }
    if (err) { err.hidden = false; err.textContent = t('checkout.pay_error') || 'Payment could not start. Please order via WhatsApp or email.'; }
  }
}
let _ppLoaded = false;
function mountPayPal() {
  const slot = $('#co-paypal'); if (!slot) return; slot.hidden = false;
  const render = () => {
    if (!window.paypal || slot.dataset.rendered) return;
    slot.dataset.rendered = '1'; slot.innerHTML = '';
    window.paypal.Buttons({
      style: { layout: 'horizontal', color: 'gold', shape: 'rect', height: 42, tagline: false },
      onClick: (data, actions) => validateCheckout() ? undefined : actions.reject(),
      createOrder: (data, actions) => { const sub = cartTotalEur(); return actions.order.create({ purchase_units: [{ amount: { currency_code: 'EUR', value: (sub + shippingEur(sub)).toFixed(2) } }] }); },
      onApprove: async (data, actions) => {
        const d = validateCheckout(); if (!d) return;
        const id = (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
        await saveOrder(d, 'paypal', id);
        try { await actions.order.capture(); } catch (e) {}
        const v = cfg('paypalVerifyUrl'); if (v) { try { await fetch(v, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_id: id, paypal_order_id: data.orderID }) }); } catch (e) {} }
        showCheckoutSuccess(id);
      },
    }).render(slot);
  };
  if (window.paypal) return render();
  if (_ppLoaded) return; _ppLoaded = true;
  const s = document.createElement('script'); s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(cfg('paypalClientId'))}&currency=EUR`; s.onload = render; document.head.appendChild(s);
}
/* ---------- post-purchase: confirmation peak + order tracking (WISMO) ---------- */
const TRACK_STAGES = ['received', 'confirmed', 'preparing', 'dispatched', 'delivered'];
function statusToStage(status) {
  switch (String(status || '').toLowerCase()) {
    case 'pending': case 'received': return 0;
    case 'paid': case 'confirmed': return 1;
    case 'preparing': case 'packing': return 2;
    case 'dispatched': case 'shipped': return 3;
    case 'delivered': case 'fulfilled': return 4;
    case 'cancelled': case 'canceled': return -1;
    default: return 0;
  }
}
function pickTip(seed) {
  const tips = t('checkout.success_tips'); const arr = Array.isArray(tips) ? tips : [];
  if (!arr.length) return '';
  let h = 0; const s = String(seed || 'x'); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return arr[h % arr.length];
}
function renderTimeline(stage) {
  return `<ol class="tl">${TRACK_STAGES.map((s, i) => {
    const cls = i < stage ? 'is-done' : (i === stage ? 'is-current' : '');
    return `<li class="tl__step ${cls}"><span class="tl__dot" aria-hidden="true"></span><span class="tl__label">${esc(t('track.stage_' + s) || s)}</span></li>`;
  }).join('')}</ol>`;
}
function showCheckoutSuccess(ref) {
  setCart([]);
  const card = $('#checkout-modal .checkout__card'); if (!card) return;
  const shortRef = ref ? String(ref).slice(0, 8).toUpperCase() : '';
  card.innerHTML = `<button class="modal__close" data-close-checkout aria-label="Close">×</button>
    <div class="co-done">
      <p class="co-done__eyebrow mono">${esc(t('checkout.success_eyebrow') || 'Order received')}</p>
      <h2 class="co-done__title">${esc(t('checkout.success_title') || 'Thank you — your order is confirmed.')}</h2>
      <p class="co-done__reassure">${esc(t('checkout.success_reassure') || '')}</p>
      ${ref ? `<p class="co-done__ref mono">${esc(t('track.ref_label') || 'Order reference')} · <b>${esc(shortRef)}</b></p>` : ''}
      <div class="co-block">
        <p class="co-block__h mono">${esc(t('checkout.next_title') || 'What happens next')}</p>
        ${renderTimeline(0)}
      </div>
      <div class="co-ritual">
        <p class="co-ritual__h mono">${esc(t('checkout.ritual_title') || 'While you wait — a small ritual')}</p>
        <p class="co-ritual__t">${esc(pickTip(ref))}</p>
      </div>
      <div class="co-done__cta">
        ${ref ? `<button class="btn btn--solid" data-track="${esc(ref)}">${esc(t('checkout.track_cta') || 'Track your order')} <span class="arr" aria-hidden="true">→</span></button>` : ''}
        <a class="btn btn--outline" href="#learn" data-close-checkout>${esc(t('checkout.keep_shopping') || 'Keep shopping')}</a>
      </div>
      <p class="co-done__founder mono">${esc(t('checkout.founder_note') || '')}</p>
    </div>`;
  $$('#checkout-modal [data-close-checkout]').forEach(el => el.addEventListener('click', closeCheckout));
  $('#checkout-modal [data-track]')?.addEventListener('click', (e) => { closeCheckout(); openTracking(e.currentTarget.dataset.track); });
  $('#checkout-modal').hidden = false; openDialog(card);
}
function openTracking(prefill) {
  const m = $('#track-modal'); if (!m) return;
  const out = $('#track-result'); if (out) out.innerHTML = '';
  const inp = $('#track-ref'); if (inp && prefill) inp.value = prefill;
  m.hidden = false; openDialog($('#track-modal .track__card'));
  if (prefill) lookupOrder(prefill); else inp?.focus();
}
function closeTracking() { const m = $('#track-modal'); if (!m || m.hidden) return; m.hidden = true; closeDialog($('#track-modal .track__card')); }
async function lookupOrder(refRaw) {
  const ref = String(refRaw != null ? refRaw : ($('#track-ref') ? $('#track-ref').value : '')).trim();
  const out = $('#track-result'); if (!out) return;
  if (!ref) { out.innerHTML = ''; return; }
  const url = cfg('supabaseUrl'), key = cfg('supabaseAnonKey');
  out.innerHTML = `<p class="track__status">${esc(t('track.searching') || 'Looking up your order…')}</p>`;
  if (!url || !key) { out.innerHTML = `<p class="track__status">${esc(t('track.not_found') || 'Order not found.')}</p>`; return; }
  try {
    const r = await fetch(url.replace(/\/$/, '') + '/rest/v1/rpc/get_order_status', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + key }, body: JSON.stringify({ p_id: ref }) });
    const rows = await r.json();
    const o = Array.isArray(rows) ? rows[0] : rows;
    if (!o || !o.status) { out.innerHTML = `<p class="track__status">${esc(t('track.not_found') || 'Order not found.')}</p>`; return; }
    renderTrackResult(ref, o);
  } catch (e) { out.innerHTML = `<p class="track__status">${esc(t('track.not_found') || 'Order not found.')}</p>`; }
}
function renderTrackResult(ref, o) {
  const out = $('#track-result'); if (!out) return;
  const stage = statusToStage(o.status);
  const placed = o.created_at ? new Date(o.created_at).toLocaleDateString() : '';
  const num = String(cfg('whatsapp', '919910602959')).replace(/[^0-9]/g, '');
  let html = `<div class="track__head"><span class="track__ref mono">${esc(t('track.ref_label') || 'Order reference')} · ${esc(String(ref).slice(0, 8).toUpperCase())}</span>${placed ? `<span class="track__placed mono">${esc(t('track.placed_on') || 'Placed')} ${esc(placed)}</span>` : ''}</div>`;
  if (stage < 0) {
    html += `<p class="track__cancel">${esc(t('track.cancelled') || 'This order was cancelled.')}</p>`;
  } else {
    html += renderTimeline(stage);
    if (stage >= 3 && o.tracking_number) {
      html += `<div class="track__parcel"><p class="track__on">${esc(t('track.on_its_way') || 'Your parcel is on its way.')}</p><p class="mono track__num">${esc(t('track.tracking_number') || 'Tracking number')}: <b>${esc(o.tracking_number)}</b></p>${o.tracking_url ? `<a class="link-cta" href="${esc(o.tracking_url)}" target="_blank" rel="noopener">${esc(t('track.track_parcel') || 'Track parcel →')}</a>` : ''}</div>`;
    } else if (stage >= 4) {
      html += `<p class="track__note">${esc(t('track.delivered_note') || 'Delivered.')}</p>`;
    } else {
      html += `<p class="track__note">${esc(t('track.eta_note') || '')}</p>`;
    }
  }
  html += `<p class="track__help"><a href="https://wa.me/${num}" target="_blank" rel="noopener">${esc(t('track.help') || 'Questions? Message us on WhatsApp.')}</a></p>`;
  out.innerHTML = html;
}
function handleCheckoutReturn() {
  const q = new URLSearchParams(location.search);
  const tr = q.get('track'), co = q.get('checkout');
  if (tr) { history.replaceState({}, '', location.pathname); openTracking(tr); return; }
  if (!co) return;
  history.replaceState({}, '', location.pathname);
  if (co === 'success') showCheckoutSuccess(q.get('order'));
  else if (co === 'cancel') announce(t('checkout.cancelled') || 'Payment cancelled — your cart is still here.');
}

/* ---------- reveal ---------- */
// Reusable: re-rendered sections (after a language/region switch) inject fresh .reveal
// blocks the boot observer never saw — call state._reveal() after any re-render so they
// get observed (and shown immediately if already in view) instead of staying at opacity:0.
function revealScan() {
  const els = $$('.reveal:not(.in)');
  if (!els.length) return;
  if (!('IntersectionObserver' in window) || !state._revealIO) { els.forEach(e => e.classList.add('in')); return; }
  els.forEach(e => state._revealIO.observe(e));
  requestAnimationFrame(() => { const vh = innerHeight || 800; els.forEach(e => { const r = e.getBoundingClientRect(); if (r.top < vh * 0.96 && r.bottom > 0) e.classList.add('in'); }); });
}
function initReveal() {
  if ('IntersectionObserver' in window) {
    state._revealIO = state._revealIO || new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); state._revealIO.unobserve(en.target); } }), { threshold: 0.08, rootMargin: '0px 0px -4% 0px' });
  }
  state._reveal = revealScan;
  revealScan();
}

boot();
