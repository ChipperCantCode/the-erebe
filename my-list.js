import {
  supabase,
  getDonorToken,
  setDonorToken,
  clearDonorToken,
  formatQuantity,
  formatQuantityDisplay,
  quantityInputHtml,
  parseQuantityForItem,
  escapeHtml,
  rpcErrorMessage,
  CREW_LOCATION_LABELS,
} from './shared.js';

const noticeArea = document.getElementById('notice-area');
function notice(msg, kind = 'error') {
  noticeArea.innerHTML = `<div class="notice ${kind}">${escapeHtml(msg)}</div>`;
}
function clearNotice() {
  noticeArea.innerHTML = '';
}

let token = getDonorToken();
let contributions = [];

const loginBox = document.getElementById('login-box');
const dashboard = document.getElementById('dashboard');

document.getElementById('login-btn').addEventListener('click', async () => {
  clearNotice();
  const chosenName = document.getElementById('li-chosen-name').value.trim();
  const passcode = document.getElementById('li-passcode').value;
  if (!chosenName || !passcode) {
    notice('Enter your chosen name and passcode.');
    return;
  }
  const { data, error } = await supabase.rpc('donor_login', { p_chosen_name: chosenName, p_passcode: passcode });
  if (error) {
    notice(rpcErrorMessage(error));
    return;
  }
  token = data;
  setDonorToken(token);
  await loadDashboard();
});

document.getElementById('logout-btn').addEventListener('click', () => {
  clearDonorToken();
  token = '';
  location.reload();
});

document.getElementById('save-contact').addEventListener('click', async () => {
  const name = document.getElementById('contact-name').value.trim();
  const email = document.getElementById('contact-email').value.trim();
  const { error } = await supabase.rpc('update_donor_contact', {
    p_session_token: token,
    p_contact_name: name,
    p_email: email,
  });
  if (error) notice(rpcErrorMessage(error));
  else notice('Saved.', 'success');
});

document.getElementById('anon-toggle').addEventListener('change', async (e) => {
  const { error } = await supabase.rpc('set_donor_anonymous', {
    p_session_token: token,
    p_is_anonymous: e.target.checked,
  });
  if (error) {
    notice(rpcErrorMessage(error));
    e.target.checked = !e.target.checked;
  }
});

function contributionCardHtml(c) {
  const pending = c.pending_change;
  const removed = c.status === 'removed';
  const details = [];
  if (c.crew_location) details.push(`Where: ${CREW_LOCATION_LABELS[c.crew_location] || c.crew_location}`);
  if (c.arrival_date) details.push(`Available from: ${c.arrival_date}`);
  if (c.departure_date) details.push(`Available until: ${c.departure_date}`);
  if (c.loan_or_donated) details.push(c.loan_or_donated === 'loan' ? 'Loan' : 'Donated');
  if (c.pickup_method) details.push(`Pickup: ${c.pickup_method}${c.pickup_method_other ? ' — ' + c.pickup_method_other : ''}`);
  if (c.pickup_timing) details.push(`Timing: ${c.pickup_timing}${c.pickup_timing_other ? ' — ' + c.pickup_timing_other : ''}`);
  if (c.pickup_location) details.push(`Where from: ${c.pickup_location}`);
  if (c.care_instructions) details.push(`Notes: ${c.care_instructions}`);

  return `
  <div class="card" data-id="${c.id}">
    <div class="item-head">
      <div class="item-name${removed ? ' fulfilled' : ''}">${escapeHtml(c.item_name)} — ${formatQuantityDisplay(c.quantity, c.item_unit)}</div>
      <span class="pill">${escapeHtml(c.item_category)}</span>
    </div>
    ${details.length ? `<div class="item-desc">${escapeHtml(details.join(' · '))}</div>` : ''}
    ${
      removed
        ? `<span class="pill denied">Removed</span>`
        : pending
        ? `<span class="pill pending">Change requested: ${pending.requested_quantity == null ? 'remove entirely' : 'reduce to ' + formatQuantityDisplay(pending.requested_quantity, c.item_unit)} — awaiting review</span>`
        : `<button type="button" class="secondary small" data-action="change">Request a change</button>`
    }
    <div class="change-form hidden" style="margin-top:10px;">
      <div class="field-group">
        <label class="field">What do you need to change?</label>
        <select class="change-type">
          <option value="reduce">Reduce the quantity</option>
          <option value="remove">Remove this item entirely</option>
        </select>
      </div>
      <div class="field-group new-qty-group">
        <label class="field">New quantity (must be smaller than ${formatQuantityDisplay(c.quantity, c.item_unit)})</label>
        ${quantityInputHtml({ unit: c.item_unit }, 'new-qty-input', '')}
      </div>
      <div class="field-group">
        <label class="field">Reason for the change</label>
        <textarea class="reason-input" rows="2"></textarea>
      </div>
      <button type="button" class="small" data-action="confirm-change">Submit change request</button>
      <button type="button" class="secondary small" data-action="cancel-change">Cancel</button>
    </div>
  </div>`;
}

function wireContributionCard(el, c) {
  const changeBtn = el.querySelector('[data-action="change"]');
  const form = el.querySelector('.change-form');
  const typeSelect = el.querySelector('.change-type');
  const qtyGroup = el.querySelector('.new-qty-group');
  const qtyInput = el.querySelector('.new-qty-input');
  const reasonInput = el.querySelector('.reason-input');

  changeBtn?.addEventListener('click', () => form.classList.remove('hidden'));
  el.querySelector('[data-action="cancel-change"]')?.addEventListener('click', () => form.classList.add('hidden'));

  typeSelect?.addEventListener('change', () => {
    qtyGroup.classList.toggle('hidden', typeSelect.value === 'remove');
  });

  el.querySelector('[data-action="confirm-change"]')?.addEventListener('click', async () => {
    clearNotice();
    const reason = reasonInput.value.trim();
    if (!reason) {
      notice('Please tell us the reason for this change.');
      return;
    }
    let newQty = null;
    if (typeSelect.value === 'reduce') {
      newQty = parseQuantityForItem({ unit: c.item_unit }, qtyInput.value);
      if (!Number.isFinite(newQty) || newQty <= 0 || newQty >= c.quantity) {
        notice(`New quantity must be a positive number smaller than ${formatQuantityDisplay(c.quantity, c.item_unit)}.`);
        return;
      }
    }
    const { error } = await supabase.rpc('request_contribution_change', {
      p_session_token: token,
      p_contribution_id: c.id,
      p_new_quantity: newQty,
      p_reason: reason,
    });
    if (error) {
      notice(rpcErrorMessage(error));
      return;
    }
    notice('Change requested — Inani and the team will review it.', 'success');
    await loadDashboard();
  });
}

async function loadDashboard() {
  clearNotice();
  const [{ data: info, error: infoErr }, { data: contribs, error: contribErr }] = await Promise.all([
    supabase.rpc('get_my_donor_info', { p_session_token: token }),
    supabase.rpc('get_my_contributions', { p_session_token: token }),
  ]);

  if (infoErr || contribErr) {
    notice(rpcErrorMessage(infoErr || contribErr));
    clearDonorToken();
    token = '';
    loginBox.classList.remove('hidden');
    dashboard.classList.add('hidden');
    return;
  }

  const donor = Array.isArray(info) ? info[0] : info;
  document.getElementById('contact-name').value = donor.contact_name || '';
  document.getElementById('contact-email').value = donor.email || '';
  document.getElementById('anon-toggle').checked = !!donor.is_anonymous;

  contributions = contribs || [];
  const list = document.getElementById('contrib-list');
  const active = contributions.filter((c) => c.status !== 'removed');
  const removed = contributions.filter((c) => c.status === 'removed');

  list.innerHTML =
    (active.length ? active.map(contributionCardHtml).join('') : '<p class="intro">No active contributions yet.</p>') +
    (removed.length
      ? `<details style="margin-top:12px;"><summary style="cursor:pointer; color:var(--text-faint);">Removed items (${removed.length})</summary>${removed.map(contributionCardHtml).join('')}</details>`
      : '');

  list.querySelectorAll('.card').forEach((el) => {
    const c = contributions.find((x) => x.id === el.dataset.id);
    if (c) wireContributionCard(el, c);
  });

  loginBox.classList.add('hidden');
  dashboard.classList.remove('hidden');
}

async function init() {
  if (!token) {
    loginBox.classList.remove('hidden');
    return;
  }
  await loadDashboard();
}

init();
