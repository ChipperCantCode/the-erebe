import {
  supabase,
  getAdminToken,
  setAdminToken,
  clearAdminToken,
  formatQuantityDisplay,
  quantityInputHtml,
  parseQuantityForItem,
  escapeHtml,
  rpcErrorMessage,
  CREW_LOCATION_OPTIONS,
  CREW_LOCATION_LABELS,
} from './shared.js';

const noticeArea = document.getElementById('notice-area');
function notice(msg, kind = 'error') {
  noticeArea.innerHTML = `<div class="notice ${kind}">${escapeHtml(msg)}</div>`;
}
function clearNotice() {
  noticeArea.innerHTML = '';
}

let token = getAdminToken();
let dash = { wishlist_items: [], donors: [], change_requests: [] };

const loginBox = document.getElementById('login-box');
const dashboard = document.getElementById('dashboard');

document.getElementById('admin-login-btn').addEventListener('click', async () => {
  clearNotice();
  const name = document.getElementById('admin-name').value.trim();
  const passcode = document.getElementById('admin-passcode').value;
  const { data, error } = await supabase.rpc('admin_login', { p_name: name, p_passcode: passcode });
  if (error) {
    notice(rpcErrorMessage(error));
    return;
  }
  token = data;
  setAdminToken(token);
  await loadDashboard();
});

document.getElementById('admin-logout').addEventListener('click', () => {
  clearAdminToken();
  token = '';
  location.reload();
});

document.querySelectorAll('.tabs [data-tab]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
    document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
  });
});

async function loadDashboard() {
  clearNotice();
  const { data, error } = await supabase.rpc('admin_get_dashboard', { p_session_token: token });
  if (error) {
    notice(rpcErrorMessage(error));
    clearAdminToken();
    token = '';
    loginBox.classList.remove('hidden');
    dashboard.classList.add('hidden');
    return;
  }
  dash = data;
  loginBox.classList.add('hidden');
  dashboard.classList.remove('hidden');
  renderChangeRequests();
  renderDonors();
  renderWishlist();
}

// ---------------- Change requests ----------------

function renderChangeRequests() {
  const el = document.getElementById('tab-change-requests');
  const pending = dash.change_requests.filter((r) => r.status === 'pending');
  const resolved = dash.change_requests.filter((r) => r.status !== 'pending');

  const rowHtml = (r) => `
    <div class="card" data-id="${r.id}">
      <div class="item-head">
        <div class="item-name">${escapeHtml(r.item_name)} — ${escapeHtml(r.donor_contact_name)} (${escapeHtml(r.donor_chosen_name)})</div>
        <span class="pill ${r.status}">${r.status}</span>
      </div>
      <div class="item-desc">
        Current: <span class="qty-badge">${formatQuantityDisplay(r.current_quantity, r.item_unit)}</span> → Requested: <span class="qty-badge">${r.requested_quantity == null ? 'remove entirely' : formatQuantityDisplay(r.requested_quantity, r.item_unit)}</span>
        <br />Reason: ${escapeHtml(r.reason)}
        ${r.admin_note ? `<br />Admin note: ${escapeHtml(r.admin_note)}` : ''}
      </div>
      ${
        r.status === 'pending'
          ? `
        <div class="field-group" style="margin-top:8px;">
          <label class="field">Admin note (optional)</label>
          <input type="text" class="admin-note-input" />
        </div>
        <button type="button" class="small" data-action="approve">Approve</button>
        <button type="button" class="secondary small" data-action="deny">Deny</button>`
          : ''
      }
    </div>`;

  el.innerHTML =
    `<h2 class="section-title" style="margin-top:0;">Pending (${pending.length})</h2>` +
    (pending.length ? pending.map(rowHtml).join('') : '<p class="intro">Nothing pending.</p>') +
    `<details style="margin-top:20px;"><summary style="cursor:pointer; color:var(--accent);">Resolved history (${resolved.length})</summary>${resolved.map(rowHtml).join('')}</details>`;

  el.querySelectorAll('.card').forEach((card) => {
    const id = card.dataset.id;
    card.querySelector('[data-action="approve"]')?.addEventListener('click', () => resolveRequest(id, true, card));
    card.querySelector('[data-action="deny"]')?.addEventListener('click', () => resolveRequest(id, false, card));
  });
}

async function resolveRequest(id, approve, card) {
  const note = card.querySelector('.admin-note-input')?.value || '';
  const { error } = await supabase.rpc('admin_resolve_change_request', {
    p_session_token: token,
    p_request_id: id,
    p_approve: approve,
    p_admin_note: note || null,
  });
  if (error) {
    notice(rpcErrorMessage(error));
    return;
  }
  await loadDashboard();
}

// ---------------- Donors ----------------

function contributionRowHtml(donorId, c) {
  const crewSelect =
    c.item_category === 'volunteer'
      ? `<div class="field-group">
          <label class="field">Where</label>
          <select class="edit-crew-location">
            ${CREW_LOCATION_OPTIONS.map(([val, label]) => `<option value="${val}" ${(c.crew_location || '') === val ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
          </select>
        </div>`
      : '';
  const details = [];
  if (c.arrival_date) details.push(`Available from ${c.arrival_date}`);
  if (c.departure_date) details.push(`until ${c.departure_date}`);
  if (c.loan_or_donated) details.push(c.loan_or_donated === 'loan' ? 'Loan' : 'Donated');
  if (c.pickup_method) details.push(`Pickup: ${c.pickup_method}${c.pickup_method_other ? ' — ' + c.pickup_method_other : ''}`);
  if (c.pickup_timing) details.push(`Timing: ${c.pickup_timing}${c.pickup_timing_other ? ' — ' + c.pickup_timing_other : ''}`);
  if (c.pickup_location) details.push(`Where from: ${c.pickup_location}`);
  if (c.care_instructions) details.push(`Notes: ${c.care_instructions}`);

  return `
  <div class="contrib-row" data-cid="${c.id}">
    <div class="item-head">
      <div class="item-name">${escapeHtml(c.item_name)}</div>
      <span class="pill cat-pill ${escapeHtml(c.item_category)}">${escapeHtml(c.item_category)}</span>
    </div>
    ${details.length ? `<div class="item-desc">${escapeHtml(details.join(' · '))}</div>` : ''}
    <div class="row">
      <div class="field-group">
        <label class="field">Quantity${c.item_unit ? ` (${escapeHtml(c.item_unit)})` : ''}</label>
        ${quantityInputHtml({ unit: c.item_unit }, 'edit-qty', c.quantity)}
      </div>
      <div class="field-group">
        <label class="field">Status</label>
        <select class="edit-status">
          <option value="active" ${c.status === 'active' ? 'selected' : ''}>active</option>
          <option value="removed" ${c.status === 'removed' ? 'selected' : ''}>removed</option>
        </select>
      </div>
    </div>
    ${crewSelect}
    <div class="row">
      <button type="button" class="small" data-action="save-contrib">Save</button>
      <button type="button" class="danger small" data-action="delete-contrib">Delete</button>
    </div>
  </div>`;
}

function donorBlockHtml(d) {
  return `
  <details class="donor-block" data-donor-id="${d.id}">
    <summary>${escapeHtml(d.contact_name)} (${escapeHtml(d.chosen_name)})${d.is_anonymous ? ' — anonymous' : ''} — ${d.contributions.length} item(s)</summary>
    <div style="margin-top:10px;">
      <p style="font-size:0.85rem; color:var(--text-dim);">
        Email: ${escapeHtml(d.email)} ${d.is_anonymous ? '· anonymous on public list' : ''}
      </p>
      ${d.contributions.map((c) => contributionRowHtml(d.id, c)).join('') || '<p class="intro">No contributions.</p>'}
      <details style="margin-top:10px;">
        <summary style="cursor:pointer; color:var(--accent); font-size:0.85rem;">+ Add an item for this donor</summary>
        <div class="row" style="margin-top:8px;">
          <select class="add-item-select">
            ${dash.wishlist_items.filter((i) => !i.archived).map((i) => `<option value="${i.id}">${escapeHtml(i.name)}</option>`).join('')}
          </select>
          <input type="text" class="add-item-qty" placeholder="Quantity" />
          <button type="button" class="small" data-action="add-contrib">Add</button>
        </div>
      </details>
    </div>
  </details>`;
}

function renderDonors() {
  const el = document.getElementById('tab-donors');
  el.innerHTML =
    `<h2 class="section-title" style="margin-top:0;">Donors (${dash.donors.length})</h2>` +
    `<details class="card"><summary style="cursor:pointer; color:var(--accent);">+ Add a new donor manually</summary>
      <div style="margin-top:10px;">
        <div class="row">
          <input type="text" id="new-donor-chosen" placeholder="Chosen login name" />
          <input type="text" id="new-donor-contact" placeholder="Contact name" />
        </div>
        <div class="row" style="margin-top:8px;">
          <input type="email" id="new-donor-email" placeholder="Email" />
          <input type="text" id="new-donor-passcode" placeholder="Passcode (optional, random if blank)" />
        </div>
        <button type="button" id="create-donor-btn" class="small" style="margin-top:8px;">Create donor</button>
      </div>
    </details>` +
    dash.donors.map(donorBlockHtml).join('');

  document.getElementById('create-donor-btn').addEventListener('click', async () => {
    const chosen = document.getElementById('new-donor-chosen').value.trim();
    const contact = document.getElementById('new-donor-contact').value.trim();
    const email = document.getElementById('new-donor-email').value.trim();
    const passcode = document.getElementById('new-donor-passcode').value.trim();
    if (!chosen || !contact || !email) {
      notice('Chosen name, contact name, and email are required.');
      return;
    }
    const { error } = await supabase.rpc('admin_create_donor', {
      p_session_token: token,
      p_chosen_name: chosen,
      p_contact_name: contact,
      p_email: email,
      p_passcode: passcode || null,
    });
    if (error) {
      notice(rpcErrorMessage(error));
      return;
    }
    await loadDashboard();
  });

  el.querySelectorAll('.donor-block').forEach((block) => {
    const donorId = block.dataset.donorId;

    block.querySelectorAll('[data-action="save-contrib"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('.contrib-row');
        const cid = row.dataset.cid;
        const c = dash.donors.find((d) => d.id === donorId).contributions.find((x) => x.id === cid);
        const qty = parseQuantityForItem({ unit: c.item_unit }, row.querySelector('.edit-qty').value);
        if (!Number.isFinite(qty) || qty <= 0) {
          notice('Enter a valid quantity.');
          return;
        }
        const status = row.querySelector('.edit-status').value;
        const crewLocationSelect = row.querySelector('.edit-crew-location');
        const crewLocation = crewLocationSelect ? crewLocationSelect.value || null : c.crew_location;
        const { error } = await supabase.rpc('admin_set_contribution', {
          p_session_token: token,
          p_id: cid,
          p_quantity: qty,
          p_status: status,
          p_on_build_crew: c.on_build_crew,
          p_crew_location: crewLocation,
          p_arrival_date: c.arrival_date,
          p_departure_date: c.departure_date,
          p_loan_or_donated: c.loan_or_donated,
          p_pickup_method: c.pickup_method,
          p_pickup_method_other: c.pickup_method_other,
          p_pickup_timing: c.pickup_timing,
          p_pickup_timing_other: c.pickup_timing_other,
          p_pickup_location: c.pickup_location,
          p_care_instructions: c.care_instructions,
        });
        if (error) {
          notice(rpcErrorMessage(error));
          return;
        }
        await loadDashboard();
      });
    });

    block.querySelectorAll('[data-action="delete-contrib"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('.contrib-row');
        const cid = row.dataset.cid;
        if (!confirm('Delete this contribution entirely? This cannot be undone.')) return;
        const { error } = await supabase.rpc('admin_delete_contribution', { p_session_token: token, p_id: cid });
        if (error) {
          notice(rpcErrorMessage(error));
          return;
        }
        await loadDashboard();
      });
    });

    block.querySelector('[data-action="add-contrib"]')?.addEventListener('click', async () => {
      const select = block.querySelector('.add-item-select');
      const qtyInput = block.querySelector('.add-item-qty');
      const targetItem = dash.wishlist_items.find((i) => i.id === select.value);
      const qty = parseQuantityForItem({ unit: targetItem?.unit }, qtyInput.value);
      if (!Number.isFinite(qty) || qty <= 0) {
        notice('Enter a valid quantity.');
        return;
      }
      const { error } = await supabase.rpc('admin_add_contribution', {
        p_session_token: token,
        p_donor_id: donorId,
        p_item_id: select.value,
        p_quantity: qty,
        p_quantity_note: null,
      });
      if (error) {
        notice(rpcErrorMessage(error));
        return;
      }
      await loadDashboard();
    });
  });
}

// ---------------- Wishlist items ----------------

function progressHtml(i) {
  const committed = Number(i.committed_quantity) || 0;
  if (i.target_quantity != null) {
    const pct = Math.max(0, Math.min(100, Math.round((committed / i.target_quantity) * 100)));
    const fulfilled = committed >= i.target_quantity;
    return `
      <div class="progress-line">
        <span class="qty-badge">${formatQuantityDisplay(committed, i.unit)}</span>
        <span>of ${formatQuantityDisplay(i.target_quantity, i.unit)}${fulfilled ? ' — fully covered' : ` (${pct}%)`}</span>
      </div>
      <div class="progress-track"><div class="progress-fill${fulfilled ? ' fulfilled' : ''}" style="width:${pct}%;"></div></div>`;
  }
  return committed > 0
    ? `<div class="progress-line"><span class="qty-badge">${formatQuantityDisplay(committed, i.unit)}</span><span>committed (open-ended, no target set)</span></div>`
    : `<div class="progress-line" style="color:var(--text-faint);">Nothing committed yet</div>`;
}

function itemCardHtml(i) {
  return `
  <div class="card" data-id="${i.id}">
    <div class="item-head">
      <div class="item-name">${escapeHtml(i.name)}${i.archived ? ' <span class="pill">archived</span>' : ''}</div>
    </div>
    ${progressHtml(i)}
    ${i.description ? `<div class="item-desc">${escapeHtml(i.description)}</div>` : ''}
    <details style="margin-top:8px;">
      <summary style="cursor:pointer; color:var(--accent); font-size:0.85rem;">Edit</summary>
      <div style="margin-top:10px;">
        <div class="field-group">
          <label class="field">Name</label>
          <input type="text" class="w-name" value="${escapeHtml(i.name)}" />
        </div>
        <div class="row">
          <div class="field-group">
            <label class="field">Category</label>
            <select class="w-category">
              <option value="volunteer" ${i.category === 'volunteer' ? 'selected' : ''}>volunteer</option>
              <option value="material" ${i.category === 'material' ? 'selected' : ''}>material</option>
              <option value="donation" ${i.category === 'donation' ? 'selected' : ''}>donation</option>
            </select>
          </div>
          <div class="field-group">
            <label class="field">Sort order</label>
            <input type="number" class="w-sort" value="${i.sort_order}" />
          </div>
        </div>
        <div class="field-group">
          <label class="field">Description</label>
          <textarea class="w-desc" rows="2">${escapeHtml(i.description || '')}</textarea>
        </div>
        <div class="row">
          <div class="field-group">
            <label class="field">Target quantity (blank = open-ended)</label>
            <input type="number" class="w-target" value="${i.target_quantity ?? ''}" step="any" />
          </div>
          <div class="field-group">
            <label class="field">Unit (%, USD, people, sheets...)</label>
            <input type="text" class="w-unit" value="${escapeHtml(i.unit || '')}" placeholder="%, USD, etc." />
          </div>
        </div>
        <label class="checkbox-row"><input type="checkbox" class="w-archived" ${i.archived ? 'checked' : ''} /> archived (hidden from public list)</label>
        <button type="button" class="small" data-action="save-item" style="margin-top:10px;">Save</button>
      </div>
    </details>
  </div>`;
}

function renderWishlist() {
  const el = document.getElementById('tab-wishlist');
  const groups = [
    ['volunteer', 'Volunteers'],
    ['material', 'Materials & Supplies'],
    ['donation', 'Donations'],
  ];

  el.innerHTML =
    `<h2 class="section-title" style="margin-top:0;">Wish List Items</h2>
    <details class="card">
      <summary style="cursor:pointer; color:var(--accent);">+ Add a new item</summary>
      <div style="margin-top:10px;">
        <div class="row">
          <input type="text" id="new-item-name" placeholder="Name" />
          <select id="new-item-category">
            <option value="volunteer">volunteer</option>
            <option value="material">material</option>
            <option value="donation">donation</option>
          </select>
        </div>
        <textarea id="new-item-desc" placeholder="Description" rows="2" style="margin-top:8px;"></textarea>
        <div class="row" style="margin-top:8px;">
          <input type="number" id="new-item-target" placeholder="Target quantity (optional)" />
          <input type="text" id="new-item-unit" placeholder="Unit (optional)" />
          <input type="number" id="new-item-sort" placeholder="Sort order" value="0" />
        </div>
        <button type="button" id="create-item-btn" class="small" style="margin-top:8px;">Create item</button>
      </div>
    </details>` +
    groups
      .map(([cat, label]) => {
        const items = dash.wishlist_items.filter((i) => i.category === cat);
        return (
          `<h3 style="color:var(--accent); margin: 24px 0 10px;">${label} (${items.length})</h3>` +
          (items.length ? items.map(itemCardHtml).join('') : '<p class="intro">None yet.</p>')
        );
      })
      .join('');

  document.getElementById('create-item-btn').addEventListener('click', async () => {
    const name = document.getElementById('new-item-name').value.trim();
    const category = document.getElementById('new-item-category').value;
    const desc = document.getElementById('new-item-desc').value.trim();
    const target = document.getElementById('new-item-target').value;
    const unit = document.getElementById('new-item-unit').value.trim();
    const sort = document.getElementById('new-item-sort').value;
    if (!name) {
      notice('Name is required.');
      return;
    }
    const { error } = await supabase.rpc('admin_upsert_item', {
      p_session_token: token,
      p_id: null,
      p_category: category,
      p_name: name,
      p_description: desc || null,
      p_target_quantity: target ? Number(target) : null,
      p_unit: unit || null,
      p_sort_order: sort ? Number(sort) : 0,
      p_archived: false,
    });
    if (error) {
      notice(rpcErrorMessage(error));
      return;
    }
    await loadDashboard();
  });

  el.querySelectorAll('[data-action="save-item"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.card');
      const id = card.dataset.id;
      const { error } = await supabase.rpc('admin_upsert_item', {
        p_session_token: token,
        p_id: id,
        p_category: card.querySelector('.w-category').value,
        p_name: card.querySelector('.w-name').value.trim(),
        p_description: card.querySelector('.w-desc').value.trim() || null,
        p_target_quantity: card.querySelector('.w-target').value ? Number(card.querySelector('.w-target').value) : null,
        p_unit: card.querySelector('.w-unit').value.trim() || null,
        p_sort_order: Number(card.querySelector('.w-sort').value) || 0,
        p_archived: card.querySelector('.w-archived').checked,
      });
      if (error) {
        notice(rpcErrorMessage(error));
        return;
      }
      await loadDashboard();
    });
  });
}

// ---------------- init ----------------

async function init() {
  if (!token) {
    loginBox.classList.remove('hidden');
    return;
  }
  await loadDashboard();
}

init();
