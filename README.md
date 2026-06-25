# Sangam Herbals — EU (sangamherbals.eu)

A modern, multilingual e-commerce catalogue for **Sangam Herbals**, serving all 27 EU member
states. Authentic Ayurvedic remedies, cosmetics, oils, foods and aromatherapy — crafted in
India, presented for Europe.

Static site: **no build step, no dependencies**. Pure HTML + CSS + vanilla JS. Deploys to any
static host (GitHub Pages, Cloudflare Pages, Netlify…).

## Features

- **Region + language gate** on first visit — 27 EU countries (flags) and all **24 official EU
  languages** (native scripts). Choice is remembered in `localStorage`.
- **Full real catalogue** — **339 products** across **5 sections / 30 categories**: 274 from the
  live Sangam Herbals store (Tilda) plus **65 additional SKUs** swept from the brand's full Ozon
  listing (256 products, paginated via `&page=N`) that the store doesn't carry — including the
  full **14-scent oil-perfume / attar line**, **hydrolats / floral waters**, **herbal lozenges**,
  body lotions, extra face gels, Kumkumadi oil, additional tablet formulas, spice blends and
  toothpaste variants. De-duplicated by Russian product name, real photos + prices throughout.
- **Complete UI localisation** into all 24 EU languages (`i18n/<code>.json`).
- Filterable shop (section + subcategory chips, search, sort), product detail modal, and a
  working cart (localStorage).
- Botanical-luxe design system, scroll reveals, real product imagery, fully responsive.

## Structure

```
index.html            – markup shell (content populated by JS via data-i18n keys)
assets/styles.css      – design system (CSS custom properties = design tokens)
assets/app.js          – gate, i18n loader, catalogue, filters, modal, cart
assets/logo.svg        – brand mark
data/catalog.json      – 274 products + 27 categories (the source of truth)
data/regions.json      – 27 EU countries + 24 languages
data/brand.json        – brand/marketing copy (reference)
data/design.json       – design-token reference
i18n/<code>.json       – UI strings per language (en is canonical source)
CNAME                  – sangamherbals.eu
```

## Run locally

```bash
npx serve .            # or: python3 -m http.server 8000
```
Open the served URL. (Must be served over HTTP — `fetch()` of the JSON files won't work from
`file://`.)

## Deploy

**GitHub Pages** (same setup as the other sites):
1. Create a repo, push these files to `main`.
2. Settings → Pages → deploy from `main` / root.
3. The `CNAME` file points the site at `sangamherbals.eu` — add the DNS records at your
   registrar (A records to GitHub Pages IPs, or a CNAME to `<user>.github.io`), then enable
   "Enforce HTTPS".

**Cloudflare Pages**: connect the repo, framework preset = *None*, build command = *(none)*,
output dir = `/`. Add `sangamherbals.eu` as a custom domain.

## Maintenance

- **Prices** are converted from the original RUB at a single FX constant `fx_rub_eur` in
  `data/catalog.json` (`price_eur` per product). Re-run the conversion or edit `price_eur`
  directly to set real EU retail pricing.
- **Add / edit products**: edit `data/catalog.json` (`products[]`). Each product:
  `id, title_en, title_ru, sku, price_eur, blurb_en, image, section_slug, category_uids`.
- **Add a language**: add it to `regions.json` and drop a translated `i18n/<code>.json`
  (copy `en.json`, translate the values).
- Product **names + blurbs** are English; all **UI chrome, navigation and category names** are
  localised per language. (Translating 274 product descriptions × 24 languages was out of scope;
  the structure supports it if desired.)

## Data provenance

- **Primary (274):** Sangam Herbals Tilda store API (sangamonline.ru), cleaned, categorised,
  priced in EUR, copy-written in English.
- **Ozon (65):** swept the brand's full Ozon listing (brand id 87306097) — 256 products paginated
  via `&page=N` in a real browser session (Ozon hard-blocks curl/WebFetch). Added only the 65 SKUs
  not present in the store, de-duplicated by normalised Russian name. Raw capture in `data/ozon.json`.
- Product images hot-link the original Tilda / Ozon CDNs — for production, re-host on your own CDN.
