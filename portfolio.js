import {
  supabase,
  sanitizeRichText,
  escapeHtml,
  renderAccountStatus,
  getAdminToken,
  clearAdminToken,
  rpcErrorMessage,
  richTextEditorHtml,
  wireRichTextEditor,
  readFunctionErrorBody,
  photoUrl,
} from './shared.js';
import { prepareImage, askSmallImageFit, choose, confirmDialog, openLightbox, frameHtml } from './media.js';

renderAccountStatus(document.getElementById('account-status'));

const BUCKET = 'portfolio';
const listEl = document.getElementById('pf-list');
const noticeArea = document.getElementById('notice-area');

let adminToken = getAdminToken();
let isAdmin = false;
let data = { page: null, projects: [] };

// The one piece currently in edit mode (only one at a time), or null.
// { id, initial: <serialized form state>, photos: [working copy of photo rows] }
let editing = null;

function notice(msg, kind = 'error') {
  noticeArea.innerHTML = `<div class="notice ${kind}">${escapeHtml(msg)}</div>`;
  noticeArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function clearNotice() {
  noticeArea.innerHTML = '';
}

function yearOf(p) {
  return p.occurred_on ? p.occurred_on.slice(0, 4) : '';
}

// ---------------- load ----------------

async function load() {
  if (adminToken) {
    const { data: d, error } = await supabase.rpc('admin_get_portfolio', { p_session_token: adminToken });
    if (!error && d) {
      isAdmin = true;
      data = d;
      document.getElementById('admin-bar').classList.remove('hidden');
      return true;
    }
    // expired admin session: fall back to the public view quietly
    clearAdminToken();
    adminToken = '';
  }
  const { data: d, error } = await supabase.rpc('get_portfolio');
  if (error || !d) {
    listEl.innerHTML = `<p class="intro">Couldn't load the portfolio right now. Please refresh in a moment.</p>`;
    return false;
  }
  data = d;
  return true;
}

// ---------------- render: public view ----------------

function photoItems(p) {
  return (p.photos || []).map((ph, i) => ({
    display: photoUrl(BUCKET, ph.display_path),
    full: photoUrl(BUCKET, ph.storage_path),
    downloadUrl: photoUrl(BUCKET, ph.storage_path, { download: `inani-${p.slug}-${i + 1}.jpg` }),
    caption: ph.caption || '',
    credit: `${p.title}${p.date_label ? ' · ' + p.date_label : ''}`,
    shareUrl: `${location.origin}${location.pathname}#${p.slug}`,
    shareTitle: `${p.title} — Inani`,
  }));
}

function photosHtml(p) {
  const photos = p.photos || [];
  if (!photos.length) return ''; // no photo area at all when a piece has none
  const [first, ...rest] = photos;
  const feature = `
    <figure class="pf-feature">
      ${frameHtml({
        src: photoUrl(BUCKET, first.display_path),
        alt: first.caption || p.title,
        width: first.width,
        height: first.height,
        fit: first.fit,
        attrs: `data-photo-index="0"`,
      })}
      ${first.caption ? `<figcaption>${escapeHtml(first.caption)}</figcaption>` : ''}
    </figure>`;
  const grid = rest.length
    ? `<div class="pf-grid">${rest
        .map(
          (ph, i) => `
        <figure>
          ${frameHtml({
            src: photoUrl(BUCKET, ph.display_path),
            alt: ph.caption || `${p.title}, photo ${i + 2}`,
            width: ph.width,
            height: ph.height,
            fit: ph.fit,
            attrs: `data-photo-index="${i + 1}"`,
          })}
          ${ph.caption ? `<figcaption>${escapeHtml(ph.caption)}</figcaption>` : ''}
        </figure>`
        )
        .join('')}</div>`
    : '';
  return { feature, grid };
}

function pieceViewHtml(p) {
  const photos = photosHtml(p);
  const metaLine = [p.date_label, p.event].filter(Boolean).map(escapeHtml).join('<span class="pf-dot">·</span>');
  return `
    ${isAdmin ? `<button type="button" class="pf-edit-btn" data-action="edit" title="Edit this piece" aria-label="Edit ${escapeHtml(p.title)}">✎</button>` : ''}
    ${isAdmin && p.archived ? `<p class="pf-archived-flag">Archived — hidden from the public page</p>` : ''}
    <header class="pf-head">
      ${metaLine ? `<p class="pf-meta">${metaLine}</p>` : ''}
      <h3 class="pf-title"><a href="#${escapeHtml(p.slug)}">${escapeHtml(p.title)}</a></h3>
      ${p.role ? `<p class="pf-role">${escapeHtml(p.role)}</p>` : ''}
      ${p.credit ? `<p class="pf-credit">${escapeHtml(p.credit)}</p>` : ''}
    </header>
    <div class="pf-content">
      ${photos ? photos.feature : ''}
      <div class="pf-body">${sanitizeRichText(p.body_html || '')}</div>
      ${photos ? photos.grid : ''}
    </div>`;
}

// The intro quote and the credits footer behave like pieces for admins: a ✎ button,
// inline editing, the same unsaved-changes prompts, and their own edit history.
const PAGE_PARTS = {
  intro: { elId: 'pf-intro-block', label: 'the intro quote' },
  credits: { elId: 'pf-credits', label: 'the credits' },
};

function pageEditBtn(part) {
  return isAdmin
    ? `<button type="button" class="pf-edit-btn" data-page-edit="${part}" title="Edit ${PAGE_PARTS[part].label}" aria-label="Edit ${PAGE_PARTS[part].label}">✎</button>`
    : '';
}

function introViewHtml() {
  const page = data.page || {};
  if (!page.intro_quote) {
    return isAdmin ? `${pageEditBtn('intro')}<p class="hint pf-empty-part">No intro quote yet. Tap ✎ to add one.</p>` : '';
  }
  return `${pageEditBtn('intro')}
    <blockquote class="pf-quote">
      <p>${escapeHtml(page.intro_quote)}</p>
      ${page.intro_attribution ? `<cite>— ${escapeHtml(page.intro_attribution)}</cite>` : ''}
    </blockquote>`;
}

function creditsViewHtml() {
  const page = data.page || {};
  if (!page.footer_html) {
    return isAdmin ? `${pageEditBtn('credits')}<p class="hint pf-empty-part">No credits yet. Tap ✎ to add them.</p>` : '';
  }
  return `${pageEditBtn('credits')}<h2 class="pf-section-heading">Credits</h2><div class="pf-credits-body">${sanitizeRichText(page.footer_html)}</div>`;
}

function renderPagePart(part) {
  const el = document.getElementById(PAGE_PARTS[part].elId);
  el.classList.remove('is-editing');
  el.innerHTML = part === 'intro' ? introViewHtml() : creditsViewHtml();
  el.querySelector('[data-page-edit]')?.addEventListener('click', () => requestEdit('page:' + part));
}

function renderAll() {
  renderPagePart('intro');
  renderPagePart('credits');

  const projects = data.projects || [];
  if (!projects.length) {
    listEl.innerHTML = `<p class="intro">No pieces yet.</p>`;
    renderIndex();
    return;
  }

  let lastYear = null;
  const parts = [];
  for (const p of projects) {
    const y = yearOf(p);
    if (y && y !== lastYear) {
      parts.push(`<div class="pf-year" aria-hidden="true"><span>${y}</span></div>`);
      lastYear = y;
    }
    parts.push(
      `<article class="pf-piece${isAdmin && p.archived ? ' is-archived' : ''}" id="${escapeHtml(p.slug)}" data-id="${p.id}">${pieceViewHtml(p)}</article>`
    );
  }
  listEl.innerHTML = parts.join('');
  wireAllPieces();
  renderIndex();
  revealOnScroll();
}

function wireAllPieces() {
  listEl.querySelectorAll('.pf-piece').forEach((el) => wirePieceView(el));
}

function wirePieceView(el) {
  const p = projectById(el.dataset.id);
  if (!p) return;
  el.querySelectorAll('[data-photo-index]').forEach((btn) =>
    btn.addEventListener('click', () => openLightbox(photoItems(p), Number(btn.dataset.photoIndex)))
  );
  el.querySelector('[data-action="edit"]')?.addEventListener('click', () => requestEdit(p.id));
}

function projectById(id) {
  return (data.projects || []).find((p) => p.id === id);
}

// subtle fade-up as pieces scroll into view (skipped for reduced-motion users via CSS)
let revealObserver;
function revealOnScroll() {
  revealObserver?.disconnect();
  if (!('IntersectionObserver' in window)) {
    listEl.querySelectorAll('.pf-piece').forEach((el) => el.classList.add('in'));
    return;
  }
  revealObserver = new IntersectionObserver(
    (entries) =>
      entries.forEach((en) => {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          revealObserver.unobserve(en.target);
        }
      }),
    { rootMargin: '0px 0px -8% 0px' }
  );
  listEl.querySelectorAll('.pf-piece').forEach((el) => revealObserver.observe(el));
}

// ---------------- jump-to-piece index ----------------

const indexToggle = document.getElementById('pf-index-toggle');
const indexEl = document.getElementById('pf-index');

function renderIndex() {
  const projects = data.projects || [];
  indexToggle.classList.toggle('hidden', projects.length < 2);
  let lastYear = null;
  const html = [];
  for (const p of projects) {
    const y = yearOf(p);
    if (y !== lastYear) {
      if (lastYear !== null) html.push('</ul>');
      html.push(`<p class="pf-index-year">${y || '—'}</p><ul>`);
      lastYear = y;
    }
    html.push(
      `<li><a href="#${escapeHtml(p.slug)}"><span>${escapeHtml(p.title)}</span><small>${escapeHtml(p.date_label || '')}</small></a></li>`
    );
  }
  if (lastYear !== null) html.push('</ul>');
  document.getElementById('pf-index-list').innerHTML = html.join('');
}

function setIndexOpen(open) {
  indexEl.hidden = !open;
  indexToggle.setAttribute('aria-expanded', String(open));
  if (open) indexEl.querySelector('a, button')?.focus();
}
indexToggle.addEventListener('click', () => setIndexOpen(indexEl.hidden));
document.getElementById('pf-index-close').addEventListener('click', () => setIndexOpen(false));
indexEl.addEventListener('click', (e) => {
  if (e.target === indexEl) setIndexOpen(false);
  if (e.target.closest('a')) setIndexOpen(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !indexEl.hidden) {
    setIndexOpen(false);
    indexToggle.focus();
  }
});

function scrollToHash() {
  const slug = decodeURIComponent(location.hash.slice(1));
  if (!slug) return;
  const el = document.getElementById(slug);
  if (el) {
    el.classList.add('in');
    el.scrollIntoView({ block: 'start' });
  }
}

// ---------------- admin: inline editing ----------------

function monthValue(dateStr) {
  return dateStr ? dateStr.slice(0, 7) : '';
}

function photoRowHtml(ph, i, total) {
  return `
    <div class="pf-photo-row" data-photo-id="${ph.id}">
      <img src="${escapeHtml(photoUrl(BUCKET, ph.display_path))}" alt="" class="pf-photo-thumb" />
      <div class="pf-photo-fields">
        <input type="text" class="ed-caption" placeholder="Caption (optional)" value="${escapeHtml(ph.caption || '')}" maxlength="1000" />
        <div class="pf-photo-actions">
          <select class="ed-fit" title="How this photo is framed">
            <option value="normal" ${ph.fit === 'normal' ? 'selected' : ''}>Normal</option>
            <option value="enlarge" ${ph.fit === 'enlarge' ? 'selected' : ''}>Enlarge to fill</option>
            <option value="pad" ${ph.fit === 'pad' ? 'selected' : ''}>Small, with border</option>
          </select>
          <button type="button" class="secondary small" data-photo-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
          <button type="button" class="secondary small" data-photo-act="down" ${i === total - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
          <label class="btn secondary small file-btn">Replace<input type="file" accept="image/*" data-photo-act="replace" /></label>
          <button type="button" class="danger small" data-photo-act="delete">Delete</button>
        </div>
        ${i === 0 ? '<p class="hint">Shown large, as the feature photo.</p>' : ''}
      </div>
    </div>`;
}

function photoManagerHtml() {
  const photos = editing.photos;
  return `
    <div class="pf-photo-list">
      ${photos.length ? photos.map((ph, i) => photoRowHtml(ph, i, photos.length)).join('') : '<p class="hint">No photos yet. The photo area stays hidden on the public page until you add one.</p>'}
    </div>
    <label class="btn small file-btn">+ Add photos<input type="file" accept="image/*" multiple id="ed-add-photos" /></label>
    <span class="hint">Large photos are resized automatically. Photo changes save right away.</span>
    <div class="pf-upload-status" aria-live="polite"></div>`;
}

function editFormHtml(p) {
  return `
    <div class="pf-editor">
      <div class="pf-editor-head"><strong>Editing</strong></div>
      <div class="field-group">
        <input type="text" class="ed-title pf-title-input" value="${escapeHtml(p.title)}" placeholder="Title" aria-label="Title" />
      </div>
      <div class="row">
        <div class="field-group">
          <label class="field">Month it happened</label>
          <input type="month" class="ed-month" value="${monthValue(p.occurred_on)}" />
        </div>
        <div class="field-group">
          <label class="field">Date shown instead (optional)</label>
          <input type="text" class="ed-year-label" value="${escapeHtml(p.year_label || '')}" placeholder="e.g. 2019, 2022" />
        </div>
      </div>
      <div class="row">
        <div class="field-group">
          <label class="field">Event</label>
          <input type="text" class="ed-event" value="${escapeHtml(p.event || '')}" placeholder="e.g. Love Burn" />
        </div>
        <div class="field-group">
          <label class="field">Inani's role</label>
          <input type="text" class="ed-role" value="${escapeHtml(p.role || '')}" placeholder="e.g. Designer & build lead" />
        </div>
      </div>
      <div class="field-group">
        <label class="field">Credit line (optional)</label>
        <input type="text" class="ed-credit" value="${escapeHtml(p.credit || '')}" placeholder="e.g. Designed by … · Built by …" />
      </div>
      <label class="field">Description</label>
      ${richTextEditorHtml(sanitizeRichText(p.body_html || ''))}

      <h4 class="pf-editor-sub">Photos</h4>
      <div class="pf-photo-manager">${photoManagerHtml()}</div>

      <details class="pf-advanced">
        <summary>Advanced</summary>
        <div class="row">
          <div class="field-group">
            <label class="field">Link name (slug)</label>
            <input type="text" class="ed-slug" value="${escapeHtml(p.slug)}" />
            <p class="hint">Link: erebe.art/portfolio.html#<span class="ed-slug-preview">${escapeHtml(p.slug)}</span></p>
          </div>
          <div class="field-group">
            <label class="field">Tiebreak order (same month)</label>
            <input type="number" class="ed-sort" value="${p.sort_order}" />
            <p class="hint">Higher shows first.</p>
          </div>
        </div>
      </details>

      <div class="pf-editor-actions">
        <button type="button" data-ed="save">Save</button>
        <button type="button" class="secondary" data-ed="cancel">Cancel &amp; revert</button>
        <button type="button" class="secondary pf-more-btn" data-ed="more" aria-label="More: history, archive, delete" title="History, archive, delete">⋯</button>
      </div>
    </div>`;
}

function pagePartOf(id) {
  return typeof id === 'string' && id.startsWith('page:') ? id.slice(5) : null;
}

function editorEl() {
  if (!editing) return null;
  const part = pagePartOf(editing.id);
  if (part) return document.getElementById(PAGE_PARTS[part].elId);
  return listEl.querySelector(`.pf-piece[data-id="${editing.id}"]`);
}

function editingLabel() {
  const part = editing && pagePartOf(editing.id);
  if (part) return PAGE_PARTS[part].label;
  return projectById(editing?.id)?.title || 'this piece';
}

// Everything the Save button would send, as a string -- compared against the state at
// the moment editing started to know whether there are unsaved changes.
function serializeEditor() {
  const el = editorEl();
  if (!el) return '';
  const v = (sel) => el.querySelector(sel)?.value ?? '';
  if (pagePartOf(editing.id)) {
    return JSON.stringify({
      quote: v('.pg-quote'),
      attribution: v('.pg-attribution'),
      credits: el.querySelector('.rte-editable')?.innerHTML ?? '',
    });
  }
  return JSON.stringify({
    title: v('.ed-title'),
    month: v('.ed-month'),
    year_label: v('.ed-year-label'),
    event: v('.ed-event'),
    role: v('.ed-role'),
    credit: v('.ed-credit'),
    slug: v('.ed-slug'),
    sort: v('.ed-sort'),
    body: el.querySelector('.rte-editable')?.innerHTML ?? '',
    photos: [...el.querySelectorAll('.pf-photo-row')].map((r) => [
      r.dataset.photoId,
      r.querySelector('.ed-caption').value,
      r.querySelector('.ed-fit').value,
    ]),
  });
}

function isDirty() {
  return !!editing && serializeEditor() !== editing.initial;
}

// Ask what to do with unsaved changes. Resolves true if it's OK to proceed
// (saved successfully, or discarded), false to stay put.
async function resolveUnsaved(proceedLabel) {
  if (!isDirty()) return true;
  const choice = await choose({
    title: 'Save your changes?',
    html: `<p>You have unsaved changes to <strong>${escapeHtml(editingLabel())}</strong>.</p>`,
    choices: [
      { label: `Save & ${proceedLabel}`, value: 'save' },
      { label: 'Discard changes', value: 'discard', kind: 'danger' },
      { label: 'Keep editing', value: null, kind: 'secondary' },
    ],
  });
  if (choice === 'save') return pagePartOf(editing.id) ? await savePageEditor() : await saveEditor({ stayOpen: false });
  if (choice === 'discard') return true;
  return false;
}

async function requestEdit(id) {
  if (editing && editing.id === id) return;
  if (editing) {
    const ok = await resolveUnsaved('switch');
    if (!ok) {
      editorEl()?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    closeEditor();
  }
  const part = pagePartOf(id);
  if (part) openPageEditor(part);
  else openEditor(id);
}

function openEditor(id) {
  const p = projectById(id);
  if (!p) return;
  clearNotice();
  editing = { id, photos: (p.photos || []).map((ph) => ({ ...ph })), initial: '' };
  const el = listEl.querySelector(`.pf-piece[data-id="${id}"]`);
  el.classList.add('is-editing', 'in');
  document.body.classList.add('pf-editing');
  el.innerHTML = editFormHtml(p);
  wireRichTextEditor(el.querySelector('.rte'));
  wireEditor(el);
  editing.initial = serializeEditor();
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeEditor() {
  if (!editing) return;
  const part = pagePartOf(editing.id);
  if (part) {
    editing = null;
    document.body.classList.remove('pf-editing');
    renderPagePart(part);
    return;
  }
  const p = projectById(editing.id);
  const el = editorEl();
  editing = null;
  document.body.classList.remove('pf-editing');
  if (el && p) {
    el.classList.remove('is-editing');
    el.innerHTML = pieceViewHtml(p);
    wirePieceView(el);
  }
}

function wireEditor(el) {
  const slugInput = el.querySelector('.ed-slug');
  slugInput.addEventListener('input', () => {
    el.querySelector('.ed-slug-preview').textContent = slugInput.value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  });

  el.querySelector('[data-ed="save"]').addEventListener('click', () => saveEditor({ stayOpen: false }));
  el.querySelector('[data-ed="cancel"]').addEventListener('click', async () => {
    if (isDirty() && !(await confirmDialog('Discard your changes?', '<p>Your edits to this piece will be thrown away.</p>', 'Discard changes', true)))
      return;
    closeEditor();
  });
  el.querySelector('[data-ed="more"]').addEventListener('click', async () => {
    const p = projectById(editing.id);
    const pick = await choose({
      title: p.title,
      choices: [
        { label: `History${p.version_count ? ` (${p.version_count} earlier version${p.version_count === 1 ? '' : 's'})` : ''}`, value: 'history', kind: 'secondary' },
        { label: p.archived ? 'Unarchive (show publicly)' : 'Archive (hide from public)', value: 'archive', kind: 'secondary' },
        { label: 'Delete piece…', value: 'delete', kind: 'danger' },
        { label: 'Close', value: null, kind: 'secondary' },
      ],
    });
    if (pick === 'history') showHistory();
    else if (pick === 'archive') toggleArchive();
    else if (pick === 'delete') deletePiece();
  });
  wirePhotoManager(el);
}

function editorValues() {
  const el = editorEl();
  const v = (sel) => el.querySelector(sel).value.trim();
  return {
    title: v('.ed-title'),
    month: v('.ed-month'),
    year_label: v('.ed-year-label'),
    event: v('.ed-event'),
    role: v('.ed-role'),
    credit: v('.ed-credit'),
    slug: v('.ed-slug'),
    sort: Number(v('.ed-sort')) || 0,
    body_html: sanitizeRichText(el.querySelector('.rte-editable').innerHTML),
    photos: [...el.querySelectorAll('.pf-photo-row')].map((r) => ({
      id: r.dataset.photoId,
      caption: r.querySelector('.ed-caption').value,
      fit: r.querySelector('.ed-fit').value,
    })),
  };
}

// Resolves true on success.
async function saveEditor({ stayOpen }) {
  const el = editorEl();
  if (!el) return true;
  const vals = editorValues();
  if (!vals.title) {
    notice('Please enter a title.');
    return false;
  }
  if (!vals.month) {
    notice('Please pick the month this happened.');
    return false;
  }
  const btn = el.querySelector('[data-ed="save"]');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    const { error } = await supabase.rpc('admin_update_portfolio_project', {
      p_session_token: adminToken,
      p_id: editing.id,
      p_slug: vals.slug,
      p_title: vals.title,
      p_occurred_on: vals.month + '-01', // always stored as the 1st of the month
      p_year_label: vals.year_label,
      p_event: vals.event,
      p_role: vals.role,
      p_credit: vals.credit,
      p_body_html: vals.body_html,
      p_sort_order: vals.sort,
    });
    if (error) {
      notice(rpcErrorMessage(error));
      return false;
    }
    if (vals.photos.length) {
      const { error: phErr } = await supabase.rpc('admin_update_portfolio_photos', {
        p_session_token: adminToken,
        p_photos: vals.photos,
      });
      if (phErr) {
        notice(rpcErrorMessage(phErr));
        return false;
      }
    }
    const id = editing.id;
    editing = null;
    await reloadAndRender();
    const p = projectById(id);
    if (p) history.replaceState(null, '', '#' + p.slug);
    if (stayOpen) openEditor(id);
    else listEl.querySelector(`.pf-piece[data-id="${id}"]`)?.scrollIntoView({ block: 'start' });
    notice('Saved.', 'success');
    return true;
  } finally {
    if (btn.isConnected) {
      btn.disabled = false;
      btn.textContent = 'Save';
    }
  }
}

async function reloadAndRender() {
  document.body.classList.remove('pf-editing');
  await load();
  renderAll();
}

// After a photo upload/replace/delete/reorder: refresh data, then redraw only the photo
// manager, keeping any unsaved text edits in the form and any unsaved caption edits.
async function refreshPhotosOnly() {
  const el = editorEl();
  const pendingCaptions = {};
  el.querySelectorAll('.pf-photo-row').forEach((r) => {
    pendingCaptions[r.dataset.photoId] = { caption: r.querySelector('.ed-caption').value, fit: r.querySelector('.ed-fit').value };
  });
  await load();
  const p = projectById(editing.id);
  editing.photos = (p?.photos || []).map((ph) => ({ ...ph }));
  el.querySelector('.pf-photo-manager').innerHTML = photoManagerHtml();
  wirePhotoManager(el);

  // re-apply pending edits to rows that still exist
  el.querySelectorAll('.pf-photo-row').forEach((r) => {
    const pend = pendingCaptions[r.dataset.photoId];
    if (pend) {
      r.querySelector('.ed-caption').value = pend.caption;
      r.querySelector('.ed-fit').value = pend.fit;
    }
  });
  // "initial" should reflect the saved photo state, so photo ops alone don't count as unsaved
  const initial = JSON.parse(editing.initial || '{}');
  initial.photos = editing.photos.map((ph) => [ph.id, ph.caption || '', ph.fit]);
  editing.initial = JSON.stringify(initial);
}

async function callPhotoFunction(fields) {
  const fd = new FormData();
  fd.append('token', adminToken);
  for (const [k, v] of Object.entries(fields)) {
    if (v instanceof Blob) fd.append(k, v, `${k}.jpg`);
    else if (v != null) fd.append(k, String(v));
  }
  const { data: res, error } = await supabase.functions.invoke('portfolio-photos', { body: fd });
  if (error) {
    const body = await readFunctionErrorBody(error);
    const code = body?.error || error.message;
    throw new Error(code === 'invalid_admin_session' ? rpcErrorMessage({ message: code }) : body?.detail || rpcErrorMessage({ message: code }));
  }
  return res;
}

// Resize + (for small images) ask how to frame it. Resolves null if the user cancels.
async function prepareWithPrompt(file) {
  const img = await prepareImage(file);
  let fit = 'normal';
  if (img.small) {
    fit = await askSmallImageFit(file.name, img.origWidth, img.origHeight);
    if (!fit) return null;
  }
  return { ...img, fit };
}

function wirePhotoManager(el) {
  const status = () => el.querySelector('.pf-upload-status');

  el.querySelector('#ed-add-photos')?.addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    let done = 0;
    for (const file of files) {
      try {
        status().textContent = `Preparing ${file.name}…`;
        const img = await prepareWithPrompt(file);
        if (!img) continue;
        status().textContent = `Uploading ${file.name}…`;
        await callPhotoFunction({
          action: 'upload',
          project_id: editing.id,
          full: img.full,
          display: img.display,
          width: img.width,
          height: img.height,
          fit: img.fit,
        });
        done++;
      } catch (err) {
        notice(`Upload failed for ${file.name}: ${err.message}`);
      }
    }
    if (done) await refreshPhotosOnly();
    status().textContent = done ? `Added ${done} photo${done === 1 ? '' : 's'}.` : '';
  });

  el.querySelectorAll('.pf-photo-row').forEach((row) => {
    const id = row.dataset.photoId;

    row.querySelector('[data-photo-act="replace"]').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        status().textContent = `Preparing ${file.name}…`;
        const img = await prepareWithPrompt(file);
        if (!img) return (status().textContent = '');
        status().textContent = 'Replacing photo…';
        await callPhotoFunction({
          action: 'replace',
          photo_id: id,
          full: img.full,
          display: img.display,
          width: img.width,
          height: img.height,
          fit: img.fit,
        });
        await refreshPhotosOnly();
        status().textContent = 'Photo replaced.';
      } catch (err) {
        status().textContent = '';
        notice(`Couldn't replace the photo: ${err.message}`);
      }
    });

    row.querySelector('[data-photo-act="delete"]').addEventListener('click', async () => {
      const ok = await confirmDialog('Delete this photo?', '<p>The photo file is removed for good. This can’t be undone.</p>', 'Delete photo', true);
      if (!ok) return;
      try {
        status().textContent = 'Deleting…';
        await callPhotoFunction({ action: 'delete_photo', photo_id: id });
        await refreshPhotosOnly();
        status().textContent = 'Photo deleted.';
      } catch (err) {
        status().textContent = '';
        notice(`Couldn't delete the photo: ${err.message}`);
      }
    });

    ['up', 'down'].forEach((dir) =>
      row.querySelector(`[data-photo-act="${dir}"]`).addEventListener('click', async () => {
        const ids = editing.photos.map((ph) => ph.id);
        const i = ids.indexOf(id);
        const j = dir === 'up' ? i - 1 : i + 1;
        if (j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        const { error } = await supabase.rpc('admin_reorder_portfolio_photos', {
          p_session_token: adminToken,
          p_project_id: editing.id,
          p_photo_ids: ids,
        });
        if (error) return notice(rpcErrorMessage(error));
        await refreshPhotosOnly();
      })
    );
  });
}

async function toggleArchive() {
  const p = projectById(editing.id);
  if (!(await resolveUnsaved(p.archived ? 'unarchive' : 'archive'))) return;
  const { error } = await supabase.rpc('admin_set_portfolio_project_archived', {
    p_session_token: adminToken,
    p_id: p.id,
    p_archived: !p.archived,
  });
  if (error) return notice(rpcErrorMessage(error));
  editing = null;
  await reloadAndRender();
  document.getElementById(p.slug)?.scrollIntoView({ block: 'start' });
  notice(p.archived ? 'Unarchived — it’s back on the public page.' : 'Archived — hidden from the public page. Only admins can see it here.', 'success');
}

async function deletePiece() {
  const p = projectById(editing.id);
  const photoCount = (p.photos || []).length;
  const choice = await choose({
    title: `Delete “${p.title}”?`,
    html: `<p>This removes the piece from the site permanently${photoCount ? `, including its ${photoCount} photo${photoCount === 1 ? '' : 's'}` : ''}.</p>
      <p>A copy of the text is kept in the edit history, but ${photoCount ? 'photos can’t be recovered' : 'it won’t be easy to bring back'}.
      <strong>Archiving</strong> hides it from the public instead, and can be undone any time.</p>`,
    choices: [
      { label: 'Delete permanently', value: 'delete', kind: 'danger' },
      { label: 'Archive instead', value: 'archive', kind: 'secondary' },
      { label: 'Cancel', value: null, kind: 'secondary' },
    ],
  });
  if (choice === 'archive') {
    if (!p.archived) await toggleArchive();
    return;
  }
  if (choice !== 'delete') return;
  try {
    await callPhotoFunction({ action: 'delete_project', project_id: p.id });
  } catch (err) {
    return notice(`Couldn't delete: ${err.message}`);
  }
  editing = null;
  history.replaceState(null, '', location.pathname);
  await reloadAndRender();
  notice(`Deleted “${p.title}”.`, 'success');
}

async function showHistory() {
  const { data: versions, error } = await supabase.rpc('admin_get_portfolio_versions', {
    p_session_token: adminToken,
    p_project_id: editing.id,
  });
  if (error) return notice(rpcErrorMessage(error));
  if (!versions?.length) {
    await choose({ title: 'No history yet', html: '<p>Earlier versions appear here each time this piece is saved.</p>', choices: [{ label: 'OK', value: null }] });
    return;
  }
  const textOf = (html) => {
    const t = document.createElement('template');
    t.innerHTML = sanitizeRichText(html || '');
    return (t.content.textContent || '').replace(/\s+/g, ' ').trim();
  };
  const choices = versions.slice(0, 15).map((v, i) => ({
    label: `${new Date(v.changed_at).toLocaleString()} — “${v.snapshot.title}”`,
    value: i,
    kind: 'secondary',
  }));
  choices.push({ label: 'Close', value: null });
  const pick = await choose({
    title: 'Earlier versions',
    html: `<p>Each entry is how the piece looked <em>before</em> a save. Pick one to load it into the editor — nothing changes until you press Save.</p>
      <ul class="pf-history-list">${versions
        .slice(0, 15)
        .map((v) => `<li><strong>${new Date(v.changed_at).toLocaleString()}</strong> — ${escapeHtml(textOf(v.snapshot.body_html).slice(0, 110))}…</li>`)
        .join('')}</ul>`,
    choices,
  });
  if (pick == null) return;
  const s = versions[pick].snapshot;
  const el = editorEl();
  const set = (sel, val) => (el.querySelector(sel).value = val ?? '');
  set('.ed-title', s.title);
  set('.ed-month', monthValue(s.occurred_on));
  set('.ed-year-label', s.year_label);
  set('.ed-event', s.event);
  set('.ed-role', s.role);
  set('.ed-credit', s.credit);
  set('.ed-slug', s.slug);
  set('.ed-sort', s.sort_order);
  el.querySelector('.rte-editable').innerHTML = sanitizeRichText(s.body_html || '');
  notice('Loaded an earlier version into the editor. Press Save to keep it, or Cancel to discard.', 'info');
}

// ---------------- admin: intro quote + credits editing ----------------

function pageEditorHtml(part) {
  const page = data.page || {};
  const body =
    part === 'intro'
      ? `<div class="field-group">
          <textarea class="pg-quote pf-quote-input" rows="4" maxlength="1000" placeholder="The quote" aria-label="Intro quote">${escapeHtml(page.intro_quote || '')}</textarea>
        </div>
        <div class="field-group">
          <label class="field">Attributed to (leave blank for none)</label>
          <input type="text" class="pg-attribution" maxlength="120" value="${escapeHtml(page.intro_attribution || '')}" placeholder="e.g. Inani" />
        </div>`
      : `${richTextEditorHtml(sanitizeRichText(page.footer_html || ''))}`;
  return `
    <div class="pf-editor">
      <div class="pf-editor-head"><strong>Editing ${PAGE_PARTS[part].label}</strong></div>
      ${body}
      <div class="pf-editor-actions">
        <button type="button" data-ed="save">Save</button>
        <button type="button" class="secondary" data-ed="cancel">Cancel &amp; revert</button>
        <button type="button" class="secondary pf-more-btn" data-ed="history" aria-label="History" title="History${page.version_count ? ` (${page.version_count})` : ''}">⋯</button>
      </div>
    </div>`;
}

function openPageEditor(part) {
  clearNotice();
  editing = { id: 'page:' + part, initial: '' };
  const el = document.getElementById(PAGE_PARTS[part].elId);
  el.classList.add('is-editing');
  document.body.classList.add('pf-editing');
  el.innerHTML = pageEditorHtml(part);
  const rte = el.querySelector('.rte');
  if (rte) wireRichTextEditor(rte);
  el.querySelector('[data-ed="save"]').addEventListener('click', () => savePageEditor());
  el.querySelector('[data-ed="cancel"]').addEventListener('click', async () => {
    if (isDirty() && !(await confirmDialog('Discard your changes?', `<p>Your edits to ${PAGE_PARTS[part].label} will be thrown away.</p>`, 'Discard changes', true)))
      return;
    closeEditor();
  });
  el.querySelector('[data-ed="history"]').addEventListener('click', () => showPageHistory(part));
  editing.initial = serializeEditor();
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.querySelector('textarea, .rte-editable')?.focus();
}

// Saves the whole page row: the part being edited from the form, the other from data.
async function savePageEditor() {
  const part = pagePartOf(editing?.id);
  const el = editorEl();
  if (!part || !el) return true;
  const page = data.page || {};
  const btn = el.querySelector('[data-ed="save"]');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    const { error } = await supabase.rpc('admin_save_portfolio_page', {
      p_session_token: adminToken,
      p_intro_quote: part === 'intro' ? el.querySelector('.pg-quote').value.trim() : page.intro_quote || '',
      p_intro_attribution: part === 'intro' ? el.querySelector('.pg-attribution').value.trim() : page.intro_attribution || '',
      p_footer_html: part === 'credits' ? sanitizeRichText(el.querySelector('.rte-editable').innerHTML) : page.footer_html || '',
    });
    if (error) {
      notice(rpcErrorMessage(error));
      return false;
    }
    editing = null;
    await reloadAndRender();
    notice('Saved.', 'success');
    return true;
  } finally {
    if (btn.isConnected) {
      btn.disabled = false;
      btn.textContent = 'Save';
    }
  }
}

async function showPageHistory(part) {
  const { data: versions, error } = await supabase.rpc('admin_get_portfolio_page_versions', { p_session_token: adminToken });
  if (error) return notice(rpcErrorMessage(error));
  if (!versions?.length) {
    await choose({ title: 'No history yet', html: '<p>Earlier versions appear here each time the intro or credits are saved.</p>', choices: [{ label: 'OK', value: null }] });
    return;
  }
  const textOf = (html) => {
    const t = document.createElement('template');
    t.innerHTML = sanitizeRichText(html || '');
    return (t.content.textContent || '').replace(/\s+/g, ' ').trim();
  };
  const preview = (v) =>
    part === 'intro'
      ? `“${v.snapshot.intro_quote || '(no quote)'}”${v.snapshot.intro_attribution ? ' — ' + v.snapshot.intro_attribution : ''}`
      : textOf(v.snapshot.footer_html) || '(no credits)';
  const list = versions.slice(0, 15);
  const choices = list.map((v, i) => ({ label: `Load ${new Date(v.changed_at).toLocaleString()}`, value: i, kind: 'secondary' }));
  choices.push({ label: 'Close', value: null });
  const pick = await choose({
    title: `Earlier versions of ${PAGE_PARTS[part].label}`,
    html: `<p>Each entry is how it looked <em>before</em> a save. Loading one puts it in the editor. Nothing changes until you press Save.</p>
      <ul class="pf-history-list">${list
        .map((v) => `<li><strong>${new Date(v.changed_at).toLocaleString()}</strong>: ${escapeHtml(preview(v).slice(0, 160))}</li>`)
        .join('')}</ul>`,
    choices,
  });
  if (pick == null) return;
  const snap = list[pick].snapshot;
  const el = editorEl();
  if (part === 'intro') {
    el.querySelector('.pg-quote').value = snap.intro_quote || '';
    el.querySelector('.pg-attribution').value = snap.intro_attribution || '';
  } else {
    el.querySelector('.rte-editable').innerHTML = sanitizeRichText(snap.footer_html || '');
  }
  notice('Loaded an earlier version into the editor. Press Save to keep it, or Cancel to discard.', 'info');
}

document.getElementById('pf-new-piece').addEventListener('click', async () => {
  if (editing && !(await resolveUnsaved('continue'))) return;
  const title = prompt('Title of the new piece:');
  if (!title || !title.trim()) return;
  const now = new Date();
  const { data: res, error } = await supabase.rpc('admin_create_portfolio_project', {
    p_session_token: adminToken,
    p_title: title.trim(),
    p_occurred_on: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`,
  });
  if (error) return notice(rpcErrorMessage(error));
  editing = null;
  await reloadAndRender();
  openEditor(res.id);
  notice('New piece created. Fill it in and press Save.', 'info');
});

// ---------------- unsaved-changes guards ----------------

// Closing the tab / reloading / typing a new address: browsers only allow their own
// generic "Leave site?" prompt here, not a custom one.
window.addEventListener('beforeunload', (e) => {
  if (isDirty()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Clicking a link that leaves this page: our own Save / Discard / Keep editing prompt.
document.addEventListener(
  'click',
  async (e) => {
    const a = e.target.closest('a[href]');
    if (!a || !isDirty()) return;
    if (a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const url = new URL(a.href, location.href);
    if (url.pathname === location.pathname && url.hash) return; // in-page jump, not leaving
    if (a.closest('.pf-editor')) return;
    e.preventDefault();
    if (await resolveUnsaved('leave')) {
      editing = null;
      location.href = a.href;
    }
  },
  true
);

// ---------------- contact form ----------------

const contactForm = document.getElementById('contact-form');
contactForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const ctNotice = document.getElementById('contact-notice');
  const show = (msg, kind = 'error') => (ctNotice.innerHTML = `<div class="notice ${kind}">${escapeHtml(msg)}</div>`);
  const name = document.getElementById('ct-name').value.trim();
  const email = document.getElementById('ct-email').value.trim();
  const message = document.getElementById('ct-message').value.trim();
  if (!name) return show('Please enter your name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return show('Please enter a valid email so Inani can write back.');
  if (!message) return show('Please write a message.');

  const btn = document.getElementById('ct-submit');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    const { error } = await supabase.functions.invoke('submit-message', {
      body: { kind: 'contact', name, email, message, page: 'portfolio', website: document.getElementById('ct-website').value },
    });
    if (error) {
      const body = await readFunctionErrorBody(error);
      return show(body?.detail || rpcErrorMessage({ message: body?.error || error.message }));
    }
    ctNotice.innerHTML = '';
    contactForm.innerHTML = `<p style="margin:0;">Thank you, ${escapeHtml(name.split(/\s+/)[0])} — your message is on its way to Inani.</p>`;
  } finally {
    if (btn.isConnected) {
      btn.disabled = false;
      btn.textContent = 'Send message';
    }
  }
});

// ---------------- init ----------------

(async () => {
  const ok = await load();
  if (!ok) return;
  renderAll();
  scrollToHash();
})();
window.addEventListener('hashchange', scrollToHash);
