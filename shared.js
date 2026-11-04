import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const SUPABASE_URL = 'https://ujreupbodrqosdttmdkp.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVqcmV1cGJvZHJxb3NkdHRtZGtwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxMjU2OTcsImV4cCI6MjEwMTcwMTY5N30.HOIinzgXqwY_Fr3v_JewslRNFJ6Ln5z1b8lVQ6lRXds';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------- donor session ----------
const DONOR_TOKEN_KEY = 'erebe_donor_token';

export function getDonorToken() {
  return localStorage.getItem(DONOR_TOKEN_KEY) || '';
}
export function setDonorToken(token) {
  localStorage.setItem(DONOR_TOKEN_KEY, token);
}
export function clearDonorToken() {
  localStorage.removeItem(DONOR_TOKEN_KEY);
}

// ---------- admin session ----------
const ADMIN_TOKEN_KEY = 'erebe_admin_token';

export function getAdminToken() {
  return localStorage.getItem(ADMIN_TOKEN_KEY) || '';
}
export function setAdminToken(token) {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
}
export function clearAdminToken() {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}

// ---------- shared "signed in as X · Log out" header widget ----------
// Donor sessions carry across index/participate/contribute (same localStorage token),
// but only my-list.html showed who you were signed in as or offered a way to log out.
// Call this on any page with a #account-status element to fix that.
export async function renderAccountStatus(containerEl) {
  const token = getDonorToken();
  if (!token || !containerEl) return;

  const { data, error } = await supabase.rpc('get_my_donor_info', { p_session_token: token });
  if (error) {
    clearDonorToken();
    return;
  }
  const info = Array.isArray(data) ? data[0] : data;
  if (!info) return;

  containerEl.innerHTML = `
    <span class="account-pill">Signed in as ${escapeHtml(info.chosen_name)}</span>
    <button type="button" class="secondary small" id="account-logout-btn">Log out</button>`;
  containerEl.classList.remove('hidden');

  document.getElementById('account-logout-btn').addEventListener('click', () => {
    clearDonorToken();
    location.reload();
  });
}

// ---------- draft cart (survives reloads, cleared on submit) ----------
const CART_KEY = 'erebe_cart_v1';

export function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) || '{}');
  } catch {
    return {};
  }
}
export function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}
export function clearCart() {
  localStorage.removeItem(CART_KEY);
}

// ---------- quantity parsing: supports plain numbers and fractions like "1/4" or "1 1/2" ----------
export function parseQuantity(raw) {
  if (raw == null) return NaN;
  const s = String(raw).trim();
  if (!s) return NaN;

  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const whole = Number(mixed[1]);
    const num = Number(mixed[2]);
    const den = Number(mixed[3]);
    if (den === 0) return NaN;
    return whole + num / den;
  }

  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) {
    const num = Number(frac[1]);
    const den = Number(frac[2]);
    if (den === 0) return NaN;
    return num / den;
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export function formatQuantity(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  if (Number.isInteger(num)) return String(num);
  // show a few decimals, trimmed
  return num.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

// ---------- unit-aware quantity display/input (USD $, % fill, or generic count) ----------
export function formatQuantityDisplay(n, unit) {
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  if (unit === 'USD') {
    return '$' + num.toLocaleString(undefined, { minimumFractionDigits: num % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
  }
  if (unit === '%') {
    return formatQuantity(num) + '%';
  }
  if (unit === 'people' && num === 1) return '1 person';
  return formatQuantity(num) + (unit ? ' ' + unit : '');
}

// html for the quantity <input> appropriate to an item's unit — % and USD get plain
// number inputs with sensible min/step, everything else keeps the fraction-capable text input
export function quantityInputHtml(item, className, existingValue, extraAttrs = '') {
  const val = existingValue === '' || existingValue == null ? '' : existingValue;
  if (item.unit === '%') {
    return `<input type="number" class="${className}" min="1" max="100" step="1" placeholder="% (1-100)" value="${val}" ${extraAttrs} />`;
  }
  if (item.unit === 'USD') {
    return `<input type="number" class="${className}" min="0.01" step="0.01" placeholder="Amount in $" value="${val}" ${extraAttrs} />`;
  }
  return `<input type="text" class="${className}" placeholder="Quantity, e.g. 2 or 1/4" value="${val === '' ? '' : formatQuantity(val)}" ${extraAttrs} />`;
}

export function parseQuantityForItem(item, raw) {
  if (item.unit === '%' || item.unit === 'USD') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : NaN;
  }
  return parseQuantity(raw);
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ---------- crew location (shared across contribute/my-list/admin) ----------
// Stored values (colab, event_site, both, remote) are fixed by the database; only the labels change.
export const CREW_LOCATION_OPTIONS = [
  ['', 'N/A / not sure yet'],
  ['remote', "Remote — not physically on-site"],
  ['colab', 'Before the event (upgrades and repairs)'],
  ['event_site', 'On playa at Black Rock City'],
  ['both', 'Both'],
];
export const CREW_LOCATION_LABELS = {
  remote: 'Remote — not physically on-site',
  colab: 'Before the event (upgrades and repairs)',
  event_site: 'On playa at Black Rock City',
  both: 'Both',
};

// ---------- rich text: strict allowlist sanitizer for admin-authored homepage copy ----------
// This is the actual security boundary for the homepage-content editor: body_html is
// stored as-is (writes only happen through the admin-passcode-gated RPCs), but nothing
// gets set via innerHTML on a page a regular visitor loads until it's passed through
// this. Strips any tag/attribute not explicitly allowed, including inline event
// handlers, <script>/<style>/<iframe>, and non-http(s)/mailto link targets.
const RICH_TEXT_ALLOWED_TAGS = new Set([
  'P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'H1', 'H2', 'H3', 'UL', 'OL', 'LI', 'A', 'SPAN', 'DIV', 'BLOCKQUOTE',
]);
const RICH_TEXT_ALLOWED_ATTRS = { A: ['href'] };
// these carry non-visible content (code/CSS) — drop them entirely rather than
// unwrapping to text, or their "content" would leak onto the page as garbage text
const RICH_TEXT_STRIP_ENTIRELY = new Set(['SCRIPT', 'STYLE']);

export function sanitizeRichText(html) {
  const template = document.createElement('template');
  template.innerHTML = html || '';

  function clean(node) {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        if (RICH_TEXT_STRIP_ENTIRELY.has(child.tagName)) {
          child.remove();
          return;
        }
        if (!RICH_TEXT_ALLOWED_TAGS.has(child.tagName)) {
          child.replaceWith(document.createTextNode(child.textContent || ''));
          return;
        }
        const allowedAttrs = RICH_TEXT_ALLOWED_ATTRS[child.tagName] || [];
        [...child.attributes].forEach((attr) => {
          if (!allowedAttrs.includes(attr.name)) child.removeAttribute(attr.name);
        });
        if (child.tagName === 'A') {
          const href = child.getAttribute('href') || '';
          if (!/^https?:\/\//i.test(href) && !/^mailto:/i.test(href)) {
            child.removeAttribute('href');
          } else {
            child.setAttribute('target', '_blank');
            child.setAttribute('rel', 'noopener noreferrer');
          }
        }
        clean(child);
      } else if (child.nodeType !== Node.TEXT_NODE) {
        child.remove();
      }
    });
  }

  clean(template.content);
  return template.innerHTML;
}

// ---------- rich text editor (admin homepage copy + portfolio inline editor) ----------
// A small toolbar over a contenteditable box, driven by document.execCommand -- deprecated
// but still implemented everywhere for this basic a feature set, and it keeps the no-build
// setup. Always pass the result through sanitizeRichText() before saving.
export function richTextEditorHtml(bodyHtml) {
  return `
    <div class="rte">
      <div class="rte-toolbar">
        <button type="button" class="secondary" data-cmd="bold" title="Bold"><b>B</b></button>
        <button type="button" class="secondary" data-cmd="italic" title="Italic"><i>I</i></button>
        <button type="button" class="secondary" data-cmd="formatBlock" data-value="H2" title="Heading">H2</button>
        <button type="button" class="secondary" data-cmd="formatBlock" data-value="P" title="Paragraph">¶</button>
        <button type="button" class="secondary" data-cmd="insertUnorderedList" title="Bullet list">• List</button>
        <button type="button" class="secondary" data-cmd="insertOrderedList" title="Numbered list">1. List</button>
        <button type="button" class="secondary" data-cmd="createLink" title="Add link">Link</button>
        <button type="button" class="secondary" data-cmd="unlink" title="Remove link">Unlink</button>
        <button type="button" class="secondary" data-cmd="removeFormat" title="Clear formatting">Clear</button>
      </div>
      <div class="rte-editable" contenteditable="true">${bodyHtml || ''}</div>
    </div>`;
}

export function wireRichTextEditor(container) {
  const editable = container.querySelector('.rte-editable');
  container.querySelectorAll('.rte-toolbar [data-cmd]').forEach((btn) => {
    btn.addEventListener('click', () => {
      editable.focus();
      const cmd = btn.dataset.cmd;
      if (cmd === 'createLink') {
        const url = prompt('Link URL (https://... or mailto:...)');
        if (!url) return;
        document.execCommand('createLink', false, url);
      } else {
        document.execCommand(cmd, false, btn.dataset.value || null);
      }
    });
  });
}

// ---------- storage + edge function helpers ----------
// Public bucket URL for a stored photo. With { download: 'name.jpg' } the response is sent
// as an attachment, which makes the browser save it (a plain <a download> is ignored for
// cross-origin files like these).
export function photoUrl(bucket, path, { download } = {}) {
  if (!path) return '';
  const base = `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
  return download ? `${base}?download=${encodeURIComponent(download)}` : base;
}

// supabase-js only fills `data` for 2xx responses from functions.invoke(); for anything
// else the JSON body we returned has to be read off error.context (the raw Response).
export async function readFunctionErrorBody(error) {
  try {
    return await error.context.json();
  } catch {
    return null;
  }
}

// ---------- misc ----------
export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function rpcErrorMessage(err) {
  const code = err?.message || err?.error_description || String(err);
  const known = {
    name_taken: 'That chosen name is already in use — try another, or log in if it’s yours.',
    incorrect_passcode: 'That passcode doesn’t match the chosen name. Try again.',
    not_found: 'We don’t have a donor by that chosen name yet. Sign up instead.',
    invalid_session: 'Your session expired. Please log in again.',
    invalid_admin_session: 'Admin session expired. Please log in again.',
    incorrect_credentials: 'Incorrect admin name or passcode.',
    reason_required: 'Please tell us why you’re making this change.',
    new_quantity_must_be_smaller: 'The new amount must be smaller than what you originally offered. To increase, add it as a new item instead.',
    chosen_name_required: 'Please enter a chosen name.',
    passcode_too_short: 'Passcode should be at least 3 characters.',
    contact_name_required: 'Please enter your name.',
    email_required: 'Please enter your email address.',
    slug_taken: 'Another piece already uses that link name (slug). Pick a different one.',
    slug_required: 'The link name (slug) can’t be empty.',
    title_required: 'Please enter a title.',
    month_required: 'Please pick the month this happened.',
    section_not_empty: 'That section still has photos in it — move or delete them first.',
    not_your_photo: 'You can only change photos you uploaded while logged in.',
    rights_not_confirmed: 'Please confirm you have the right to share this photo.',
    photographer_required: 'Please say who took this photo.',
    bad_image: 'That file doesn’t look like a supported image (JPEG, PNG, or WebP up to 10 MB).',
    email_invalid: 'That email address doesn’t look right.',
    message_required: 'Please write a message.',
    name_required: 'Please enter your name.',
    item_has_contributions: 'This item has contributions logged against it — remove those first, or archive the item instead.',
  };
  for (const key of Object.keys(known)) {
    if (code.includes(key)) return known[key];
  }
  return code;
}
