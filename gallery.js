import {
  supabase,
  escapeHtml,
  renderAccountStatus,
  getDonorToken,
  getAdminToken,
  clearAdminToken,
  rpcErrorMessage,
  readFunctionErrorBody,
  photoUrl,
} from './shared.js';
import { prepareImage, askSmallImageFit, choose, confirmDialog, openLightbox, frameHtml } from './media.js';

renderAccountStatus(document.getElementById('account-status'));

const BUCKET = 'gallery';
const sectionsEl = document.getElementById('gl-sections');
const noticeArea = document.getElementById('notice-area');

const donorToken = getDonorToken();
let adminToken = getAdminToken();
let isAdmin = false;
let signedIn = false;
let donorName = '';
let onlyMine = false;
let gallery = { sections: [] };

const REASONS = [
  ['inappropriate', 'Inappropriate or offensive'],
  ['me_in_photo', "I'm in this photo and want it taken down"],
  ['my_photo_no_permission', 'This is my photo and it was posted without my permission'],
  ['spam', 'Spam or unrelated to the Erebe'],
  ['other', 'Something else'],
];

function notice(msg, kind = 'error') {
  noticeArea.innerHTML = `<div class="notice ${kind}">${escapeHtml(msg)}</div>`;
  noticeArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function functionError(error) {
  const body = await readFunctionErrorBody(error);
  return body?.detail && body?.error !== 'bad_image' ? body.detail : rpcErrorMessage({ message: body?.error || error.message });
}

// ---------------- load ----------------

async function load() {
  if (adminToken) {
    const { data, error } = await supabase.rpc('admin_get_gallery', { p_session_token: adminToken });
    if (!error && data) {
      isAdmin = true;
      gallery = data;
      document.getElementById('admin-bar').classList.remove('hidden');
      return true;
    }
    clearAdminToken();
    adminToken = '';
  }
  const { data, error } = await supabase.rpc('get_gallery', { p_donor_token: donorToken || null });
  if (error || !data) {
    sectionsEl.innerHTML = `<p class="intro">Couldn't load the gallery right now. Please refresh in a moment.</p>`;
    return false;
  }
  gallery = data;
  signedIn = !!data.signed_in;
  return true;
}

async function loadDonorName() {
  if (!donorToken) return;
  const { data } = await supabase.rpc('get_my_donor_info', { p_session_token: donorToken });
  const info = Array.isArray(data) ? data[0] : data;
  donorName = info?.chosen_name || '';
}

// ---------------- render ----------------

function creditLine(ph) {
  const parts = [`Photo: ${ph.photographer}`];
  if (ph.uploader_name && !ph.is_own_photo && ph.uploader_name !== ph.photographer) parts.push(`shared by ${ph.uploader_name}`);
  return parts.join(' · ');
}

function tileHtml(ph, section, i, total) {
  const badges = [];
  if (isAdmin && ph.status === 'hidden') badges.push(`<span class="gl-tile-badge" title="${escapeHtml(ph.hidden_reason || '')}">Hidden</span>`);
  else if (isAdmin && ph.open_reports > 0) badges.push(`<span class="gl-tile-badge">${ph.open_reports} report${ph.open_reports > 1 ? 's' : ''}</span>`);
  else if (ph.mine) badges.push(`<span class="gl-tile-badge mine">Yours</span>`);

  let tools = '';
  if (isAdmin) {
    tools = `
      <div class="gl-tile-tools">
        <button type="button" class="secondary" data-act="caption">Edit</button>
        <button type="button" class="secondary" data-act="left" ${i === 0 ? 'disabled' : ''} aria-label="Move earlier">←</button>
        <button type="button" class="secondary" data-act="right" ${i === total - 1 ? 'disabled' : ''} aria-label="Move later">→</button>
        <select data-act="move" aria-label="Move to section">
          <option value="">Move to…</option>
          ${gallery.sections.filter((s) => s.id !== section.id).map((s) => `<option value="${s.id}">${escapeHtml(s.title)}</option>`).join('')}
        </select>
        <button type="button" class="secondary" data-act="toggle-hidden">${ph.status === 'hidden' ? 'Unhide' : 'Hide'}</button>
        <button type="button" class="danger" data-act="delete">Delete</button>
      </div>`;
  } else if (ph.mine) {
    tools = `
      <div class="gl-tile-tools">
        <button type="button" class="secondary" data-act="caption">Edit caption</button>
        <button type="button" class="danger" data-act="delete">Remove</button>
      </div>`;
  }

  return `
    <div class="gl-tile${ph.status === 'hidden' ? ' is-hidden' : ''}" data-photo-id="${ph.id}">
      ${badges.join('')}
      ${!isAdmin ? `<button type="button" class="gl-tile-flag" data-act="report" title="Report this photo" aria-label="Report this photo">⚑</button>` : ''}
      ${frameHtml({ src: photoUrl(BUCKET, ph.display_path), alt: ph.caption || 'Community photo', width: ph.width, height: ph.height, fit: ph.fit, attrs: `data-open="${i}"` })}
      <div class="gl-tile-caption">${ph.caption ? escapeHtml(ph.caption) + '<br />' : ''}${escapeHtml(creditLine(ph))}</div>
      ${tools}
    </div>`;
}

function uploadFormHtml(section) {
  return `
    <details class="gl-upload">
      <summary class="btn secondary small">+ Add a photo to ${escapeHtml(section.title)}</summary>
      <form class="gl-upload-form card" novalidate>
        <div class="field-group">
          <label class="field">Photo(s)</label>
          <input type="file" accept="image/*" multiple class="up-files" />
          <div class="gl-preview"></div>
        </div>
        <div class="field-group">
          <label class="field">Caption (optional)</label>
          <input type="text" class="up-caption" maxlength="500" placeholder="What's happening here?" />
          <p class="hint">If you pick several photos, they all get this caption. You can upload them one at a time instead to caption each.</p>
        </div>
        <div class="field-group">
          <label class="field">Who took this photo?</label>
          <div class="radio-row">
            <label><input type="radio" name="own-${section.id}" value="yes" checked /> I did</label>
            <label><input type="radio" name="own-${section.id}" value="no" /> Someone else</label>
          </div>
          <input type="text" class="up-photographer hidden" maxlength="100" placeholder="Photographer's name (required)" />
        </div>
        <div class="field-group">
          <label class="field">Your name (optional)</label>
          <input type="text" class="up-uploader" maxlength="100" value="${escapeHtml(donorName)}" placeholder="Leave blank to stay anonymous" />
        </div>
        <label class="gl-consent">
          <input type="checkbox" class="up-consent" />
          <span>I took this photo or have the photographer's permission to share it, and anyone who's clearly recognizable in it is OK with it being posted.</span>
        </label>
        <p class="hint">${
          signedIn
            ? 'You’re logged in, so you can edit the caption or remove this photo later.'
            : 'You’re not logged in, so once it’s posted you won’t be able to edit or remove it yourself. (You can still report it like anyone else.) <a href="my-list.html">Log in on My List</a> first if you’d like that option.'
        }</p>
        <button type="submit" class="up-submit">Post to gallery</button>
        <span class="up-status hint" aria-live="polite"></span>
      </form>
    </details>`;
}

function render() {
  const sections = gallery.sections || [];
  document.getElementById('gl-mine-wrap').classList.toggle('hidden', !signedIn || isAdmin);
  document.getElementById('gl-login-hint').classList.toggle('hidden', signedIn || isAdmin);

  if (!sections.length) {
    sectionsEl.innerHTML = `<p class="intro">${isAdmin ? 'No sections yet. Use “+ New section” above to create one.' : 'No photos yet.'}</p>`;
    return;
  }

  sectionsEl.innerHTML = sections
    .map((s, si) => {
      const photos = (s.photos || []).filter((ph) => !onlyMine || ph.mine);
      const adminCtl = isAdmin
        ? `<div class="gl-section-admin">
            <button type="button" class="secondary small" data-sec="edit">Rename</button>
            <button type="button" class="secondary small" data-sec="up" ${si === 0 ? 'disabled' : ''} aria-label="Move section up">↑</button>
            <button type="button" class="secondary small" data-sec="down" ${si === sections.length - 1 ? 'disabled' : ''} aria-label="Move section down">↓</button>
            <button type="button" class="danger small" data-sec="delete">Delete</button>
          </div>`
        : '';
      return `
      <section class="gl-section" id="section-${s.id}" data-section-id="${s.id}">
        <div class="gl-section-head">
          <div>
            <h2 class="gl-section-title">${escapeHtml(s.title)}</h2>
            ${s.description ? `<p class="gl-section-desc">${escapeHtml(s.description)}</p>` : ''}
          </div>
          ${adminCtl}
        </div>
        ${
          photos.length
            ? `<div class="gl-grid">${photos.map((ph, i) => tileHtml(ph, s, i, photos.length)).join('')}</div>`
            : `<p class="gl-empty">${onlyMine ? 'None of your uploads here.' : 'No photos here yet. Be the first.'}</p>`
        }
        ${uploadFormHtml(s)}
      </section>`;
    })
    .join('');

  sectionsEl.querySelectorAll('.gl-section').forEach(wireSection);
}

function sectionById(id) {
  return gallery.sections.find((s) => s.id === id);
}

function lightboxItems(section) {
  const photos = (section.photos || []).filter((ph) => !onlyMine || ph.mine);
  return photos.map((ph, i) => ({
    display: photoUrl(BUCKET, ph.display_path),
    full: photoUrl(BUCKET, ph.storage_path),
    downloadUrl: photoUrl(BUCKET, ph.storage_path, { download: `erebe-${i + 1}.jpg` }),
    caption: ph.caption || '',
    credit: creditLine(ph),
    shareUrl: `${location.origin}${location.pathname}#section-${section.id}`,
    shareTitle: `${section.title} — The Erebe gallery`,
    onReport: isAdmin ? null : () => reportPhoto(ph),
  }));
}

// ---------------- wiring ----------------

function wireSection(secEl) {
  const section = sectionById(secEl.dataset.sectionId);
  const visible = (section.photos || []).filter((ph) => !onlyMine || ph.mine);

  secEl.querySelectorAll('[data-open]').forEach((btn) =>
    btn.addEventListener('click', () => openLightbox(lightboxItems(section), Number(btn.dataset.open)))
  );

  secEl.querySelectorAll('.gl-tile').forEach((tile) => {
    const ph = visible.find((p) => p.id === tile.dataset.photoId);
    tile.querySelector('[data-act="report"]')?.addEventListener('click', () => reportPhoto(ph));
    tile.querySelector('[data-act="caption"]')?.addEventListener('click', () => editCaption(ph));
    tile.querySelector('[data-act="delete"]')?.addEventListener('click', () => deletePhoto(ph));
    tile.querySelector('[data-act="toggle-hidden"]')?.addEventListener('click', () => toggleHidden(ph));
    tile.querySelector('[data-act="move"]')?.addEventListener('change', (e) => e.target.value && movePhoto(ph, e.target.value));
    ['left', 'right'].forEach((dir) =>
      tile.querySelector(`[data-act="${dir}"]`)?.addEventListener('click', () => reorderPhoto(section, ph, dir === 'left' ? -1 : 1))
    );
  });

  secEl.querySelector('[data-sec="edit"]')?.addEventListener('click', () => editSection(section));
  secEl.querySelector('[data-sec="delete"]')?.addEventListener('click', () => deleteSection(section));
  ['up', 'down'].forEach((dir) =>
    secEl.querySelector(`[data-sec="${dir}"]`)?.addEventListener('click', () => reorderSection(section, dir === 'up' ? -1 : 1))
  );

  wireUploadForm(secEl.querySelector('.gl-upload-form'), section);
}

function wireUploadForm(form, section) {
  const filesInput = form.querySelector('.up-files');
  const preview = form.querySelector('.gl-preview');
  const photographer = form.querySelector('.up-photographer');
  const status = form.querySelector('.up-status');

  filesInput.addEventListener('change', () => {
    preview.innerHTML = '';
    [...filesInput.files].slice(0, 12).forEach((f) => {
      if (!/^image\//.test(f.type)) return;
      const img = document.createElement('img');
      img.src = URL.createObjectURL(f);
      img.onload = () => URL.revokeObjectURL(img.src);
      preview.appendChild(img);
    });
  });

  form.querySelectorAll(`input[name="own-${section.id}"]`).forEach((r) =>
    r.addEventListener('change', () => photographer.classList.toggle('hidden', r.value === 'yes' && r.checked))
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const files = [...filesInput.files];
    const isOwn = form.querySelector(`input[name="own-${section.id}"]:checked`).value === 'yes';
    if (!files.length) return notice('Choose a photo first.');
    if (!isOwn && !photographer.value.trim()) return notice("Please add the photographer's name. If you don't know who took it, please don't post it.");
    if (!form.querySelector('.up-consent').checked) return notice('Please confirm you have the right to share this photo.');

    const btn = form.querySelector('.up-submit');
    btn.disabled = true;
    let posted = 0;
    try {
      for (const file of files) {
        status.textContent = `Preparing ${file.name}…`;
        let img;
        try {
          img = await prepareImage(file);
        } catch (err) {
          notice(err.message);
          continue;
        }
        let fit = 'normal';
        if (img.small) {
          fit = await askSmallImageFit(file.name, img.origWidth, img.origHeight);
          if (!fit) continue;
        }
        status.textContent = `Uploading ${file.name}…`;
        const fd = new FormData();
        fd.append('action', 'upload');
        fd.append('section_id', section.id);
        fd.append('full', img.full, 'full.jpg');
        fd.append('display', img.display, 'display.jpg');
        fd.append('width', String(img.width));
        fd.append('height', String(img.height));
        fd.append('fit', fit);
        fd.append('caption', form.querySelector('.up-caption').value.trim());
        fd.append('uploader_name', form.querySelector('.up-uploader').value.trim());
        fd.append('is_own_photo', String(isOwn));
        fd.append('photographer', photographer.value.trim());
        fd.append('rights_confirmed', 'true');
        if (donorToken) fd.append('donor_token', donorToken);
        const { error } = await supabase.functions.invoke('gallery-photos', { body: fd });
        if (error) {
          notice(`Couldn't post ${file.name}: ${await functionError(error)}`);
          continue;
        }
        posted++;
      }
    } finally {
      btn.disabled = false;
      status.textContent = '';
    }
    if (posted) {
      await reload();
      notice(`Thanks! ${posted} photo${posted === 1 ? ' is' : 's are'} now in “${section.title}”.`, 'success');
      document.getElementById(`section-${section.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
}

async function reload() {
  await load();
  render();
}

// ---------------- reports ----------------

async function reportPhoto(ph) {
  if (!ph) return;
  while (true) {
    const res = await choose({
      title: 'Report this photo',
      html: `
        <p>Reports go privately to the site's admins.</p>
        <div class="field-group">
          <label class="field">What's the problem with?</label>
          <div class="radio-row">
            <label><input type="radio" name="rp-about" value="photo" checked /> The photo</label>
            <label><input type="radio" name="rp-about" value="caption" ${ph.caption ? '' : 'disabled'} /> The caption</label>
          </div>
        </div>
        <div class="field-group">
          <label class="field">Reason</label>
          ${REASONS.map(([v, l]) => `<label class="checkbox-row" style="margin-bottom:6px;"><input type="radio" name="rp-reason" value="${v}" /> <span>${escapeHtml(l)}</span></label>`).join('')}
        </div>
        <div class="field-group">
          <label class="field">Anything else we should know? (optional)</label>
          <textarea class="rp-details" rows="3" maxlength="2000"></textarea>
        </div>
        <div class="field-group">
          <label class="field">Your email, if you'd like a reply (optional)</label>
          <input type="email" class="rp-contact" maxlength="320" />
        </div>`,
      choices: [
        { label: 'Send report', value: 'send', kind: 'danger' },
        { label: 'Cancel', value: null, kind: 'secondary' },
      ],
      collect: (dlg) => ({
        about: dlg.querySelector('input[name="rp-about"]:checked')?.value || 'photo',
        reason: dlg.querySelector('input[name="rp-reason"]:checked')?.value || '',
        details: dlg.querySelector('.rp-details').value.trim(),
        contact: dlg.querySelector('.rp-contact').value.trim(),
      }),
    });
    if (res.value !== 'send') return;
    if (!res.data.reason) {
      await choose({ title: 'Pick a reason', html: '<p>Please choose a reason so we know what to look at.</p>', choices: [{ label: 'OK', value: null }] });
      continue;
    }
    const { data, error } = await supabase.functions.invoke('submit-message', {
      body: { kind: 'report', photo_id: ph.id, ...res.data },
    });
    document.querySelector('.lightbox [data-lb="close"]')?.click();
    if (error) return notice(`Couldn't send the report: ${await functionError(error)}`);
    if (data?.hidden) {
      await reload();
      notice('Thank you. The photo has been hidden while an admin reviews it.', 'success');
    } else {
      notice("Thank you. An admin will take a look.", 'success');
    }
    return;
  }
}

// ---------------- uploader + admin actions ----------------

async function editCaption(ph) {
  const next = prompt('Caption:', ph.caption || '');
  if (next === null) return;
  let error;
  if (isAdmin) {
    const photographer = prompt('Photographer credit:', ph.photographer || '');
    if (photographer === null) return;
    ({ error } = await supabase.rpc('admin_update_gallery_photo', {
      p_session_token: adminToken,
      p_photo_id: ph.id,
      p_caption: next,
      p_photographer: photographer,
    }));
  } else {
    ({ error } = await supabase.rpc('donor_update_gallery_caption', {
      p_session_token: donorToken,
      p_photo_id: ph.id,
      p_caption: next,
    }));
  }
  if (error) return notice(rpcErrorMessage(error));
  await reload();
}

async function deletePhoto(ph) {
  const ok = await confirmDialog(
    isAdmin ? 'Delete this photo?' : 'Remove your photo?',
    '<p>The photo is removed from the gallery and its file is deleted. This can’t be undone.</p>',
    isAdmin ? 'Delete photo' : 'Remove photo',
    true
  );
  if (!ok) return;
  const fd = new FormData();
  fd.append('action', 'delete_photo');
  fd.append('photo_id', ph.id);
  if (isAdmin) fd.append('admin_token', adminToken);
  else fd.append('donor_token', donorToken);
  const { error } = await supabase.functions.invoke('gallery-photos', { body: fd });
  if (error) return notice(await functionError(error));
  await reload();
  notice('Photo removed.', 'success');
}

async function toggleHidden(ph) {
  const hide = ph.status !== 'hidden';
  const reason = hide ? prompt('Why hide it? (optional, only admins see this)', '') : '';
  if (reason === null) return;
  const { error } = await supabase.rpc('admin_set_gallery_photo_status', {
    p_session_token: adminToken,
    p_photo_id: ph.id,
    p_status: hide ? 'hidden' : 'visible',
    p_reason: reason,
  });
  if (error) return notice(rpcErrorMessage(error));
  await reload();
}

async function movePhoto(ph, sectionId) {
  const { error } = await supabase.rpc('admin_move_gallery_photo', {
    p_session_token: adminToken,
    p_photo_id: ph.id,
    p_section_id: sectionId,
  });
  if (error) return notice(rpcErrorMessage(error));
  await reload();
}

async function reorderPhoto(section, ph, delta) {
  const ids = section.photos.map((p) => p.id);
  const i = ids.indexOf(ph.id);
  const j = i + delta;
  if (j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  const { error } = await supabase.rpc('admin_reorder_gallery_photos', {
    p_session_token: adminToken,
    p_section_id: section.id,
    p_photo_ids: ids,
  });
  if (error) return notice(rpcErrorMessage(error));
  await reload();
}

async function sectionDialog(title, section) {
  const res = await choose({
    title,
    html: `
      <div class="field-group"><label class="field">Section name</label>
        <input type="text" class="sec-title" maxlength="120" value="${escapeHtml(section?.title || '')}" /></div>
      <div class="field-group"><label class="field">Short description (optional)</label>
        <input type="text" class="sec-desc" maxlength="300" value="${escapeHtml(section?.description || '')}" /></div>`,
    choices: [
      { label: 'Save', value: 'save' },
      { label: 'Cancel', value: null, kind: 'secondary' },
    ],
    collect: (dlg) => ({ title: dlg.querySelector('.sec-title').value.trim(), description: dlg.querySelector('.sec-desc').value.trim() }),
  });
  if (res.value !== 'save') return;
  if (!res.data.title) return notice('A section needs a name.');
  const { error } = await supabase.rpc('admin_upsert_gallery_section', {
    p_session_token: adminToken,
    p_id: section?.id || null,
    p_title: res.data.title,
    p_description: res.data.description,
  });
  if (error) return notice(rpcErrorMessage(error));
  await reload();
}

function editSection(section) {
  return sectionDialog('Rename section', section);
}

async function deleteSection(section) {
  if ((section.photos || []).length) {
    return notice(`“${section.title}” still has photos. Move them to another section (or delete them) first.`);
  }
  if (!(await confirmDialog(`Delete “${section.title}”?`, '<p>The empty section is removed.</p>', 'Delete section', true))) return;
  const fd = new FormData();
  fd.append('action', 'delete_section');
  fd.append('section_id', section.id);
  fd.append('admin_token', adminToken);
  const { error } = await supabase.functions.invoke('gallery-photos', { body: fd });
  if (error) return notice(await functionError(error));
  await reload();
}

async function reorderSection(section, delta) {
  const ids = gallery.sections.map((s) => s.id);
  const i = ids.indexOf(section.id);
  const j = i + delta;
  if (j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  const { error } = await supabase.rpc('admin_reorder_gallery_sections', { p_session_token: adminToken, p_section_ids: ids });
  if (error) return notice(rpcErrorMessage(error));
  await reload();
}

document.getElementById('gl-new-section').addEventListener('click', () => sectionDialog('New section', null));
document.getElementById('gl-mine').addEventListener('change', (e) => {
  onlyMine = e.target.checked;
  render();
});

// ---------------- init ----------------

(async () => {
  await loadDonorName();
  if (!(await load())) return;
  render();
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
})();
