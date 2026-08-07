import { supabase, getAdminToken, setAdminToken, clearAdminToken, formatQuantity, escapeHtml, rpcErrorMessage } from './shared.js';

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
        Current: ${formatQuantity(r.current_quantity)} → Requested: ${r.requested_quantity == null ? 'remove entirely' : formatQuantity(r.requested_quantity)}
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
  return `
  <tr data-cid="${c.id}">
    <td>${escapeHtml(c.item_name)}<br /><span class="pill">${escapeHtml(c.item_category)}</span></td>
    <td><input type="text" class="edit-qty" value="${formatQuantity(c.quantity)}" style="width:80px;" /></td>
    <td>
      <select class="edit-status">
        <option value="active" ${c.status === 'active' ? 'selected' : ''}>active</option>
        <option value="removed" ${c.status === 'removed' ? 'selected' : ''}>removed</option>
      </select>
    </td>
    <td style="font-size:0.8rem; color:var(--text-dim);">
      ${c.loan_or_donated ? escapeHtml(c.loan_or_donated) + '<br/>' : ''}
      ${c.pickup_method ? escapeHtml(c.pickup_method) + '<br/>' : ''}
      ${c.pickup_location ? escapeHtml(c.pickup_location) : ''}
    </td>
    <td>
      <button type="button" class="small" data-action="save-contrib">Save</button>
      <button type="button" class="danger small" data-action="delete-contrib">Delete</button>
    </td>
  </tr>`;
}

function donorBlockHtml(d) {
  return `
  <details class="donor-block" data-donor-id="${d.id}">
    <summary>${escapeHtml(d.contact_name)} (${escapeHtml(d.chosen_name)})${d.is_anonymous ? ' — anonymous' : ''} — ${d.contributions.length} item(s)</summary>
    <div style="margin-top:10px;">
      <p style="font-size:0.85rem; color:var(--text-dim);">
        Email: ${escapeHtml(d.email)} ${d.is_anonymous ? '· anonymous on public list' : ''}
      </p>
      <div style="overflow-x:auto;">
        <table class="admin-table">
          <thead><tr><th>Item</th><th>Qty</th><th>Status</th><th>Details</th><th></th></tr></thead>
          <tbody>${d.contributions.map((c) => contributionRowHtml(d.id, c)).join('')}</tbody>
        </table>
      </div>
      <details style="margin-top:10px;">
        <summary style="cursor:pointer; color:var(--accent); font-size:0.85rem;">+ Add an item for this donor</summary>
        <div class="row" style="margin-top:8px;">
          <select class="add-item-select">
            ${dash.wishlist_items.filter((i) => !i.archived).map((i) => `<option value="${i.id}">${escapeHtml(i.name)}</option>`).join('')}
          </select>
          <input type="text" class="add-item-qty" placeholder="Quantity" style="max-width:120px;" />
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
        const tr = btn.closest('tr');
        const cid = tr.dataset.cid;
        const qty = Number(tr.querySelector('.edit-qty').value);
        const status = tr.querySelector('.edit-status').value;
        const c = dash.donors.find((d) => d.id === donorId).contributions.find((x) => x.id === cid);
        const { error } = await supabase.rpc('admin_set_contribution', {
          p_session_token: token,
          p_id: cid,
          p_quantity: qty,
          p_status: status,
          p_on_build_crew: c.on_build_crew,
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
        const tr = btn.closest('tr');
        const cid = tr.dataset.cid;
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
      const qty = Number(qtyInput.value);
      if (!qty || qty <= 0) {
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

function itemRowHtml(i) {
  return `
  <tr data-id="${i.id}">
    <td><input type="text" class="w-name" value="${escapeHtml(i.name)}" /></td>
    <td>
      <select class="w-category">
        <option value="volunteer" ${i.category === 'volunteer' ? 'selected' : ''}>volunteer</option>
        <option value="material" ${i.category === 'material' ? 'selected' : ''}>material</option>
      </select>
    </td>
    <td><textarea class="w-desc" rows="2" style="min-width:200px;">${escapeHtml(i.description || '')}</textarea></td>
    <td><input type="number" class="w-target" value="${i.target_quantity ?? ''}" style="width:80px;" /></td>
    <td><input type="text" class="w-unit" value="${escapeHtml(i.unit || '')}" style="width:80px;" /></td>
    <td><input type="number" class="w-sort" value="${i.sort_order}" style="width:60px;" /></td>
    <td style="font-size:0.8rem;">committed: ${formatQuantity(i.committed_quantity)}</td>
    <td>
      <label class="checkbox-row"><input type="checkbox" class="w-archived" ${i.archived ? 'checked' : ''} /> archived</label>
    </td>
    <td><button type="button" class="small" data-action="save-item">Save</button></td>
  </tr>`;
}

function renderWishlist() {
  const el = document.getElementById('tab-wishlist');
  el.innerHTML = `
    <h2 class="section-title" style="margin-top:0;">Wish List Items</h2>
    <details class="card">
      <summary style="cursor:pointer; color:var(--accent);">+ Add a new item</summary>
      <div style="margin-top:10px;">
        <div class="row">
          <input type="text" id="new-item-name" placeholder="Name" />
          <select id="new-item-category">
            <option value="volunteer">volunteer</option>
            <option value="material">material</option>
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
    </details>
    <div style="overflow-x:auto; margin-top:14px;">
      <table class="admin-table">
        <thead><tr><th>Name</th><th>Category</th><th>Description</th><th>Target</th><th>Unit</th><th>Sort</th><th></th><th>Archived</th><th></th></tr></thead>
        <tbody>${dash.wishlist_items.map(itemRowHtml).join('')}</tbody>
      </table>
    </div>`;

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
      const tr = btn.closest('tr');
      const id = tr.dataset.id;
      const { error } = await supabase.rpc('admin_upsert_item', {
        p_session_token: token,
        p_id: id,
        p_category: tr.querySelector('.w-category').value,
        p_name: tr.querySelector('.w-name').value.trim(),
        p_description: tr.querySelector('.w-desc').value.trim() || null,
        p_target_quantity: tr.querySelector('.w-target').value ? Number(tr.querySelector('.w-target').value) : null,
        p_unit: tr.querySelector('.w-unit').value.trim() || null,
        p_sort_order: Number(tr.querySelector('.w-sort').value) || 0,
        p_archived: tr.querySelector('.w-archived').checked,
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
