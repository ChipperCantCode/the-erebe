// Admin "Hours" and "Shifts" tabs. Kept separate from admin.js (already long); admin.js
// fetches admin_get_hours_dashboard alongside everything else and calls these renderers.
import { supabase, escapeHtml, rpcErrorMessage, formatDate } from './shared.js';
import { hourFormHtml, wireHourForm, hourEntryHtml, formatHours, formatTimeRange, todayLocal } from './hours.js';

// ctx: { token, data (admin_get_hours_dashboard result), notice(msg, kind), reload() }
let personFilter = '';

function personLabel(p) {
  return p.claim_code ? `${p.contact_name} (no account yet)` : `${p.contact_name} (${p.chosen_name})`;
}

function claimLink(code) {
  return new URL(`my-list.html?claim=${encodeURIComponent(code)}`, location.href).href;
}

function claimMailto(p) {
  const subject = 'Your hours on the Erebe build';
  const body =
    `Hi ${p.contact_name},\n\n` +
    `I've been logging your hours on the Erebe build so you get credit for them. ` +
    `Claim your account here to see them and log more yourself:\n\n${claimLink(p.claim_code)}\n\n` +
    `Thank you for building with us!\n— Inani`;
  return `mailto:${encodeURIComponent(p.email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// ---------- CSV ----------

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename, rows) {
  // BOM so Excel opens it as UTF-8 (em dashes, accented playa names)
  const csv = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportEntries(logs) {
  const rows = [
    ['Name', 'Login name', 'Email', 'Date', 'Start', 'End', 'Hours', 'Role / work', 'Shift', 'Notes', 'Logged by', 'Logged at'],
    ...logs.map((l) => [
      l.contact_name,
      l.unclaimed ? '(no account yet)' : l.chosen_name,
      l.email || '',
      l.work_date,
      (l.start_time || '').slice(0, 5),
      (l.end_time || '').slice(0, 5),
      Number(l.hours),
      l.role_label,
      l.shift_title || '',
      l.note || '',
      l.logged_by === 'admin' ? 'Admin' : 'Self',
      new Date(l.created_at).toLocaleString(),
    ]),
  ];
  downloadCsv(`erebe-volunteer-hours-${todayLocal()}.csv`, rows);
}

function exportTotals(people, logs) {
  const byPerson = new Map();
  logs.forEach((l) => {
    const t = byPerson.get(l.donor_id) || { hours: 0, days: new Set(), first: l.work_date, last: l.work_date };
    t.hours += Number(l.hours);
    t.days.add(l.work_date);
    if (l.work_date < t.first) t.first = l.work_date;
    if (l.work_date > t.last) t.last = l.work_date;
    byPerson.set(l.donor_id, t);
  });
  const rows = [['Name', 'Login name', 'Email', 'Total hours', 'Days worked', 'First day', 'Last day']];
  people
    .filter((p) => byPerson.has(p.id))
    .sort((a, b) => byPerson.get(b.id).hours - byPerson.get(a.id).hours)
    .forEach((p) => {
      const t = byPerson.get(p.id);
      rows.push([p.contact_name, p.claim_code ? '(no account yet)' : p.chosen_name, p.email || '', t.hours, t.days.size, t.first, t.last]);
    });
  downloadCsv(`erebe-volunteer-hour-totals-${todayLocal()}.csv`, rows);
}

// ---------- Hours tab ----------

export function renderHoursTab(el, ctx) {
  const { data, token, notice, reload } = ctx;
  const people = data.people;
  const logs = personFilter ? data.logs.filter((l) => l.donor_id === personFilter) : data.logs;
  const total = logs.reduce((s, l) => s + Number(l.hours), 0);
  const withHours = people.filter((p) => Number(p.entries) > 0).sort((a, b) => b.total_hours - a.total_hours);
  const unclaimed = people.filter((p) => p.claim_code);
  const filteredPerson = people.find((p) => p.id === personFilter);

  const formOpts = {
    myRoles: data.roles,
    allRoles: data.roles,
    shifts: data.shifts,
    people: people.map((p) => ({ id: p.id, label: personLabel(p) })),
    isAdmin: true,
  };

  el.innerHTML = `
    <h2 class="section-title" style="margin-top:0;">Volunteer Hours</h2>
    <div class="card">
      <div class="progress-line">
        <span class="qty-badge">${formatHours(total)}</span>
        <span>${filteredPerson ? `for ${escapeHtml(filteredPerson.contact_name)}` : `logged by ${withHours.length} ${withHours.length === 1 ? 'person' : 'people'}`} · ${logs.length} ${logs.length === 1 ? 'entry' : 'entries'}</span>
      </div>
      <div class="row" style="margin-top:10px;">
        <button type="button" class="small" id="export-entries-btn">Export ${filteredPerson ? 'these' : 'all'} entries (CSV)</button>
        <button type="button" class="secondary small" id="export-totals-btn">Export totals per person (CSV)</button>
      </div>
    </div>

    <details class="card" id="admin-hour-form-details">
      <summary style="cursor:pointer; color:var(--accent);">+ Log hours for someone (including yourself)</summary>
      <p class="intro" style="margin-top:10px;">Start/end times are optional here if you only know the total.
        Not in the list? Add them under "People without accounts" below first.</p>
      <div id="admin-hour-form"></div>
    </details>

    <h3 style="color:var(--accent); margin: 24px 0 10px;">Totals by person</h3>
    ${
      withHours.length
        ? `<div class="card"><table class="hours-table">
            <thead><tr><th>Name</th><th>Entries</th><th>Hours</th></tr></thead>
            <tbody>${withHours
              .map(
                (p) => `<tr>
                  <td><a href="#" data-filter="${p.id}">${escapeHtml(p.contact_name)}</a>${p.claim_code ? ' <span class="pill">no account</span>' : ''}</td>
                  <td>${p.entries}</td>
                  <td>${formatHours(p.total_hours)}</td>
                </tr>`
              )
              .join('')}</tbody>
          </table></div>`
        : '<p class="intro">Nobody has logged hours yet.</p>'
    }

    <h3 style="color:var(--accent); margin: 24px 0 10px;">Entries</h3>
    <div class="field-group">
      <label class="field">Show</label>
      <select id="hours-person-filter">
        <option value="">Everyone</option>
        ${withHours.map((p) => `<option value="${p.id}" ${p.id === personFilter ? 'selected' : ''}>${escapeHtml(personLabel(p))}</option>`).join('')}
      </select>
    </div>
    <div id="admin-hours-list">
      ${logs.length ? `<div class="card">${logs.map((l) => hourEntryHtml(l, { who: l.contact_name })).join('')}</div>` : '<p class="intro">No entries.</p>'}
    </div>

    <h3 style="color:var(--accent); margin: 24px 0 10px;">People without accounts (${unclaimed.length})</h3>
    <p class="intro">For crew who are building but never signed up. Add whatever you know — a playa name is
      enough — and log their hours. Once you have their email, send them their claim link: they pick a
      login name and passcode (or add the hours to an account they already have), and everything you
      logged comes with them.</p>
    <div class="card">
      <div class="row">
        <input type="text" id="new-unclaimed-name" placeholder="Playa name / what you call them" />
        <input type="email" id="new-unclaimed-email" placeholder="Email (optional — add it later)" />
      </div>
      <button type="button" class="small" id="add-unclaimed-btn" style="margin-top:8px;">Add person</button>
    </div>
    ${unclaimed
      .map(
        (p) => `
      <div class="card unclaimed-card" data-id="${p.id}">
        <div class="row">
          <div class="field-group">
            <label class="field">Name</label>
            <input type="text" class="uc-name" value="${escapeHtml(p.contact_name)}" />
          </div>
          <div class="field-group">
            <label class="field">Email</label>
            <input type="email" class="uc-email" value="${escapeHtml(p.email || '')}" />
          </div>
        </div>
        <div class="item-desc">${formatHours(p.total_hours)} logged so far</div>
        <div class="row" style="margin-top:8px;">
          <button type="button" class="secondary small" data-action="save-unclaimed">Save</button>
          ${
            p.email
              ? `<a class="btn small-btn" href="${escapeHtml(claimMailto(p))}">Email claim link</a>`
              : '<button type="button" class="small" disabled title="Add their email and save first">Email claim link</button>'
          }
          <button type="button" class="secondary small" data-action="copy-claim">Copy claim link</button>
        </div>
      </div>`
      )
      .join('')}`;

  // form
  const formWrap = el.querySelector('#admin-hour-form');
  formWrap.innerHTML = hourFormHtml(formOpts);
  const form = wireHourForm(formWrap, formOpts);
  if (personFilter) formWrap.querySelector('.hf-person').value = personFilter;

  formWrap.querySelector('.hf-save').addEventListener('click', async () => {
    const result = form.read();
    if (!result.ok) {
      notice(result.error);
      return;
    }
    const { error } = await supabase.rpc('admin_save_hours', {
      p_session_token: token,
      p_id: form.editingId,
      ...result.values,
    });
    if (error) {
      notice(rpcErrorMessage(error));
      return;
    }
    const wasEdit = !!form.editingId;
    await reload();
    notice(wasEdit ? 'Entry updated.' : 'Hours logged.', 'success');
  });

  el.querySelector('#export-entries-btn').addEventListener('click', () => exportEntries(logs));
  el.querySelector('#export-totals-btn').addEventListener('click', () => exportTotals(people, data.logs));

  el.querySelector('#hours-person-filter').addEventListener('change', (e) => {
    personFilter = e.target.value;
    renderHoursTab(el, ctx);
  });
  el.querySelectorAll('[data-filter]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      personFilter = a.dataset.filter;
      renderHoursTab(el, ctx);
      el.querySelector('#admin-hours-list').scrollIntoView({ behavior: 'smooth', block: 'start' });
    })
  );

  el.querySelectorAll('#admin-hours-list .hour-entry').forEach((row) => {
    const entry = data.logs.find((l) => l.id === row.dataset.id);
    row.querySelector('[data-action="edit-hours"]').addEventListener('click', () => {
      el.querySelector('#admin-hour-form-details').open = true;
      form.load(entry);
    });
    row.querySelector('[data-action="delete-hours"]').addEventListener('click', async () => {
      if (!confirm(`Delete ${entry.contact_name}'s ${formatHours(entry.hours)} on ${formatDate(entry.work_date)}?`)) return;
      const { error } = await supabase.rpc('admin_delete_hours', { p_session_token: token, p_id: entry.id });
      if (error) {
        notice(rpcErrorMessage(error));
        return;
      }
      await reload();
    });
  });

  el.querySelector('#add-unclaimed-btn').addEventListener('click', async () => {
    const name = el.querySelector('#new-unclaimed-name').value.trim();
    if (!name) {
      notice('Enter at least a name.');
      return;
    }
    const { error } = await supabase.rpc('admin_create_unclaimed_person', {
      p_session_token: token,
      p_playa_name: name,
      p_email: el.querySelector('#new-unclaimed-email').value.trim() || null,
    });
    if (error) {
      notice(rpcErrorMessage(error));
      return;
    }
    await reload();
    notice(`Added ${name}. You can log hours for them now.`, 'success');
  });

  el.querySelectorAll('.unclaimed-card').forEach((card) => {
    const p = people.find((x) => x.id === card.dataset.id);
    card.querySelector('[data-action="save-unclaimed"]').addEventListener('click', async () => {
      const { error } = await supabase.rpc('admin_update_unclaimed_person', {
        p_session_token: token,
        p_id: p.id,
        p_playa_name: card.querySelector('.uc-name').value.trim(),
        p_email: card.querySelector('.uc-email').value.trim(),
      });
      if (error) {
        notice(rpcErrorMessage(error));
        return;
      }
      await reload();
      notice('Saved.', 'success');
    });
    card.querySelector('[data-action="copy-claim"]').addEventListener('click', async () => {
      const link = claimLink(p.claim_code);
      try {
        await navigator.clipboard.writeText(link);
        notice(`Claim link for ${p.contact_name} copied — paste it in a text or email.`, 'success');
      } catch {
        prompt('Copy this claim link:', link);
      }
    });
  });
}

// ---------- Shifts tab ----------

function shiftFieldsHtml(s, roles) {
  return `
    <div class="row">
      <div class="field-group">
        <label class="field">Title</label>
        <input type="text" class="sf-title" value="${escapeHtml(s?.title || '')}" placeholder="e.g. Spire framing day (blank = role name)" />
      </div>
      <div class="field-group">
        <label class="field">Role (fills in when people log hours for it)</label>
        <select class="sf-role">
          <option value="">— No specific role —</option>
          ${roles.map((r) => `<option value="${r.id}" ${s?.item_id === r.id ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="row">
      <div class="field-group">
        <label class="field">Date</label>
        <input type="date" class="sf-date" value="${s?.shift_date || todayLocal()}" />
      </div>
      <div class="field-group">
        <label class="field">Arrive at</label>
        <input type="time" class="sf-start" value="${(s?.start_time || '').slice(0, 5)}" />
      </div>
      <div class="field-group">
        <label class="field">Ends at</label>
        <input type="time" class="sf-end" value="${(s?.end_time || '').slice(0, 5)}" />
      </div>
    </div>
    <div class="field-group">
      <label class="field">Where (optional)</label>
      <input type="text" class="sf-location" value="${escapeHtml(s?.location || '')}" placeholder="e.g. CoLab" />
    </div>
    <div class="field-group">
      <label class="field">Details (optional)</label>
      <textarea class="sf-desc" rows="2" placeholder="What to bring, what you'll be doing">${escapeHtml(s?.description || '')}</textarea>
    </div>
    <label class="checkbox-row"><input type="checkbox" class="sf-home" ${s ? (s.show_on_homepage ? 'checked' : '') : 'checked'} /> Show on the homepage</label>`;
}

function readShiftFields(root) {
  return {
    p_title: root.querySelector('.sf-title').value.trim(),
    p_item_id: root.querySelector('.sf-role').value || null,
    p_shift_date: root.querySelector('.sf-date').value || null,
    p_start_time: root.querySelector('.sf-start').value || null,
    p_end_time: root.querySelector('.sf-end').value || null,
    p_location: root.querySelector('.sf-location').value.trim(),
    p_description: root.querySelector('.sf-desc').value.trim(),
    p_show_on_homepage: root.querySelector('.sf-home').checked,
  };
}

function shiftAdminCardHtml(s, data) {
  const signedIds = new Set(s.signups.map((x) => x.donor_id));
  const bits = [formatDate(s.shift_date), formatTimeRange(s.start_time, s.end_time)];
  if (s.location) bits.push(s.location);
  return `
    <div class="card" data-id="${s.id}">
      <div class="item-head">
        <div class="item-name">${escapeHtml(s.title)}</div>
        ${s.show_on_homepage ? '<span class="pill approved">on homepage</span>' : '<span class="pill">hidden</span>'}
      </div>
      <div class="item-desc">${escapeHtml(bits.join(' · '))}${s.role_name && s.role_name !== s.title ? ` · Role: ${escapeHtml(s.role_name)}` : ''}</div>
      ${s.description ? `<div class="item-desc">${escapeHtml(s.description)}</div>` : ''}
      <div class="item-desc" style="margin-top:8px;"><strong>Signed up (${s.signups.length}):</strong></div>
      ${
        s.signups.length
          ? `<ul class="signup-list">${s.signups
              .map(
                (x) => `<li>${escapeHtml(x.contact_name)}${x.unclaimed ? ' <span class="pill">no account</span>' : ` <span style="color:var(--text-faint);">(${escapeHtml(x.chosen_name)})</span>`}
                  <button type="button" class="secondary small" data-action="remove-signup" data-donor="${x.donor_id}">Remove</button></li>`
              )
              .join('')}</ul>`
          : '<p class="intro" style="margin:4px 0;">Nobody yet.</p>'
      }
      <div class="row" style="margin-top:6px;">
        <select class="add-signup-select">
          ${data.people
            .filter((p) => !signedIds.has(p.id))
            .map((p) => `<option value="${p.id}">${escapeHtml(personLabel(p))}</option>`)
            .join('')}
        </select>
        <button type="button" class="secondary small" data-action="add-signup">Add to shift</button>
      </div>
      <details style="margin-top:10px;">
        <summary style="cursor:pointer; color:var(--accent); font-size:0.85rem;">Edit</summary>
        <div class="shift-edit" style="margin-top:10px;">
          ${shiftFieldsHtml(s, data.roles)}
          <div class="row" style="margin-top:10px;">
            <button type="button" class="small" data-action="save-shift">Save</button>
            <button type="button" class="danger small" data-action="delete-shift">Delete shift</button>
          </div>
        </div>
      </details>
    </div>`;
}

export function renderShiftsTab(el, ctx) {
  const { data, token, notice, reload } = ctx;
  const today = todayLocal();
  const upcoming = data.shifts.filter((s) => s.shift_date >= today).reverse(); // soonest first
  const past = data.shifts.filter((s) => s.shift_date < today);

  el.innerHTML = `
    <h2 class="section-title" style="margin-top:0;">Work Shifts</h2>
    <p class="intro">Post a time you need people there. Upcoming shifts show on the homepage (unless you
      untick it), people sign up from My List, and when they log hours they can pick the shift so the
      date, times, and role fill in on their own.</p>
    <details class="card">
      <summary style="cursor:pointer; color:var(--accent);">+ Post a new shift</summary>
      <div id="new-shift" style="margin-top:10px;">
        ${shiftFieldsHtml(null, data.roles)}
        <button type="button" class="small" id="create-shift-btn" style="margin-top:10px;">Post shift</button>
      </div>
    </details>

    <h3 style="color:var(--accent); margin: 24px 0 10px;">Upcoming (${upcoming.length})</h3>
    ${upcoming.map((s) => shiftAdminCardHtml(s, data)).join('') || '<p class="intro">None posted.</p>'}

    <details style="margin-top:20px;">
      <summary style="cursor:pointer; color:var(--accent);">Past shifts (${past.length})</summary>
      ${past.map((s) => shiftAdminCardHtml(s, data)).join('')}
    </details>`;

  const save = async (id, fields) => {
    const { error } = await supabase.rpc('admin_upsert_shift', { p_session_token: token, p_id: id, ...fields });
    if (error) {
      notice(rpcErrorMessage(error));
      return;
    }
    await reload();
    notice(id ? 'Shift saved.' : 'Shift posted.', 'success');
  };

  el.querySelector('#create-shift-btn').addEventListener('click', () => save(null, readShiftFields(el.querySelector('#new-shift'))));

  el.querySelectorAll('.card[data-id]').forEach((card) => {
    const id = card.dataset.id;
    card.querySelector('[data-action="save-shift"]').addEventListener('click', () => save(id, readShiftFields(card.querySelector('.shift-edit'))));
    card.querySelector('[data-action="delete-shift"]').addEventListener('click', async () => {
      if (!confirm('Delete this shift? Hours people already logged for it are kept.')) return;
      const { error } = await supabase.rpc('admin_delete_shift', { p_session_token: token, p_id: id });
      if (error) {
        notice(rpcErrorMessage(error));
        return;
      }
      await reload();
    });

    const setSignup = async (donorId, signedUp) => {
      const { error } = await supabase.rpc('admin_set_shift_signup', {
        p_session_token: token,
        p_shift_id: id,
        p_donor_id: donorId,
        p_signed_up: signedUp,
      });
      if (error) {
        notice(rpcErrorMessage(error));
        return;
      }
      await reload();
    };
    card.querySelectorAll('[data-action="remove-signup"]').forEach((btn) => btn.addEventListener('click', () => setSignup(btn.dataset.donor, false)));
    card.querySelector('[data-action="add-signup"]').addEventListener('click', () => {
      const v = card.querySelector('.add-signup-select').value;
      if (v) setSignup(v, true);
    });
  });
}
