/* ============================================================
   SANGAM HERBALS — ADMIN PANEL
   Single-page product manager · supabase-js v2 (ESM, CDN)
   Reads window.SH_CONFIG from assets/config.js
   ============================================================ */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/* ---------- contract constants ---------- */
const SECTIONS = [
  { slug: 'ayurveda',     en: 'Ayurveda',           ru: 'АЮРВЕДА' },
  { slug: 'cosmetics',    en: 'Cosmetics',          ru: 'КОСМЕТИКА' },
  { slug: 'food',         en: 'Food & Nutrition',   ru: 'ПРОДУКТЫ ПИТАНИЯ' },
  { slug: 'oils',         en: 'Oils',               ru: 'МАСЛА' },
  { slug: 'aromatherapy', en: 'Aromatherapy',       ru: 'АРОМАТЕРАПИЯ' },
];
const SECTION_BY_SLUG = Object.fromEntries(SECTIONS.map(s => [s.slug, s]));

const CONCERNS = [
  ['digestion', 'Digestion & Gut'], ['immunity', 'Immunity & Vitality'],
  ['energy', 'Strength & Energy'], ['respiratory', 'Respiratory & Seasonal'],
  ['stress', 'Stress, Sleep & Mind'], ['joints', 'Joints & Muscles'],
  ['womens', "Women's Wellbeing"], ['skin', 'Skin & Face'],
  ['hair', 'Hair & Scalp'], ['oral', 'Oral Care'],
  ['food', 'Food, Teas & Spices'], ['fragrance', 'Fragrance & Ritual'],
];
const CONCERN_KEYS = CONCERNS.map(c => c[0]);

const ORDER_STATUSES = ['pending', 'paid', 'confirmed', 'preparing', 'dispatched', 'delivered', 'cancelled'];
const STORAGE_BUCKET = 'product-images';

/* ---------- tiny DOM helpers ---------- */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return n;
}

/* ---------- toasts ---------- */
function toast(msg, kind = 'ok', ms = 4200) {
  const box = $('#toasts');
  const okIcon  = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M5 12l4.5 4.5L19 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const errIcon = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 7v6M12 17h.01" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/></svg>';
  const t = el('div', { class: `toast toast--${kind === 'err' ? 'err' : 'ok'}`, role: 'status' },
    el('span', { class: 'toast__icon', html: kind === 'err' ? errIcon : okIcon }),
    el('span', { class: 'toast__msg' }, msg)
  );
  box.append(t);
  const kill = () => { t.classList.add('is-out'); setTimeout(() => t.remove(), 240); };
  const timer = setTimeout(kill, ms);
  t.addEventListener('click', () => { clearTimeout(timer); kill(); });
}

/* ---------- confirm modal (replaces window.confirm) ---------- */
function confirmModal({ title = 'Are you sure?', sub = 'Confirm action', msg = '', okLabel = 'Delete', danger = true } = {}) {
  return new Promise(resolve => {
    const modal = $('#confirm-modal');
    const scrim  = $('#confirm-scrim');
    const titleEl = $('#confirm-title');
    const subEl  = $('#confirm-sub');
    const msgEl  = $('#confirm-msg');
    const okBtn  = $('#confirm-ok');
    const cancelBtn = $('#confirm-cancel');
    titleEl.textContent = title;
    subEl.textContent = sub;
    msgEl.textContent = msg;
    okBtn.textContent = okLabel;
    okBtn.className = 'btn ' + (danger ? 'btn--danger' : 'btn--solid');
    modal.hidden = false;
    document.body.classList.add('is-modal-open');
    const done = (result) => {
      modal.hidden = true;
      document.body.classList.remove('is-modal-open');
      cleanup();
      resolve(result);
    };
    const onScrim = () => done(false);
    const onOk    = () => done(true);
    const onCancel = () => done(false);
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    scrim.addEventListener('click', onScrim);
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey);
    function cleanup() {
      scrim.removeEventListener('click', onScrim);
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKey);
    }
    okBtn.focus();
  });
}

/* ---------- view switching ---------- */
function show(view) {
  ['view-notconfigured', 'view-login', 'view-dashboard', 'view-orders', 'view-settings'].forEach(id => {
    const n = $('#' + id); if (n) n.hidden = (id !== view);
  });
  $('#topbar').hidden = !(view === 'view-dashboard' || view === 'view-orders' || view === 'view-settings');
}

/* ============================================================
   BOOT
   ============================================================ */
const CFG = window.SH_CONFIG || {};
if (!CFG.supabaseUrl || !CFG.supabaseAnonKey) {
  show('view-notconfigured');
} else {
  startApp(CFG.supabaseUrl, CFG.supabaseAnonKey);
}

function startApp(url, anonKey) {
  const sb = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'sh-admin-auth' },
  });

  const state = {
    products: [],
    allOrders: [],
    query: '',
    activeFilter: 'all',  // 'all' | 'active' | 'hidden'
    sectionFilter: '',
    orderFilter: 'all',
    orderQuery: '',
  };

  /* ---------- auth gate ---------- */
  async function refreshAuth() {
    const { data: { session } } = await sb.auth.getSession();
    if (session?.user) {
      $('#who').textContent = session.user.email || 'Signed in';
      show('view-dashboard');
      loadProducts();
    } else {
      show('view-login');
    }
  }
  sb.auth.onAuthStateChange((_evt, session) => {
    if (session?.user) {
      $('#who').textContent = session.user.email || 'Signed in';
      show('view-dashboard');
    } else {
      show('view-login');
    }
  });

  /* ---------- navigation ---------- */
  const setTab = (which) => {
    $('#nav-products')?.classList.toggle('is-active', which === 'products');
    $('#nav-orders')?.classList.toggle('is-active', which === 'orders');
    $('#nav-settings')?.classList.toggle('is-active', which === 'settings');
  };
  $('#nav-products')?.addEventListener('click', () => { setTab('products'); show('view-dashboard'); });
  $('#nav-orders')?.addEventListener('click', () => { setTab('orders'); show('view-orders'); loadOrders(); });
  $('#nav-settings')?.addEventListener('click', () => { setTab('settings'); show('view-settings'); loadSettings(); });
  $('#orders-refresh')?.addEventListener('click', loadOrders);

  /* ---------- product filter tabs ---------- */
  $$('#prod-filter-tabs .filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('#prod-filter-tabs .filter-tab').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      state.activeFilter = btn.dataset.filter;
      renderList();
    });
  });

  /* ---------- section filter ---------- */
  $('#section-filter')?.addEventListener('change', (e) => {
    state.sectionFilter = e.target.value;
    renderList();
  });

  /* ---------- product search ---------- */
  $('#search').addEventListener('input', (e) => { state.query = e.target.value; renderList(); });
  $('#new-btn').addEventListener('click', () => openEditor(null));

  /* ---------- order filter tabs ---------- */
  $$('#order-filter-tabs .filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('#order-filter-tabs .filter-tab').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      state.orderFilter = btn.dataset.filter;
      renderOrders(state.allOrders);
    });
  });

  /* ---------- order search ---------- */
  $('#order-search')?.addEventListener('input', (e) => {
    state.orderQuery = e.target.value;
    renderOrders(state.allOrders);
  });

  /* ============================================================
     ORDERS
     ============================================================ */
  const fmtEUR = (n) => {
    try { return new Intl.NumberFormat('en', { style: 'currency', currency: 'EUR' }).format(n || 0); }
    catch { return (n || 0) + ' EUR'; }
  };

  async function loadOrders() {
    const list = $('#olist');
    if (list) list.innerHTML = '<div class="list-loading">Loading orders…</div>';
    const { data, error } = await sb.from('orders').select('*').order('created_at', { ascending: false }).limit(500);
    if (error) {
      if (list) list.innerHTML = `<div class="list-loading">Could not load orders: ${esc(error.message)}</div>`;
      return;
    }
    state.allOrders = data || [];
    renderOrders(state.allOrders);
  }

  function updateOrderStats(orders) {
    const pending = orders.filter(o => ['pending','paid'].includes(o.status || 'pending')).length;
    const dispatched = orders.filter(o => o.status === 'dispatched').length;
    const revenue = orders.filter(o => !['cancelled'].includes(o.status)).reduce((s, o) => s + (o.total_eur || 0), 0);
    const el = (id, v) => { const n = $('#' + id); if (n) n.textContent = v; };
    el('stat-orders-total', orders.length);
    el('stat-orders-pending', pending);
    el('stat-orders-dispatched', dispatched);
    el('stat-orders-revenue', fmtEUR(revenue));
  }

  function statusBadge(status) {
    return `<span class="status-badge status-badge--${esc(status || 'pending')}">${esc(status || 'pending')}</span>`;
  }

  function renderOrders(orders) {
    updateOrderStats(orders);

    // apply filter
    let list = orders;
    if (state.orderFilter !== 'all') {
      list = list.filter(o => (o.status || 'pending') === state.orderFilter);
    }
    // apply search
    const q = state.orderQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(o =>
        (o.name || '').toLowerCase().includes(q) ||
        (o.email || '').toLowerCase().includes(q) ||
        (o.phone || '').toLowerCase().includes(q)
      );
    }

    $('#order-count').textContent = list.length + (list.length === 1 ? ' order' : ' orders') +
      (list.length !== orders.length ? ` of ${orders.length}` : '');

    const wrap = $('#olist');
    if (!wrap) return;
    if (!list.length) {
      wrap.innerHTML = '<div class="empty">' + (orders.length ? 'No orders match this filter.' : 'No orders yet.') + '</div>';
      return;
    }
    wrap.innerHTML = '';

    for (const o of list) {
      const items = Array.isArray(o.items) ? o.items : [];
      const itemsTxt = items.map(i => `${i.qty}× ${i.title}`).join(', ');
      const status = o.status || 'pending';
      const card = el('div', { class: `ocard ocard--${status}` });

      card.innerHTML =
        `<div class="ocard__top">` +
          `<div><b>${esc(o.name || '—')}</b> <span class="ocard__meta">${esc(o.email || '')}${o.phone ? ' · ' + esc(o.phone) : ''}</span></div>` +
          `<div style="display:flex;align-items:center;gap:.6rem">${statusBadge(status)}<span class="ocard__total">${fmtEUR(o.total_eur)}</span></div>` +
        `</div>` +
        `<div class="ocard__meta">${new Date(o.created_at).toLocaleString()} · ${esc(o.country || '')} · ${esc(o.payment_method || '')}</div>` +
        `<div class="ocard__items" style="margin-top:.3rem;font-size:12.5px;color:var(--ink-soft)">${esc(itemsTxt)}</div>` +
        `<div class="ocard__meta" style="margin-top:.35rem;font-size:11px">Click to manage this order →</div>`;

      card.addEventListener('click', () => openOrderModal(o));
      wrap.appendChild(card);
    }
  }

  /* ---------- order detail modal ---------- */
  function openOrderModal(o) {
    const items = Array.isArray(o.items) ? o.items : [];
    const addr = o.address || {};
    const addrLines = [addr.line, addr.line2, addr.city, addr.postal, addr.country].filter(Boolean).join(', ');
    const status = o.status || 'pending';

    $('#order-modal-title').textContent = (o.name || 'Order') + ' — ' + fmtEUR(o.total_eur);
    document.body.classList.add('is-modal-open');
    $('#order-modal').hidden = false;

    const body = $('#order-modal-body');
    body.innerHTML = '';

    // ---- customer info grid
    const grid = el('div', { class: 'odetail__grid' });
    const info = [
      ['Customer', o.name],
      ['Email', o.email],
      ['Phone', o.phone],
      ['Country', o.country],
      ['Payment', o.payment_method + (o.payment_ref ? ' · ' + o.payment_ref : '')],
      ['Date', new Date(o.created_at).toLocaleString()],
    ];
    info.forEach(([label, val]) => {
      if (!val) return;
      grid.append(el('div', { class: 'odetail__section' },
        el('div', { class: 'odetail__label' }, label),
        el('div', { class: 'odetail__val' }, val)));
    });
    body.append(grid);

    // ---- address
    if (addrLines) {
      body.append(el('div', { class: 'odetail__section' },
        el('div', { class: 'odetail__label' }, 'Delivery address'),
        el('div', { class: 'odetail__val' }, addrLines)));
    }

    // ---- note
    if (o.note) {
      body.append(el('div', { class: 'odetail__section' },
        el('div', { class: 'odetail__label' }, 'Customer note'),
        el('div', { class: 'odetail__val', style: 'font-style:italic' }, o.note)));
    }

    // ---- items
    const itemsBox = el('div', { class: 'odetail__items' });
    items.forEach(i => {
      const row = el('div', { class: 'odetail__item' },
        el('span', {}, el('span', { class: 'odetail__item-qty' }, i.qty + '×  '), i.title || ''),
        el('span', {}, fmtEUR(i.price_eur * i.qty)));
      itemsBox.append(row);
    });
    itemsBox.append(el('div', { class: 'odetail__total' },
      el('span', {}, 'Total'),
      el('span', {}, fmtEUR(o.total_eur))));
    body.append(el('div', { class: 'odetail__section' },
      el('div', { class: 'odetail__label' }, 'Items'),
      itemsBox));

    // ---- order management controls
    const ctrl = el('div', { class: 'odetail__ctrl' });
    const statusSel = el('select', { class: 'inp inp--sm' });
    ORDER_STATUSES.forEach(s => {
      const op = el('option', { value: s }, s);
      if (s === status) op.selected = true;
      statusSel.appendChild(op);
    });
    statusSel.addEventListener('change', async () => {
      const patch = { status: statusSel.value };
      if (statusSel.value === 'dispatched' && !o.dispatched_at) patch.dispatched_at = new Date().toISOString();
      if (statusSel.value === 'delivered' && !o.delivered_at) patch.delivered_at = new Date().toISOString();
      const { error } = await sb.from('orders').update(patch).eq('id', o.id);
      if (error) { toast('Update failed: ' + error.message, 'err'); statusSel.value = status; return; }
      Object.assign(o, patch);
      toast('Status updated to ' + statusSel.value);
      // refresh order list badge
      renderOrders(state.allOrders);
    });

    const tnumInp = el('input', { class: 'inp inp--sm', type: 'text', placeholder: 'Tracking number', value: o.tracking_number || '' });
    const turlInp = el('input', { class: 'inp inp--sm', type: 'text', placeholder: 'Tracking URL (optional)', value: o.tracking_url || '' });
    const saveTrack = el('button', { class: 'btn btn--solid btn--sm', type: 'button' }, 'Save tracking');
    saveTrack.addEventListener('click', async () => {
      const patch = { tracking_number: tnumInp.value.trim() || null, tracking_url: turlInp.value.trim() || null };
      if (patch.tracking_number && ['pending','paid','confirmed','preparing'].includes(o.status || 'pending')) {
        patch.status = 'dispatched'; patch.dispatched_at = new Date().toISOString();
        statusSel.value = 'dispatched';
      }
      const { error } = await sb.from('orders').update(patch).eq('id', o.id);
      if (error) { toast('Save failed: ' + error.message, 'err'); return; }
      Object.assign(o, patch);
      toast('Tracking saved.');
      renderOrders(state.allOrders);
    });

    ctrl.append(
      el('div', { class: 'field', style: 'flex:0 0 auto' },
        el('label', { class: 'field-label' }, 'Status'), statusSel),
      el('div', { class: 'field', style: 'flex:1;min-width:130px' },
        el('label', { class: 'field-label' }, 'Tracking #'), tnumInp),
      el('div', { class: 'field', style: 'flex:1;min-width:160px' },
        el('label', { class: 'field-label' }, 'Tracking URL'), turlInp),
      saveTrack,
    );
    body.append(ctrl);

    // close handlers
    const closeModal = () => {
      $('#order-modal').hidden = true;
      document.body.classList.remove('is-modal-open');
      $('#order-modal-scrim').removeEventListener('click', closeModal);
      $('#order-modal-close').removeEventListener('click', closeModal);
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (e) => { if (e.key === 'Escape') closeModal(); };
    $('#order-modal-scrim').addEventListener('click', closeModal);
    $('#order-modal-close').addEventListener('click', closeModal);
    document.addEventListener('keydown', onKey);
  }

  /* ---------- login ---------- */
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = $('#login-error');
    errBox.hidden = true;
    const btn = $('#login-submit');
    const email = $('#login-email').value.trim();
    const password = $('#login-password').value;
    if (!email || !password) { errBox.textContent = 'Enter your email and password.'; errBox.hidden = false; return; }
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Signing in…';
    try {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      $('#login-password').value = '';
      await loadProducts();
    } catch (err) {
      errBox.textContent = friendlyErr(err) || 'Could not sign in. Check your details and try again.';
      errBox.hidden = false;
    } finally {
      btn.disabled = false; btn.textContent = 'Sign in';
    }
  });

  $('#signout-btn').addEventListener('click', async () => {
    await sb.auth.signOut();
    state.products = []; state.allOrders = [];
    show('view-login');
    toast('Signed out.');
  });

  /* ============================================================
     PRODUCTS
     ============================================================ */
  async function loadProducts() {
    const wrap = $('#plist');
    wrap.innerHTML = '<div class="list-loading">Loading products…</div>';
    const { data, error } = await sb
      .from('products')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true });
    if (error) {
      wrap.innerHTML = '';
      wrap.append(el('div', { class: 'empty' }, 'Could not load products: ' + friendlyErr(error)));
      toast('Failed to load products. ' + friendlyErr(error), 'err');
      return;
    }
    state.products = data || [];
    updateProductStats();
    renderList();
  }

  function updateProductStats() {
    const all     = state.products.length;
    const active  = state.products.filter(p => p.active !== false).length;
    const hidden  = all - active;
    const nosec   = state.products.filter(p => !p.section_slug).length;
    const set = (id, v) => { const n = $('#' + id); if (n) n.textContent = v; };
    set('stat-total',  all);
    set('stat-active', active);
    set('stat-hidden', hidden);
    set('stat-nosection', nosec);
  }

  function renderList() {
    const wrap = $('#plist');
    const q = state.query.trim().toLowerCase();

    let list = state.products;

    // active/hidden filter
    if (state.activeFilter === 'active') list = list.filter(p => p.active !== false);
    if (state.activeFilter === 'hidden') list = list.filter(p => p.active === false);

    // section filter
    if (state.sectionFilter) list = list.filter(p => p.section_slug === state.sectionFilter);

    // text search
    if (q) list = list.filter(p =>
      (p.title_en || '').toLowerCase().includes(q) ||
      (p.title_ru || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q)
    );

    const total = state.products.length;
    const showing = list.length;
    $('#prod-count').textContent = showing === total
      ? `${total} item${total === 1 ? '' : 's'}`
      : `${showing} of ${total} items`;

    wrap.innerHTML = '';
    if (!list.length) {
      wrap.append(el('div', { class: 'empty' },
        total ? 'No products match your filters.' : 'No products yet — add your first one.'));
      return;
    }

    for (const p of list) {
      const thumb = p.image
        ? el('img', { class: 'prow__thumb', src: p.image, alt: '', loading: 'lazy',
            onerror: function () { this.replaceWith(phThumb()); } })
        : phThumb();

      const priceParts = [];
      if (p.price_eur != null && p.price_eur !== '') priceParts.push('€' + fmtNum(p.price_eur));
      if (p.price_rub != null && p.price_rub !== '') priceParts.push('₽' + fmtNum(p.price_rub));

      const toggle = el('label', { class: 'toggle prow__toggle', title: 'Active on storefront' },
        el('input', { type: 'checkbox', ...(p.active !== false ? { checked: true } : {}),
          onchange: (e) => toggleActive(p, e.target) }),
        el('span', { class: 'toggle__track' }),
        el('span', { class: 'toggle__lbl' }, p.active !== false ? 'Active' : 'Hidden'),
      );

      const editBtn = el('button', { class: 'iconaction', type: 'button', title: 'Edit product',
        onclick: (e) => { e.stopPropagation(); openEditor(p); },
        html: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M4 20h4L18.5 9.5a2 2 0 0 0-2.83-2.83L5 17.5V20z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 7l3 3" stroke="currentColor" stroke-width="1.8"/></svg>' });

      const delBtn = el('button', { class: 'iconaction iconaction--danger', type: 'button', title: 'Delete product',
        onclick: (e) => { e.stopPropagation(); deleteProduct(p); },
        html: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M5 7h14M10 7V5h4v2M8 7l1 12h6l1-12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' });

      wrap.append(el('div', { class: 'prow' + (p.active === false ? ' is-inactive' : '') },
        thumb,
        el('div', { class: 'prow__main' },
          el('div', { class: 'prow__title' }, p.title_en || p.title_ru || '(untitled)'),
          el('div', { class: 'prow__meta' },
            [p.sku ? 'SKU ' + p.sku : null, sectionLabel(p.section_slug), '#' + p.id]
              .filter(Boolean).join('  ·  ')),
        ),
        toggle,
        el('div', { class: 'prow__price' }, priceParts.join('  ') || '—'),
        el('div', { class: 'prow__actions' }, editBtn, delBtn),
      ));
    }
  }

  function phThumb() {
    return el('div', { class: 'prow__thumb prow__thumb--ph' }, 'no img');
  }

  async function toggleActive(p, input) {
    const next = input.checked;
    input.disabled = true;
    const { error } = await sb.from('products').update({ active: next }).eq('id', p.id);
    input.disabled = false;
    if (error) {
      input.checked = !next;
      toast('Could not update: ' + friendlyErr(error), 'err');
      return;
    }
    p.active = next;
    const lbl = input.parentElement.querySelector('.toggle__lbl');
    if (lbl) lbl.textContent = next ? 'Active' : 'Hidden';
    input.closest('.prow')?.classList.toggle('is-inactive', !next);
    updateProductStats();
    toast(`"${p.title_en || p.id}" ${next ? 'shown on' : 'hidden from'} storefront.`);
  }

  async function deleteProduct(p) {
    const name = p.title_en || p.title_ru || ('Product #' + p.id);
    const ok = await confirmModal({
      title: 'Delete product?',
      sub: 'This cannot be undone',
      msg: `"${name}" will be permanently removed from the catalogue.`,
      okLabel: 'Delete permanently',
      danger: true,
    });
    if (!ok) return;
    const { error } = await sb.from('products').delete().eq('id', p.id);
    if (error) {
      toast('Delete failed: ' + friendlyErr(error), 'err', 7000);
      return;
    }
    state.products = state.products.filter(x => x.id !== p.id);
    updateProductStats();
    renderList();
    toast(`Deleted "${name}".`);
  }

  /* ============================================================
     EDITOR
     ============================================================ */
  function openEditor(product) {
    const isNew = !product;
    const p = normalizeProduct(product);

    document.body.classList.add('is-modal-open');

    /* ----- list-editor builders ----- */
    const stringList = (initial, placeholder) => {
      const items = [...(initial || [])];
      const box = el('div', { class: 'listed' });
      const list = el('div', {});
      const empty = el('div', { class: 'listed__empty' }, 'None yet.');
      const draw = () => {
        list.innerHTML = '';
        if (!items.length) list.append(empty);
        items.forEach((val, i) => {
          const inp = el('input', { class: 'inp', type: 'text', value: val, placeholder,
            oninput: (e) => { items[i] = e.target.value; } });
          const del = el('button', { class: 'listed__del', type: 'button', 'aria-label': 'Remove', title: 'Remove',
            onclick: () => { items.splice(i, 1); draw(); },
            html: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' });
          list.append(el('div', { class: 'listed__row' }, inp, del));
        });
      };
      draw();
      const add = el('button', { class: 'listed__add', type: 'button',
        onclick: () => { items.push(''); draw(); box.querySelectorAll('.inp')[items.length - 1]?.focus(); } }, '＋ Add');
      box.append(list, add);
      return { node: box, get: () => items.map(s => s.trim()).filter(Boolean) };
    };

    const kvList = (initial) => {
      const items = (initial || []).map(o => ({ name: o?.name || '', note: o?.note || '' }));
      const box = el('div', { class: 'listed' });
      const list = el('div', {});
      const empty = el('div', { class: 'listed__empty' }, 'None yet.');
      const draw = () => {
        list.innerHTML = '';
        if (!items.length) list.append(empty);
        items.forEach((it, i) => {
          const nm = el('input', { class: 'inp', type: 'text', value: it.name, placeholder: 'Ingredient name',
            oninput: (e) => { it.name = e.target.value; } });
          const nt = el('input', { class: 'inp', type: 'text', value: it.note, placeholder: 'Short note',
            oninput: (e) => { it.note = e.target.value; } });
          const del = el('button', { class: 'listed__del', type: 'button', 'aria-label': 'Remove', title: 'Remove',
            onclick: () => { items.splice(i, 1); draw(); },
            html: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' });
          list.append(el('div', { class: 'listed__row listed__row--kv' }, nm, nt, del));
        });
      };
      draw();
      const add = el('button', { class: 'listed__add', type: 'button',
        onclick: () => { items.push({ name: '', note: '' }); draw(); } }, '＋ Add ingredient');
      box.append(list, add);
      return { node: box, get: () => items.map(o => ({ name: o.name.trim(), note: o.note.trim() })).filter(o => o.name || o.note) };
    };

    /* ----- gallery / upload editor ----- */
    let images = [...(p.images || [])];
    let primary = p.image || images[0] || '';
    const galleryBox = el('div', { class: 'gallery' });
    const grid = el('div', { class: 'gallery__grid' });
    function drawGallery() {
      grid.innerHTML = '';
      if (!images.length) {
        grid.append(el('div', { class: 'listed__empty' }, 'No images yet — add a URL or upload below.'));
      }
      images.forEach((u, i) => {
        const isPrimary = u === primary;
        const cell = el('div', { class: 'gimg' },
          el('img', { src: u, alt: '', loading: 'lazy', onerror: function () { this.style.opacity = '.25'; } }),
          isPrimary ? el('span', { class: 'gimg__badge' }, 'Primary') : null,
          el('div', { class: 'gimg__bar' },
            isPrimary ? null : el('button', { type: 'button', title: 'Make primary',
              onclick: () => { primary = u; drawGallery(); } }, 'Primary'),
            el('button', { type: 'button', title: 'Remove',
              onclick: () => { images.splice(i, 1); if (primary === u) primary = images[0] || ''; drawGallery(); } }, 'Remove'),
          ),
        );
        grid.append(cell);
      });
    }
    drawGallery();

    const urlInput = el('input', { class: 'inp', type: 'url', placeholder: 'https://… image URL' });
    const addUrlBtn = el('button', { class: 'btn btn--ghost btn--sm', type: 'button',
      onclick: () => {
        const u = urlInput.value.trim();
        if (!u) return;
        if (!images.includes(u)) images.push(u);
        if (!primary) primary = u;
        urlInput.value = '';
        drawGallery();
      } }, 'Add URL');
    urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addUrlBtn.click(); } });

    const fileInput = el('input', { type: 'file', accept: 'image/*', multiple: true, class: 'sr-only', id: 'gallery-file' });
    const dropzone = el('label', { class: 'dropzone', for: 'gallery-file' },
      el('div', { class: 'dropzone__t' }, 'Drop images here, or click to upload'),
      el('div', { class: 'dropzone__h' }, `Uploads to "${STORAGE_BUCKET}" · JPG / PNG / WebP`),
      fileInput,
    );
    async function handleFiles(files) {
      const arr = [...files].filter(f => f.type.startsWith('image/'));
      if (!arr.length) return;
      dropzone.classList.add('is-busy');
      const orig = dropzone.querySelector('.dropzone__t').textContent;
      let ok = 0;
      for (const f of arr) {
        dropzone.querySelector('.dropzone__t').textContent = `Uploading ${f.name}…`;
        try {
          const u = await uploadImage(f);
          if (!images.includes(u)) images.push(u);
          if (!primary) primary = u;
          ok++;
          drawGallery();
        } catch (err) {
          toast(`Upload failed for ${f.name}: ${friendlyErr(err)}`, 'err');
        }
      }
      dropzone.querySelector('.dropzone__t').textContent = orig;
      dropzone.classList.remove('is-busy');
      fileInput.value = '';
      if (ok) toast(`Uploaded ${ok} image${ok === 1 ? '' : 's'}.`);
    }
    fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
    ['dragenter','dragover'].forEach(ev => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('is-over'); }));
    ['dragleave','drop'].forEach(ev => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('is-over'); }));
    dropzone.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files); });

    galleryBox.append(grid, el('div', { class: 'addurl' }, urlInput, addUrlBtn), dropzone);

    /* ----- concerns multi-select ----- */
    const concernSet = new Set(p.concerns || []);
    const chips = el('div', { class: 'chips' });
    CONCERNS.forEach(([key, lbl]) => {
      const input = el('input', { type: 'checkbox', ...(concernSet.has(key) ? { checked: true } : {}) });
      const chip = el('label', { class: 'chip' + (concernSet.has(key) ? ' is-on' : '') }, input, lbl);
      input.addEventListener('change', () => {
        if (input.checked) concernSet.add(key); else concernSet.delete(key);
        chip.classList.toggle('is-on', input.checked);
        syncPrimaryOptions();
      });
      chips.append(chip);
    });

    const concernPrimarySel = el('select', { class: 'sel' });
    function syncPrimaryOptions() {
      const cur = concernPrimarySel.value || p.concern_primary || '';
      concernPrimarySel.innerHTML = '';
      concernPrimarySel.append(el('option', { value: '' }, '— none —'));
      const keys = [...concernSet];
      (keys.length ? keys : CONCERN_KEYS).forEach(k => {
        const lbl = (CONCERNS.find(c => c[0] === k) || [k, k])[1];
        concernPrimarySel.append(el('option', { value: k, ...(k === cur ? { selected: true } : {}) }, lbl));
      });
      if (cur && [...concernPrimarySel.options].some(o => o.value === cur)) concernPrimarySel.value = cur;
    }
    syncPrimaryOptions();

    /* ----- plain field refs ----- */
    const f = {};
    const input = (key, opts = {}) => (f[key] = el('input', { class: 'inp', value: p[key] ?? '', ...opts }));
    const area  = (key, opts = {}) => (f[key] = el('textarea', { class: 'txta', ...opts }, p[key] ?? ''));
    const pdpInput = (key, opts = {}) => (f['pdp_' + key] = el('input', { class: 'inp', value: p.pdp?.[key] ?? '', ...opts }));
    const pdpArea  = (key, opts = {}) => (f['pdp_' + key] = el('textarea', { class: 'txta', ...opts }, p.pdp?.[key] ?? ''));

    const sectionSel = el('select', { class: 'sel' },
      el('option', { value: '' }, '— choose section —'),
      ...SECTIONS.map(s => el('option', { value: s.slug, ...(s.slug === p.section_slug ? { selected: true } : {}) }, s.en)));
    const sectionEnInp = input('section_en', { placeholder: 'Cosmetics' });
    const sectionRuInp = input('section', { placeholder: 'КОСМЕТИКА' });
    sectionSel.addEventListener('change', () => {
      const s = SECTION_BY_SLUG[sectionSel.value];
      if (!s) return;
      const knownEns = SECTIONS.map(x => x.en), knownRus = SECTIONS.map(x => x.ru);
      if (!sectionEnInp.value.trim() || knownEns.includes(sectionEnInp.value.trim())) sectionEnInp.value = s.en;
      if (!sectionRuInp.value.trim() || knownRus.includes(sectionRuInp.value.trim())) sectionRuInp.value = s.ru;
    });

    /* ----- dosha checkboxes + auto-detection ----- */
    const DOSHA_KEYS = ['vata', 'pitta', 'kapha'];
    const DOSHA_LABELS = { vata: 'Vāta (Air & Space)', pitta: 'Pitta (Fire & Water)', kapha: 'Kapha (Earth & Water)' };
    const DOSHA_KW = {
      vata:  /\b(vata|ashwagandha|sesame|shatavari|licorice|ghee|haritaki|grounding|nourish|warming)\b/i,
      pitta: /\b(pitta|neem|amalaki|coriander|cooling|clarif|soothing|anti.?inflamm|manjistha|aloe|brahmi)\b/i,
      kapha: /\b(kapha|trikatu|ginger|turmeric|energi|stimulat|lighten|triphala|punarnava|guggul|pepper)\b/i,
    };
    const allText = [p.title_en, p.title_ru, p.blurb_en, p.pdp?.what, p.pdp?.ingredients, p.pdp?.description].filter(Boolean).join(' ');
    const doshaSet = new Set(Array.isArray(p.doshas) ? p.doshas : []);
    // Auto-add keywords only if product has no stored doshas yet
    if (!doshaSet.size) DOSHA_KEYS.forEach(d => { if (DOSHA_KW[d].test(allText)) doshaSet.add(d); });
    const doshaChecks = el('div', { class: 'dosha-checks' });
    DOSHA_KEYS.forEach(d => {
      const detected = DOSHA_KW[d].test(allText);
      const inp = el('input', { type: 'checkbox', id: 'dosha-' + p.id + '-' + d, ...(doshaSet.has(d) ? { checked: true } : {}) });
      inp.addEventListener('change', () => { if (inp.checked) doshaSet.add(d); else doshaSet.delete(d); });
      doshaChecks.append(el('label', { class: 'dosha-check', for: 'dosha-' + p.id + '-' + d },
        inp, DOSHA_LABELS[d],
        detected ? el('span', { class: 'dosha-check__detected' }, '✓ detected') : null));
    });

    const catUids  = stringList((p.category_uids || []).map(String), 'Numeric UID');
    const catNames = stringList(p.category_names || [], 'Russian category name');
    const catEn    = stringList(p.category_en || [], 'English category name');
    const benefitsEd   = stringList(p.pdp?.benefits || [], 'A benefit');
    const keyIngEd     = kvList(p.pdp?.key_ingredients || []);
    const goodToKnowEd = stringList(p.pdp?.good_to_know || [], 'Good-to-know note');

    /* ----- assemble body ----- */
    const body = el('div', { class: 'modal__body' });
    let gnum = 0;
    const group = (title, ...content) => {
      gnum++;
      return el('section', { class: 'group' },
        el('div', { class: 'group__head' },
          el('span', { class: 'group__num' }, String(gnum).padStart(2, '0')),
          el('span', { class: 'group__title' }, title)),
        ...content);
    };
    const field = (labelText, control, hint) => {
      const id = 'fld-' + Math.random().toString(36).slice(2, 8);
      if (control.tagName) control.id = id;
      return el('div', { class: 'field' },
        el('label', { for: id, class: 'field-label' }, labelText),
        control,
        hint ? el('span', { class: 'field-hint' }, hint) : null);
    };

    body.append(
      group('Identity',
        el('div', { class: 'row row-2' },
          field('Title (English)', input('title_en', { placeholder: 'Product name' })),
          field('Title (Russian)', input('title_ru', { placeholder: 'Название' }))),
        el('div', { class: 'row row-3' },
          field('SKU', input('sku', { placeholder: 'Optional' })),
          field('Price (EUR)', input('price_eur', { type: 'number', step: '0.01', min: '0', placeholder: '0.00' })),
          field('Price (RUB)', input('price_rub', { type: 'number', step: '1', min: '0', placeholder: '0' }))),
        field('Storefront blurb (English)', area('blurb_en', { placeholder: 'Short one-line description shown in the catalogue.' })),
      ),
      group('Section',
        el('div', { class: 'row row-3' },
          field('Section', sectionSel, 'Drives the storefront grouping.'),
          field('Section label (EN)', sectionEnInp, 'Auto-fills; editable.'),
          field('Section label (RU)', sectionRuInp, 'Auto-fills; editable.')),
      ),
      group('Concerns',
        field('Shop-by-concern tags', chips, 'Select every concern this product helps with.'),
        field('Primary concern', concernPrimarySel, 'The lead concern (used for related products).'),
      ),
      group('Doshas',
        field('Dosha suitability', doshaChecks, 'Which body types this product suits. "Detected" means keywords were found in the product text.'),
      ),
      group('Categories',
        el('div', { class: 'row row-3' },
          field('Category UIDs', catUids.node),
          field('Category names (RU)', catNames.node),
          field('Category names (EN)', catEn.node)),
      ),
      group('Images',
        field('Gallery & primary image', galleryBox),
      ),
      group('Product detail page',
        el('div', { class: 'row row-2' },
          field('Subtitle', pdpInput('subtitle')),
          field('Format', pdpInput('format', { placeholder: 'e.g. Powder, Oil, Spice' }))),
        field('What it is', pdpArea('what')),
        field('Benefits', benefitsEd.node),
        field('Description', pdpArea('description')),
        field('Ingredients', pdpArea('ingredients')),
        field('Key ingredients', keyIngEd.node),
        field('How to use', pdpArea('how_to_use')),
        field('Routine', pdpArea('routine')),
        el('div', { class: 'row row-2' },
          field('Suited for', pdpArea('suited_for')),
          field('Not suited for', pdpArea('not_suited'))),
        field('Good to know', goodToKnowEd.node),
      ),
      group('Storefront',
        el('div', { class: 'row row-2' },
          field('Sort order', input('sort_order', { type: 'number', step: '1', placeholder: '0' }), 'Lower numbers appear first.'),
          el('div', { class: 'field' },
            el('span', { class: 'field-label' }, 'Visibility'),
            el('label', { class: 'check' },
              (f.active = el('input', { type: 'checkbox', ...(p.active !== false ? { checked: true } : {}) })),
              'Active — show on storefront'))),
      ),
    );

    /* ----- header + footer + modal ----- */
    const closeBtn = el('button', { class: 'modal__close', type: 'button', 'aria-label': 'Close',
      html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' });
    const head = el('div', { class: 'modal__head' },
      el('div', {},
        el('div', { class: 'modal__sub' }, isNew ? 'New product' : 'Edit · #' + p.id),
        el('h2', { class: 'modal__title' }, isNew ? 'Add a product' : (p.title_en || p.title_ru || 'Edit product'))),
      el('span', { style: 'flex:1' }),
      closeBtn);

    const saveBtn = el('button', { class: 'btn btn--solid', type: 'button' }, isNew ? 'Create product' : 'Save changes');
    const cancelBtn = el('button', { class: 'btn btn--ghost', type: 'button' }, 'Cancel');
    const foot = el('div', { class: 'modal__foot' }, cancelBtn, saveBtn);

    const scrim = el('div', { class: 'modal__scrim' });
    const panel = el('div', { class: 'modal__panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': isNew ? 'Add product' : 'Edit product' },
      head, body, foot);
    const modal = el('div', { class: 'modal' }, scrim, panel);
    document.body.append(modal);

    const close = () => { modal.remove(); document.body.classList.remove('is-modal-open'); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    scrim.addEventListener('click', close);
    closeBtn.addEventListener('click', close);
    cancelBtn.addEventListener('click', close);
    setTimeout(() => f.title_en?.focus(), 40);

    /* ----- save ----- */
    saveBtn.addEventListener('click', async () => {
      const numOrNull = (v) => { const s = String(v).trim(); if (s === '') return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
      const txt = (v) => { const s = String(v ?? '').trim(); return s === '' ? null : s; };

      const record = {
        id: isNew ? newProductId() : p.id,
        sku: txt(f.sku.value) || '',
        title_en: txt(f.title_en.value),
        title_ru: txt(f.title_ru.value),
        blurb_en: txt(f.blurb_en.value),
        desc_ru: p.desc_ru ?? null,
        url_ru: p.url_ru ?? null,
        price_eur: numOrNull(f.price_eur.value),
        price_rub: numOrNull(f.price_rub.value),
        section: txt(sectionRuInp.value),
        section_en: txt(sectionEnInp.value),
        section_slug: txt(sectionSel.value),
        category_uids: catUids.get().map(Number).filter(Number.isFinite),
        category_names: catNames.get(),
        category_en: catEn.get(),
        image: primary || null,
        images,
        concerns: [...concernSet],
        concern_primary: txt(concernPrimarySel.value),
        doshas: [...doshaSet],
        pdp: {
          subtitle: txt(f.pdp_subtitle.value) || '',
          what: txt(f.pdp_what.value) || '',
          benefits: benefitsEd.get(),
          ingredients: txt(f.pdp_ingredients.value) || '',
          how_to_use: txt(f.pdp_how_to_use.value) || '',
          format: txt(f.pdp_format.value) || '',
          suited_for: txt(f.pdp_suited_for.value) || '',
          description: txt(f.pdp_description.value) || '',
          key_ingredients: keyIngEd.get(),
          routine: txt(f.pdp_routine.value) || '',
          not_suited: txt(f.pdp_not_suited.value) || '',
          good_to_know: goodToKnowEd.get(),
        },
        active: !!f.active.checked,
        sort_order: numOrNull(f.sort_order.value) ?? 0,
        updated_at: new Date().toISOString(),
      };

      if (!record.title_en && !record.title_ru) {
        toast('Add at least an English or Russian title before saving.', 'err');
        f.title_en?.focus();
        return;
      }

      saveBtn.disabled = true; cancelBtn.disabled = true;
      const label = saveBtn.textContent; saveBtn.innerHTML = '<span class="spin"></span> Saving…';
      try {
        const { data, error } = await sb.from('products').upsert(record, { onConflict: 'id' }).select().single();
        if (error) throw error;
        const saved = data || record;
        const idx = state.products.findIndex(x => x.id === saved.id);
        if (idx >= 0) state.products[idx] = saved; else state.products.push(saved);
        state.products.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.id - b.id));
        updateProductStats();
        renderList();
        close();
        toast(isNew ? `Created "${saved.title_en || saved.id}".` : `Saved "${saved.title_en || saved.id}".`);
      } catch (err) {
        saveBtn.disabled = false; cancelBtn.disabled = false; saveBtn.textContent = label;
        toast('Save failed: ' + friendlyErr(err), 'err', 6000);
      }
    });
  }

  /* ---------- image upload ---------- */
  async function uploadImage(file) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await sb.storage.from(STORAGE_BUCKET).upload(path, file, {
      cacheControl: '31536000', upsert: false, contentType: file.type || undefined,
    });
    if (error) throw error;
    const { data } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    if (!data?.publicUrl) throw new Error('Could not resolve public URL for the uploaded image.');
    return data.publicUrl;
  }

  /* ============================================================
     SETTINGS TAB
     ============================================================ */

  async function loadSettings() {
    const { data, error } = await sb.from('settings')
      .select('key,value')
      .in('key', ['fx_rub_eur', 'featured_product_id', 'site_notice']);
    if (error) { toast('Could not load settings: ' + error.message, 'err'); return; }

    const map = {};
    (data || []).forEach(r => { map[r.key] = r.value; });

    // FX rate
    const fxInp = $('#fx-rate');
    if (fxInp && map.fx_rub_eur != null) {
      const v = typeof map.fx_rub_eur === 'number' ? map.fx_rub_eur : parseFloat(map.fx_rub_eur);
      if (isFinite(v)) fxInp.value = v;
    }

    // Featured product
    const fidInp = $('#featured-id');
    if (fidInp && map.featured_product_id) {
      const fid = typeof map.featured_product_id === 'string' ? map.featured_product_id.replace(/^"|"$/g, '') : String(map.featured_product_id);
      fidInp.value = fid;
      showFeaturedPreview(fid);
    }

    // Site notice
    const notice = map.site_notice || {};
    const noticeEnabled = $('#notice-enabled');
    const noticeText = $('#notice-text');
    if (noticeEnabled) noticeEnabled.checked = !!notice.enabled;
    if (noticeText) noticeText.value = notice.text || '';
  }

  function showFeaturedPreview(id) {
    const preview = $('#featured-preview');
    const img = $('#featured-img');
    const name = $('#featured-name');
    if (!preview || !img || !name) return;
    // Try to find in Supabase state (if products already loaded)
    const found = state.products.find(p => String(p.id) === String(id));
    if (found) {
      img.src = found.image || ''; img.alt = found.title_en || '';
      name.textContent = found.title_en || found.title_ru || id;
      preview.hidden = false;
    } else {
      preview.hidden = true;
    }
  }

  async function saveSetting(key, value, statusId) {
    const statusEl = $('#' + statusId);
    if (statusEl) { statusEl.textContent = 'Saving…'; statusEl.className = 'scard__status'; }
    const { error } = await sb.from('settings').upsert({ key, value }, { onConflict: 'key' });
    if (error) {
      if (statusEl) { statusEl.textContent = 'Error: ' + error.message; statusEl.className = 'scard__status err'; }
      toast('Save failed: ' + error.message, 'err');
    } else {
      if (statusEl) { statusEl.textContent = 'Saved ✓'; statusEl.className = 'scard__status ok'; setTimeout(() => { statusEl.textContent = ''; }, 3000); }
      toast('Setting saved.');
    }
  }

  // Featured product save
  $('#btn-save-featured')?.addEventListener('click', () => {
    const id = ($('#featured-id')?.value || '').trim();
    if (!id) { toast('Enter a product ID first.', 'err'); return; }
    showFeaturedPreview(id);
    saveSetting('featured_product_id', id, 'featured-status');
  });
  $('#featured-id')?.addEventListener('input', (e) => showFeaturedPreview(e.target.value.trim()));

  // FX rate save
  $('#btn-save-fx')?.addEventListener('click', () => {
    const v = parseFloat($('#fx-rate')?.value);
    if (!isFinite(v) || v <= 0) { toast('Enter a valid positive rate (e.g. 0.011).', 'err'); return; }
    saveSetting('fx_rub_eur', v, 'fx-status');
  });

  // Site notice save
  $('#btn-save-notice')?.addEventListener('click', () => {
    const enabled = !!$('#notice-enabled')?.checked;
    const text = ($('#notice-text')?.value || '').trim();
    saveSetting('site_notice', { enabled, text }, 'notice-status');
  });

  // Catalog import
  async function importCatalog() {
    const btn = $('#btn-import');
    const statusEl = $('#import-status');
    const progress = $('#import-progress');
    const fill = $('#import-fill');
    const label = $('#import-label');

    btn.disabled = true; btn.textContent = 'Importing…';
    if (statusEl) { statusEl.textContent = ''; statusEl.className = 'scard__status'; }
    if (progress) progress.hidden = false;

    try {
      // Fetch catalog data
      const [catalog, doshasMap] = await Promise.all([
        fetch('data/catalog.json').then(r => r.json()),
        fetch('data/doshas.json').then(r => r.json()).catch(() => ({})),
      ]);

      const products = catalog.products || [];
      const categories = catalog.categories || [];
      const total = products.length;
      let done = 0;

      // Detect if the products table has a doshas column (try a minimal probe)
      let hasDoshasCol = false;
      try {
        const probe = await sb.from('products').select('doshas').limit(1);
        hasDoshasCol = !probe.error;
      } catch { /* ignore */ }

      // Build product records
      const records = products.map(p => {
        const rec = {
          id: p.id,
          sku: p.sku || '',
          title_en: p.title_en || null,
          title_ru: p.title_ru || null,
          blurb_en: p.blurb_en || null,
          desc_ru: p.desc_ru || null,
          url_ru: p.url_ru || null,
          price_eur: p.price_eur ?? null,
          price_rub: p.price_rub ?? null,
          section: p.section || null,
          section_en: p.section_en || null,
          section_slug: p.section_slug || null,
          category_uids: Array.isArray(p.category_uids) ? p.category_uids : [],
          category_names: Array.isArray(p.category_names) ? p.category_names : [],
          category_en: Array.isArray(p.category_en) ? p.category_en : [],
          image: p.image || null,
          images: Array.isArray(p.images) ? p.images : (p.image ? [p.image] : []),
          concerns: Array.isArray(p.concerns) ? p.concerns : [],
          concern_primary: p.concern_primary || null,
          pdp: p.pdp || {},
          active: p.active !== false,
          sort_order: p.sort_order ?? 0,
        };
        if (hasDoshasCol) rec.doshas = doshasMap[String(p.id)] || [];
        return rec;
      });

      // Upsert in batches of 50
      const BATCH = 50;
      for (let i = 0; i < records.length; i += BATCH) {
        const batch = records.slice(i, i + BATCH);
        const { error } = await sb.from('products').upsert(batch, { onConflict: 'id' });
        if (error) throw error;
        done += batch.length;
        const pct = Math.round((done / total) * 100);
        if (fill) fill.style.width = pct + '%';
        if (label) label.textContent = done + ' / ' + total;
      }

      // Upsert categories
      if (categories.length) {
        const catRecords = categories.map(c => ({
          uid: c.uid, title: c.title || null, title_en: c.title_en || null,
          section: c.section || null, section_slug: c.section_slug || null,
          slug: c.slug || null, is_section: !!c.is_section,
        }));
        const { error: catErr } = await sb.from('categories').upsert(catRecords, { onConflict: 'uid' });
        if (catErr) throw catErr;
      }

      if (statusEl) { statusEl.textContent = `Done — ${total} products + ${categories.length} categories imported ✓`; statusEl.className = 'scard__status ok'; }
      toast(`Catalog imported: ${total} products, ${categories.length} categories.`);
      // Reload products so admin list is fresh
      loadProducts();

    } catch (err) {
      const msg = err?.message || String(err);
      if (statusEl) { statusEl.textContent = 'Error: ' + msg; statusEl.className = 'scard__status err'; }
      toast('Import failed: ' + msg, 'err', 8000);
    } finally {
      btn.disabled = false; btn.textContent = 'Import catalog now';
    }
  }

  $('#btn-import')?.addEventListener('click', async () => {
    const ok = await confirmModal({
      title: 'Import 358 products?',
      sub: 'Catalog import',
      msg: 'This will upsert all products and categories from data/catalog.json into Supabase. Existing rows will be updated. The operation takes about 20–40 seconds.',
      okLabel: 'Start import',
      danger: false,
    });
    if (ok) importCatalog();
  });

  /* ---------- kick off ---------- */
  refreshAuth();
}

/* ============================================================
   PURE HELPERS
   ============================================================ */
function newProductId() {
  return Date.now() * 100 + Math.floor(Math.random() * 100);
}

function normalizeProduct(p) {
  p = p || {};
  const pdp = p.pdp || {};
  return {
    id: p.id,
    sku: p.sku || '',
    title_en: p.title_en || '',
    title_ru: p.title_ru || '',
    blurb_en: p.blurb_en || '',
    desc_ru: p.desc_ru ?? null,
    url_ru: p.url_ru ?? null,
    price_eur: p.price_eur ?? '',
    price_rub: p.price_rub ?? '',
    section: p.section || '',
    section_en: p.section_en || '',
    section_slug: p.section_slug || '',
    category_uids: Array.isArray(p.category_uids) ? p.category_uids : [],
    category_names: Array.isArray(p.category_names) ? p.category_names : [],
    category_en: Array.isArray(p.category_en) ? p.category_en : [],
    image: p.image || '',
    images: Array.isArray(p.images) ? [...p.images] : (p.image ? [p.image] : []),
    concerns: Array.isArray(p.concerns) ? p.concerns : [],
    concern_primary: p.concern_primary || '',
    doshas: Array.isArray(p.doshas) ? p.doshas : [],
    pdp: {
      subtitle: pdp.subtitle || '', what: pdp.what || '',
      benefits: Array.isArray(pdp.benefits) ? pdp.benefits : [],
      ingredients: pdp.ingredients || '', how_to_use: pdp.how_to_use || '',
      format: pdp.format || '', suited_for: pdp.suited_for || '',
      description: pdp.description || '',
      key_ingredients: Array.isArray(pdp.key_ingredients) ? pdp.key_ingredients : [],
      routine: pdp.routine || '', not_suited: pdp.not_suited || '',
      good_to_know: Array.isArray(pdp.good_to_know) ? pdp.good_to_know : [],
    },
    active: p.active !== false,
    sort_order: p.sort_order ?? 0,
  };
}

function sectionLabel(slug) {
  return SECTION_BY_SLUG[slug]?.en || slug || '';
}
function fmtNum(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
function friendlyErr(err) {
  if (!err) return '';
  const m = err.message || err.error_description || err.msg || String(err);
  if (/Invalid login credentials/i.test(m)) return 'Wrong email or password.';
  if (/Email not confirmed/i.test(m)) return 'This email has not been confirmed yet.';
  if (/row-level security|violates row-level/i.test(m)) return 'Permission denied — make sure your Supabase RLS policies grant delete to admins.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Network error — check your connection and the Supabase URL.';
  if (/Bucket not found/i.test(m)) return `Storage bucket "${STORAGE_BUCKET}" not found — create it in Supabase.`;
  return m;
}
