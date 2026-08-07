import {
  supabase,
  getCart,
  saveCart,
  clearCart,
  getDonorToken,
  setDonorToken,
  formatQuantity,
  formatQuantityDisplay,
  quantityInputHtml,
  parseQuantityForItem,
  escapeHtml,
  rpcErrorMessage,
  CREW_LOCATION_OPTIONS,
  CREW_LOCATION_LABELS,
  BUILD_START_DATE,
  BUILD_END_DATE,
  BUILD_WINDOW_LABEL,
} from './shared.js';

const noticeArea = document.getElementById('notice-area');
function notice(msg, kind = 'error') {
  noticeArea.innerHTML = `<div class="notice ${kind}">${escapeHtml(msg)}</div>`;
  noticeArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function clearNotice() {
  noticeArea.innerHTML = '';
}

// Which detail questions apply depends on the item's category — a cash donation doesn't
// need pickup logistics, a material doesn't need crew availability, etc.
const VOLUNTEER_FIELD_GROUPS = [
  { key: 'crew_location', label: 'Where will you help?', type: 'radio', options: CREW_LOCATION_OPTIONS },
  {
    key: 'arrival_date',
    label: `Available from (build runs ${BUILD_WINDOW_LABEL})`,
    type: 'date',
    min: BUILD_START_DATE,
    max: BUILD_END_DATE,
  },
  { key: 'departure_date', label: 'Available until', type: 'date', min: BUILD_START_DATE, max: BUILD_END_DATE },
];

const MATERIAL_FIELD_GROUPS = [
  {
    key: 'loan_or_donated',
    label: 'Is this a loan or a donation?',
    type: 'radio',
    options: [
      ['', 'N/A'],
      ['loan', 'Loan (we return it)'],
      ['donated', 'Donated (it stays with the project)'],
    ],
  },
  {
    key: 'pickup_method',
    label: 'How can we get it from you?',
    type: 'select',
    options: ['', 'Drop off at CoLab', 'Please pick it up from me', "I'll bring it to the build/event", 'Other'],
    otherKey: 'pickup_method_other',
  },
  {
    key: 'pickup_timing',
    label: 'When can we get it?',
    type: 'select',
    options: ['', 'Before the build', 'During the build', 'At the event', 'Other'],
    otherKey: 'pickup_timing_other',
  },
  { key: 'pickup_location', label: 'Where (address / description)', type: 'text' },
  {
    key: 'care_instructions',
    label: 'Maintenance, use, or return instructions (especially for loans)',
    type: 'textarea',
  },
];

const DONATION_FIELD_GROUPS = [
  { key: 'care_instructions', label: 'Anything else we should know? (optional)', type: 'textarea' },
];

const ALL_FIELD_GROUPS = [...VOLUNTEER_FIELD_GROUPS, ...MATERIAL_FIELD_GROUPS, ...DONATION_FIELD_GROUPS];

function fieldGroupsForCategory(category) {
  if (category === 'volunteer') return VOLUNTEER_FIELD_GROUPS;
  if (category === 'material') return MATERIAL_FIELD_GROUPS;
  if (category === 'donation') return DONATION_FIELD_GROUPS;
  return [];
}

let allItems = []; // from get_wishlist
let selected = {}; // item_id -> {quantity, name, category, unit}
let details = {}; // item_id -> {field: value}
let sameForAll = {}; // field key -> boolean
let donorToken = getDonorToken();
let donorInfo = null;

const steps = ['step-1', 'step-2', 'step-3', 'step-4', 'step-done'];
function showStep(id) {
  steps.forEach((s) => document.getElementById(s).classList.toggle('hidden', s !== id));
  document.querySelectorAll('.step-indicator .step').forEach((el) => {
    el.classList.toggle('active', 'step-' + el.dataset.step === id);
  });
  clearNotice();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------------- STEP 1 ----------------

function renderSelectedItems() {
  const el = document.getElementById('selected-items');
  const ids = Object.keys(selected);
  if (ids.length === 0) {
    el.innerHTML = '<p class="intro">Nothing picked yet — add something from the wish list below.</p>';
  } else {
    el.innerHTML = ids
      .map((id) => {
        const s = selected[id];
        return `
        <div class="card" data-id="${id}">
          <div class="item-head">
            <div class="item-name">${escapeHtml(s.name)}</div>
            <button type="button" class="secondary small" data-action="remove-selected">Remove</button>
          </div>
          <div class="row" style="margin-top:6px;">
            <div>
              <label class="field">Quantity</label>
              ${quantityInputHtml(s, 'sel-qty', s.quantity)}
            </div>
          </div>
        </div>`;
      })
      .join('');

    el.querySelectorAll('[data-action="remove-selected"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.target.closest('.card').dataset.id;
        delete selected[id];
        syncCartFromSelected();
        renderSelectedItems();
        renderFullPicker();
        updateStep1Count();
      });
    });
    el.querySelectorAll('.sel-qty').forEach((input) => {
      input.addEventListener('change', (e) => {
        const id = e.target.closest('.card').dataset.id;
        const q = parseQuantityForItem(selected[id], e.target.value);
        if (Number.isFinite(q) && q > 0 && !(selected[id].unit === '%' && q > 100)) {
          selected[id].quantity = q;
          syncCartFromSelected();
        } else {
          e.target.value = formatQuantity(selected[id].quantity);
        }
      });
    });
  }
  updateStep1Count();
}

function syncCartFromSelected() {
  saveCart(selected);
}

function updateStep1Count() {
  const n = Object.keys(selected).length;
  document.getElementById('step1-count').textContent = `${n} item${n === 1 ? '' : 's'} selected`;
}

function renderFullPicker() {
  const el = document.getElementById('full-item-picker');
  const available = allItems.filter((i) => !selected[i.id]);
  if (available.length === 0) {
    el.innerHTML = '<p class="intro">Everything is already in your list.</p>';
    return;
  }
  el.innerHTML = available
    .map(
      (i) => `
      <div class="card" data-id="${i.id}">
        <div class="item-head">
          <div class="item-name">${escapeHtml(i.name)}</div>
        </div>
        <div class="row" style="margin-top:6px;">
          ${quantityInputHtml(i, 'pick-qty', '')}
          <button type="button" class="small" data-action="add-item">Add</button>
        </div>
      </div>`
    )
    .join('');

  el.querySelectorAll('[data-action="add-item"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      const id = card.dataset.id;
      const item = allItems.find((i) => i.id === id);
      const qtyInput = card.querySelector('.pick-qty');
      const q = parseQuantityForItem(item, qtyInput.value);
      if (!Number.isFinite(q) || q <= 0) {
        notice('Enter a valid quantity before adding.');
        return;
      }
      if (item.unit === '%' && q > 100) {
        notice('Percentage can\'t be more than 100.');
        return;
      }
      selected[id] = { quantity: q, name: item.name, category: item.category, unit: item.unit || '' };
      syncCartFromSelected();
      clearNotice();
      renderSelectedItems();
      renderFullPicker();
    });
  });
}

document.getElementById('to-step-2').addEventListener('click', () => {
  if (Object.keys(selected).length === 0) {
    notice('Pick at least one item before continuing.');
    return;
  }
  showStep('step-2');
  refreshAuthUi();
});

// ---------------- STEP 2 ----------------

function refreshAuthUi() {
  const loggedInBox = document.getElementById('already-logged-in');
  const authForms = document.getElementById('auth-forms');
  if (donorToken) {
    loggedInBox.classList.remove('hidden');
    authForms.classList.add('hidden');
    document.getElementById('logged-in-name').textContent = donorInfo?.chosen_name || '(loading...)';
  } else {
    loggedInBox.classList.add('hidden');
    authForms.classList.remove('hidden');
  }
}

document.getElementById('logout-switch').addEventListener('click', () => {
  donorToken = '';
  donorInfo = null;
  localStorage.removeItem('erebe_donor_token');
  refreshAuthUi();
});

document.querySelectorAll('.tabs [data-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs [data-mode]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const mode = btn.dataset.mode;
    document.getElementById('signup-form').classList.toggle('hidden', mode !== 'signup');
    document.getElementById('login-form').classList.toggle('hidden', mode !== 'login');
  });
});

document.getElementById('back-to-1').addEventListener('click', () => showStep('step-1'));

document.getElementById('to-step-3').addEventListener('click', async () => {
  clearNotice();
  if (donorToken) {
    buildDetailSteps();
    showStep('step-3');
    return;
  }

  const activeMode = document.querySelector('.tabs [data-mode].active').dataset.mode;
  const btn = document.getElementById('to-step-3');
  btn.disabled = true;
  try {
    if (activeMode === 'signup') {
      const chosenName = document.getElementById('su-chosen-name').value.trim();
      const passcode = document.getElementById('su-passcode').value;
      const contactName = document.getElementById('su-contact-name').value.trim();
      const email = document.getElementById('su-email').value.trim();
      if (!contactName || !email || !chosenName || !passcode) {
        notice('Please fill in your name, email, a chosen login name, and a passcode.');
        return;
      }
      const { data, error } = await supabase.rpc('donor_register', {
        p_chosen_name: chosenName,
        p_passcode: passcode,
        p_contact_name: contactName,
        p_email: email,
      });
      if (error) {
        notice(rpcErrorMessage(error));
        return;
      }
      donorToken = data;
      setDonorToken(donorToken);
    } else {
      const chosenName = document.getElementById('li-chosen-name').value.trim();
      const passcode = document.getElementById('li-passcode').value;
      if (!chosenName || !passcode) {
        notice('Enter your chosen name and passcode.');
        return;
      }
      const { data, error } = await supabase.rpc('donor_login', {
        p_chosen_name: chosenName,
        p_passcode: passcode,
      });
      if (error) {
        notice(rpcErrorMessage(error));
        return;
      }
      donorToken = data;
      setDonorToken(donorToken);
    }

    await loadDonorInfo();
    buildDetailSteps();
    showStep('step-3');
  } finally {
    btn.disabled = false;
  }
});

async function loadDonorInfo() {
  const { data, error } = await supabase.rpc('get_my_donor_info', { p_session_token: donorToken });
  if (error) {
    donorToken = '';
    localStorage.removeItem('erebe_donor_token');
    throw error;
  }
  donorInfo = Array.isArray(data) ? data[0] : data;
}

// ---------------- STEP 3 ----------------

function idsWithGroup(key) {
  return Object.keys(selected).filter((id) => fieldGroupsForCategory(selected[id].category).some((g) => g.key === key));
}

function fieldInputHtml(itemId, group, isFirst) {
  const val = details[itemId]?.[group.key] ?? '';
  const otherVal = group.otherKey ? details[itemId]?.[group.otherKey] ?? '' : '';
  const disabled = !isFirst && sameForAll[group.key] ? 'disabled' : '';
  const minMax = group.type === 'date' ? `min="${group.min || ''}" max="${group.max || ''}"` : '';

  let inputHtml = '';
  if (group.type === 'radio') {
    inputHtml = group.options
      .map(
        ([optVal, optLabel]) => `
        <label class="checkbox-row" style="display:inline-flex; margin-right:14px;">
          <input type="radio" name="${group.key}-${itemId}" value="${optVal}" ${val === optVal ? 'checked' : ''} ${disabled} />
          ${escapeHtml(optLabel)}
        </label>`
      )
      .join('');
  } else if (group.type === 'select') {
    inputHtml = `
      <select data-field="${group.key}" ${disabled}>
        ${group.options.map((o) => `<option value="${escapeHtml(o)}" ${o === val ? 'selected' : ''}>${o ? escapeHtml(o) : '—'}</option>`).join('')}
      </select>
      ${
        group.otherKey
          ? `<input type="text" data-field="${group.otherKey}" placeholder="Tell us more" value="${escapeHtml(otherVal)}" style="margin-top:6px;" ${disabled} />`
          : ''
      }`;
  } else if (group.type === 'date') {
    inputHtml = `<input type="date" data-field="${group.key}" value="${escapeHtml(val)}" ${minMax} ${disabled} />`;
  } else if (group.type === 'textarea') {
    inputHtml = `<textarea data-field="${group.key}" rows="2" ${disabled}>${escapeHtml(val)}</textarea>`;
  } else {
    inputHtml = `<input type="text" data-field="${group.key}" value="${escapeHtml(val)}" ${disabled} />`;
  }

  const sameCheckbox = isFirst
    ? `<label class="checkbox-row" style="margin-top:4px;">
         <input type="checkbox" class="same-all-cb" data-field="${group.key}" ${sameForAll[group.key] ? 'checked' : ''} />
         use this answer for every item this applies to
       </label>`
    : '';

  return `
    <div class="field-group" data-group="${group.key}">
      <label class="field">${escapeHtml(group.label)}</label>
      ${inputHtml}
      ${sameCheckbox}
    </div>`;
}

function buildDetailSteps() {
  const container = document.getElementById('detail-items');
  const ids = Object.keys(selected);
  ids.forEach((id) => {
    if (!details[id]) details[id] = {};
  });

  // propagate any active "same for all" fields from the first applicable item before
  // rendering, so locked fields on other items show the copied value instead of blank
  Object.keys(sameForAll).forEach((key) => {
    if (sameForAll[key]) propagateSameForAll(key);
  });

  container.innerHTML = ids
    .map((id) => {
      const s = selected[id];
      const groups = fieldGroupsForCategory(s.category);
      const groupsHtml = groups.length
        ? groups.map((g) => fieldInputHtml(id, g, idsWithGroup(g.key)[0] === id)).join('')
        : `<p class="intro" style="margin:0;">No additional details needed for this one — thank you!</p>`;
      return `
      <div class="card" data-item-id="${id}">
        <div class="item-name">${escapeHtml(s.name)} <span style="color:var(--text-faint); font-weight:normal;">— ${formatQuantityDisplay(s.quantity, s.unit)}</span></div>
        <div class="detail-block">${groupsHtml}</div>
      </div>`;
    })
    .join('');

  wireDetailInputs();
}

function wireDetailInputs() {
  const container = document.getElementById('detail-items');

  container.querySelectorAll('.card').forEach((card) => {
    const itemId = card.dataset.itemId;
    const groups = fieldGroupsForCategory(selected[itemId].category);

    groups.forEach((g) => {
      const firstIdForGroup = idsWithGroup(g.key)[0];
      if (g.type === 'radio') {
        card.querySelectorAll(`input[name="${g.key}-${itemId}"]`).forEach((r) => {
          r.addEventListener('change', () => {
            details[itemId][g.key] = r.value;
            if (itemId === firstIdForGroup && sameForAll[g.key]) propagateSameForAll(g.key);
          });
        });
      } else {
        const input = card.querySelector(`[data-field="${g.key}"]`);
        input?.addEventListener('input', () => {
          details[itemId][g.key] = input.value;
          if (itemId === firstIdForGroup && sameForAll[g.key]) propagateSameForAll(g.key);
        });
        if (g.otherKey) {
          const otherInput = card.querySelector(`[data-field="${g.otherKey}"]`);
          otherInput?.addEventListener('input', () => {
            details[itemId][g.otherKey] = otherInput.value;
            if (itemId === firstIdForGroup && sameForAll[g.key]) propagateSameForAll(g.key);
          });
        }
      }
    });
  });

  container.querySelectorAll('.same-all-cb').forEach((cb) => {
    cb.addEventListener('change', () => {
      sameForAll[cb.dataset.field] = cb.checked;
      buildDetailSteps(); // rebuild to lock/unlock fields; propagation happens inside buildDetailSteps
    });
  });
}

function propagateSameForAll(fieldKey) {
  const ids = idsWithGroup(fieldKey);
  if (ids.length < 2) return;
  const firstId = ids[0];
  const group = ALL_FIELD_GROUPS.find((g) => g.key === fieldKey);
  const value = details[firstId]?.[fieldKey] ?? '';
  const otherValue = group?.otherKey ? details[firstId]?.[group.otherKey] ?? '' : '';
  ids.slice(1).forEach((id) => {
    details[id][fieldKey] = value;
    if (group?.otherKey) details[id][group.otherKey] = otherValue;
  });
}

document.getElementById('back-to-2').addEventListener('click', () => showStep('step-2'));

document.getElementById('to-step-4').addEventListener('click', () => {
  buildReview();
  showStep('step-4');
});

// ---------------- STEP 4 ----------------

function buildReview() {
  const el = document.getElementById('review-summary');
  const ids = Object.keys(selected);
  el.innerHTML = ids
    .map((id) => {
      const s = selected[id];
      const d = details[id] || {};
      const bits = [];
      if (d.crew_location) bits.push(`Where: ${CREW_LOCATION_LABELS[d.crew_location] || d.crew_location}`);
      if (d.arrival_date) bits.push(`Available from: ${d.arrival_date}`);
      if (d.departure_date) bits.push(`Available until: ${d.departure_date}`);
      if (d.loan_or_donated) bits.push(d.loan_or_donated === 'loan' ? 'Loan' : 'Donated');
      if (d.pickup_method) bits.push(`Pickup: ${d.pickup_method}${d.pickup_method === 'Other' && d.pickup_method_other ? ' — ' + d.pickup_method_other : ''}`);
      if (d.pickup_timing) bits.push(`Timing: ${d.pickup_timing}${d.pickup_timing === 'Other' && d.pickup_timing_other ? ' — ' + d.pickup_timing_other : ''}`);
      return `
      <div class="card">
        <div class="item-name">${escapeHtml(s.name)} — ${formatQuantityDisplay(s.quantity, s.unit)}</div>
        ${bits.length ? `<div class="item-desc">${escapeHtml(bits.join(' · '))}</div>` : ''}
      </div>`;
    })
    .join('');
}

document.getElementById('back-to-3').addEventListener('click', () => showStep('step-3'));

document.getElementById('submit-btn').addEventListener('click', async () => {
  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  clearNotice();
  try {
    const isAnon = document.getElementById('anon-checkbox').checked;
    const { error: anonErr } = await supabase.rpc('set_donor_anonymous', {
      p_session_token: donorToken,
      p_is_anonymous: isAnon,
    });
    if (anonErr) throw anonErr;

    const items = Object.keys(selected).map((id) => {
      const d = details[id] || {};
      const crewLoc = d.crew_location || '';
      return {
        item_id: id,
        quantity: selected[id].quantity,
        on_build_crew: crewLoc === '' ? null : crewLoc === 'remote' ? false : true,
        crew_location: crewLoc,
        arrival_date: d.arrival_date || '',
        departure_date: d.departure_date || '',
        loan_or_donated: d.loan_or_donated || '',
        pickup_method: d.pickup_method || '',
        pickup_method_other: d.pickup_method_other || '',
        pickup_timing: d.pickup_timing || '',
        pickup_timing_other: d.pickup_timing_other || '',
        pickup_location: d.pickup_location || '',
        care_instructions: d.care_instructions || '',
      };
    });

    const { error } = await supabase.rpc('submit_contributions', {
      p_session_token: donorToken,
      p_items: items,
    });
    if (error) throw error;

    clearCart();
    showStep('step-done');
  } catch (err) {
    notice(rpcErrorMessage(err));
  } finally {
    btn.disabled = false;
  }
});

// ---------------- init ----------------

async function init() {
  const { data, error } = await supabase.rpc('get_wishlist');
  if (error) {
    notice('Could not load the wish list: ' + error.message);
    return;
  }
  allItems = data || [];

  const cart = getCart();
  Object.keys(cart).forEach((id) => {
    const item = allItems.find((i) => i.id === id);
    if (item) selected[id] = { ...cart[id] };
  });

  renderSelectedItems();
  renderFullPicker();

  if (donorToken) {
    try {
      await loadDonorInfo();
    } catch {
      donorToken = '';
    }
  }

  showStep('step-1');
}

init();
