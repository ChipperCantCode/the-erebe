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

// Local calendar date as YYYY-MM-DD (toISOString() would give the UTC date, which is
// already "tomorrow" on Pacific evenings).
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatWorkDate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatHours(h) {
  const n = Number(h);
  return `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, '')} hr${n === 1 ? '' : 's'}`;
}

function renderHours(entries) {
  const el = document.getElementById('hours-list');
  if (!entries.length) {
    el.innerHTML = '<p class="intro" style="margin:0;">No hours logged yet.</p>';
    return;
  }
  const total = entries.reduce((sum, e) => sum + Number(e.hours), 0);
  el.innerHTML =
    `<p style="margin:0 0 8px;"><strong>Total: ${formatHours(total)}</strong> across ${new Set(entries.map((e) => e.work_date)).size} day(s)</p>` +
    entries
      .map(
        (e) => `
      <div class="hours-row" data-id="${e.id}">
        <div>
          <strong>${escapeHtml(formatWorkDate(e.work_date))}</strong> — ${formatHours(e.hours)}
          ${e.note ? `<div class="item-desc" style="margin:2px 0 0;">${escapeHtml(e.note)}</div>` : ''}
          ${e.entered_by === 'admin' ? '<div class="item-desc" style="margin:2px 0 0;">Added by an organizer</div>' : ''}
        </div>
        <button type="button" class="secondary small" data-action="delete-hours">Delete</button>
      </div>`
      )
      .join('');
  el.querySelectorAll('[data-action="delete-hours"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this entry?')) return;
      const id = btn.closest('.hours-row').dataset.id;
      const { error } = await supabase.rpc('delete_my_hours', { p_session_token: token, p_id: id });
      if (error) notice(rpcErrorMessage(error));
      else await loadHours();
    });
  });
}

async function loadHours() {
  const { data, error } = await supabase.rpc('get_my_hours', { p_session_token: token });
  if (error) {
    // Hide the section rather than showing an error if hour tracking isn't set up in
    // the database yet, so the rest of My List keeps working.
    document.getElementById('hours-section').classList.add('hidden');
    return;
  }
  document.getElementById('hours-section').classList.remove('hidden');
  renderHours(data || []);
}

document.getElementById('hours-date').value = todayLocal();
document.getElementById('hours-date').max = todayLocal();

document.getElementById('log-hours-btn').addEventListener('click', async () => {
  clearNotice();
  const workDate = document.getElementById('hours-date').value;
  const hours = Number(document.getElementById('hours-amount').value);
  const note = document.getElementById('hours-note').value.trim();
  if (!workDate) {
    notice('Pick the day you worked.');
    return;
  }
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
    notice('Hours should be a number between 0 and 24.');
    return;
  }
  const btn = document.getElementById('log-hours-btn');
  btn.disabled = true;
  const { error } = await supabase.rpc('log_my_hours', {
    p_session_token: token,
    p_work_date: workDate,
    p_hours: hours,
    p_note: note,
  });
  btn.disabled = false;
  if (error) {
    notice(rpcErrorMessage(error));
    return;
  }
  document.getElementById('hours-amount').value = '';
  document.getElementById('hours-note').value = '';
  notice(`Logged ${formatHours(hours)} — thank you!`, 'success');
  await loadHours();
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
  await loadHours();
}

async function init() {
  if (!token) {
    loginBox.classList.remove('hidden');
    return;
  }
  await loadDashboard();
}

init();
