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

// ---------- build window + crew location (shared across contribute/my-list/admin) ----------
export const BUILD_START_DATE = '2026-09-16';
export const BUILD_END_DATE = '2026-10-07';
export const BUILD_WINDOW_LABEL = 'Sept 16 – Oct 7, 2026';

export const CREW_LOCATION_OPTIONS = [
  ['', 'N/A / not sure yet'],
  ['remote', "Remote — not physically on-site"],
  ['colab', 'CoLab (prefab shop)'],
  ['event_site', 'Event site (main build)'],
  ['both', 'Both CoLab and event site'],
];
export const CREW_LOCATION_LABELS = {
  remote: 'Remote — not physically on-site',
  colab: 'CoLab (prefab shop)',
  event_site: 'Event site (main build)',
  both: 'Both CoLab and event site',
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
  };
  for (const key of Object.keys(known)) {
    if (code.includes(key)) return known[key];
  }
  return code;
}
