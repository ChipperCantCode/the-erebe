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
