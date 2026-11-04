// Shared bits for volunteer hour logging + work shifts (my-list.js, admin-hours.js, index.js).
import { escapeHtml, formatDate } from './shared.js';

// The build crew started work Sept 20 — the first day anyone can log, and the default
// date on a fresh log form.
export const HOURS_FIRST_DATE = '2026-09-20';

const DIFFERENT_ROLE = '__different';
const OTHER_ROLE = '__other';

export function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// "13:05:00" / "13:05" -> minutes since midnight
function toMinutes(t) {
  if (!t) return NaN;
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
}

// Hours between two times, rounded to the quarter hour. An end time at or before the
// start time is treated as running past midnight (e.g. 8 PM -> 2 AM = 6 hours).
export function calcHours(start, end) {
  const s = toMinutes(start);
  let e = toMinutes(end);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
  if (e <= s) e += 24 * 60;
  return Math.round(((e - s) / 60) * 4) / 4;
}

export function formatTime(t) {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function formatTimeRange(start, end) {
  if (!start && !end) return '';
  return `${formatTime(start)} – ${formatTime(end)}`;
}

export function formatHours(n) {
  const num = Number(n) || 0;
  const s = Number.isInteger(num) ? String(num) : num.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `${s} hr${num === 1 ? '' : 's'}`;
}

export function shiftLabel(s) {
  return `${s.title} — ${formatDate(s.shift_date)}, ${formatTimeRange(s.start_time, s.end_time)}`;
}

// ---------- the log-hours form ----------
// opts:
//   myRoles    — roles to list first (a volunteer's own sign-ups; for admin, every role)
//   allRoles   — every volunteer role, for the "A different role…" picker
//   shifts     — shifts this entry can be tied to
//   people     — admin only: [{id, label}] to pick whose hours these are
//   isAdmin    — admin skips the "sign up for a role" nudge, the date floor and required times
export function hourFormHtml(opts) {
  const { myRoles, allRoles, shifts, people, isAdmin } = opts;
  const roleOptions = myRoles.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');

  return `
    <div class="hour-form">
      ${
        people
          ? `<div class="field-group">
              <label class="field">Whose hours?</label>
              <select class="hf-person">
                <option value="">— Pick a person —</option>
                ${people.map((p) => `<option value="${p.id}">${escapeHtml(p.label)}</option>`).join('')}
              </select>
            </div>`
          : ''
      }
      ${
        shifts.length
          ? `<div class="field-group">
              <label class="field">Was this a scheduled shift?</label>
              <select class="hf-shift">
                <option value="">No — not a scheduled shift</option>
                ${shifts.map((s) => `<option value="${s.id}">${escapeHtml(shiftLabel(s))}</option>`).join('')}
              </select>
            </div>`
          : ''
      }
      <div class="field-group">
        <label class="field">What did you work on?</label>
        <select class="hf-role">
          ${roleOptions}
          ${isAdmin ? '' : `<option value="${DIFFERENT_ROLE}">A different role…</option>`}
          <option value="${OTHER_ROLE}">Other (write it in)</option>
        </select>
        ${
          !isAdmin && !myRoles.length
            ? `<p class="hf-hint">You haven't signed up for a volunteer role yet —
                <a href="participate.html">sign up for one</a>, or pick a role / write one in above.</p>`
            : ''
        }
      </div>
      <div class="field-group hf-different-group hidden">
        <label class="field">Which role?</label>
        <select class="hf-different">
          ${allRoles.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field-group hf-other-group hidden">
        <label class="field">What did you do?</label>
        <input type="text" class="hf-other" placeholder="e.g. Cooked lunch for the crew" />
      </div>
      <div class="row">
        <div class="field-group">
          <label class="field">Date</label>
          <input type="date" class="hf-date" value="${HOURS_FIRST_DATE}" ${isAdmin ? '' : `min="${HOURS_FIRST_DATE}"`} max="${todayLocal()}" />
        </div>
        <div class="field-group">
          <label class="field">Start time</label>
          <input type="time" class="hf-start" />
        </div>
        <div class="field-group">
          <label class="field">End time</label>
          <input type="time" class="hf-end" />
        </div>
        <div class="field-group">
          <label class="field">Hours</label>
          <input type="number" class="hf-hours" min="0.25" max="24" step="0.25" />
        </div>
      </div>
      <p class="hf-hint hf-hours-hint">Hours fill in from your start and end times — change them if you need to.</p>
      <div class="field-group">
        <label class="field">Notes (optional)</label>
        <input type="text" class="hf-note" placeholder="Anything worth remembering about this shift" />
      </div>
      <button type="button" class="hf-save">Log hours</button>
      <button type="button" class="secondary hf-cancel hidden">Cancel edit</button>
    </div>`;
}

// Wires up the form rendered by hourFormHtml inside `root`. Returns helpers:
//   read()      -> { ok, error } or { ok, values } ready to send to the RPC
//   load(entry) -> fill the form from an existing log entry, switching into edit mode
//   reset()     -> back to a blank "new entry" form
//   editingId   -> id of the entry being edited, or null
export function wireHourForm(root, opts) {
  const { myRoles, shifts, isAdmin } = opts;
  const q = (sel) => root.querySelector(sel);
  const roleSel = q('.hf-role');
  const diffGroup = q('.hf-different-group');
  const otherGroup = q('.hf-other-group');
  const start = q('.hf-start');
  const end = q('.hf-end');
  const hours = q('.hf-hours');
  const saveBtn = q('.hf-save');
  const cancelBtn = q('.hf-cancel');
  const api = { editingId: null };

  function syncRoleGroups() {
    diffGroup.classList.toggle('hidden', roleSel.value !== DIFFERENT_ROLE);
    otherGroup.classList.toggle('hidden', roleSel.value !== OTHER_ROLE);
  }
  roleSel.addEventListener('change', syncRoleGroups);

  // Pick a role in whichever of the three pickers it lives in.
  function setRole(itemId, otherText) {
    if (itemId && myRoles.some((r) => r.id === itemId)) {
      roleSel.value = itemId;
    } else if (itemId && !isAdmin && [...q('.hf-different').options].some((o) => o.value === itemId)) {
      roleSel.value = DIFFERENT_ROLE;
      q('.hf-different').value = itemId;
    } else {
      roleSel.value = OTHER_ROLE;
      q('.hf-other').value = otherText || '';
    }
    syncRoleGroups();
  }

  function recalc() {
    const h = calcHours(start.value, end.value);
    if (h != null) hours.value = h;
  }
  start.addEventListener('change', recalc);
  end.addEventListener('change', recalc);

  q('.hf-shift')?.addEventListener('change', (e) => {
    const s = shifts.find((x) => x.id === e.target.value);
    if (!s) return;
    q('.hf-date').value = s.shift_date;
    start.value = (s.start_time || '').slice(0, 5);
    end.value = (s.end_time || '').slice(0, 5);
    recalc();
    setRole(s.item_id, s.title);
  });

  api.read = () => {
    const person = q('.hf-person');
    if (person && !person.value) return { ok: false, error: 'Pick whose hours these are.' };
    const workDate = q('.hf-date').value;
    if (!workDate) return { ok: false, error: 'Pick the date you worked.' };
    if (!isAdmin && workDate < HOURS_FIRST_DATE) return { ok: false, error: 'The build started Sept 20 — pick that date or later.' };
    if (workDate > todayLocal()) return { ok: false, error: "That date hasn't happened yet." };
    if (!isAdmin && (!start.value || !end.value)) return { ok: false, error: 'Add your start and end times.' };
    const h = Number(hours.value);
    if (!Number.isFinite(h) || h <= 0 || h > 24) return { ok: false, error: 'Hours must be more than 0 and no more than 24.' };

    let itemId = null;
    let roleOther = null;
    if (roleSel.value === DIFFERENT_ROLE) itemId = q('.hf-different').value || null;
    else if (roleSel.value === OTHER_ROLE) {
      roleOther = q('.hf-other').value.trim();
      if (!roleOther) return { ok: false, error: 'Write in what you worked on.' };
    } else itemId = roleSel.value;

    return {
      ok: true,
      values: {
        p_donor_id: person ? person.value : undefined,
        p_work_date: workDate,
        p_start_time: start.value || null,
        p_end_time: end.value || null,
        p_hours: h,
        p_item_id: itemId,
        p_role_other: roleOther,
        p_shift_id: q('.hf-shift')?.value || null,
        p_note: q('.hf-note').value.trim() || null,
      },
    };
  };

  api.load = (entry) => {
    api.editingId = entry.id;
    if (q('.hf-person')) q('.hf-person').value = entry.donor_id;
    const shiftSel = q('.hf-shift');
    if (shiftSel) shiftSel.value = shifts.some((s) => s.id === entry.shift_id) ? entry.shift_id : '';
    q('.hf-date').value = entry.work_date;
    start.value = (entry.start_time || '').slice(0, 5);
    end.value = (entry.end_time || '').slice(0, 5);
    hours.value = Number(entry.hours);
    setRole(entry.item_id, entry.role_label);
    q('.hf-note').value = entry.note || '';
    saveBtn.textContent = 'Save changes';
    cancelBtn.classList.remove('hidden');
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  api.reset = () => {
    api.editingId = null;
    if (q('.hf-person')) q('.hf-person').value = '';
    if (q('.hf-shift')) q('.hf-shift').value = '';
    q('.hf-date').value = HOURS_FIRST_DATE;
    start.value = '';
    end.value = '';
    hours.value = '';
    roleSel.selectedIndex = 0;
    q('.hf-other').value = '';
    q('.hf-note').value = '';
    syncRoleGroups();
    saveBtn.textContent = 'Log hours';
    cancelBtn.classList.add('hidden');
  };

  cancelBtn.addEventListener('click', () => api.reset());
  syncRoleGroups();
  return api;
}

// One row in a list of logged hours. `who` is shown for admin views.
export function hourEntryHtml(entry, { who } = {}) {
  const when = [formatDate(entry.work_date), formatTimeRange(entry.start_time, entry.end_time)].filter(Boolean).join(' · ');
  return `
    <div class="hour-entry" data-id="${entry.id}">
      <div class="hour-entry-main">
        <div class="item-name">${who ? `${escapeHtml(who)} — ` : ''}${escapeHtml(entry.role_label)}</div>
        <div class="item-desc">${escapeHtml(when)}${entry.shift_title ? ` · Shift: ${escapeHtml(entry.shift_title)}` : ''}${
          entry.logged_by === 'admin' ? ' · logged by Inani' : ''
        }</div>
        ${entry.note ? `<div class="item-desc">${escapeHtml(entry.note)}</div>` : ''}
      </div>
      <div class="hour-entry-side">
        <span class="qty-badge">${formatHours(entry.hours)}</span>
        <button type="button" class="secondary small" data-action="edit-hours">Edit</button>
        <button type="button" class="danger small" data-action="delete-hours">Delete</button>
      </div>
    </div>`;
}
