// Shared photo + dialog tools for portfolio.html and gallery.html.
//
// * prepareImage(): resizes a phone photo in the browser before upload into a "full"
//   (~2000px long edge) and a "display" (~1200px) JPEG. Re-drawing through a canvas also
//   drops EXIF metadata -- including GPS location -- so nobody's home address leaks
//   through a photo's hidden data.
// * choose(): a small promise-based modal (used for "save or discard?", delete confirms,
//   and the "this photo is small" prompt).
// * openLightbox(): full-screen viewer with prev/next, swipe, download, open, share.

import { escapeHtml } from './shared.js';

export const FULL_EDGE = 2000;
export const DISPLAY_EDGE = 1200;
export const JPEG_QUALITY = 0.85;
// Below this long edge, a photo looks soft next to the others once stretched to fill its
// frame -- so we ask the uploader what they'd like to do.
export const SMALL_EDGE = 1000;

async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // fall through to <img> decoding (older Safari doesn't accept the options object)
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toJpeg(source, srcW, srcH, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; // transparent PNGs become white rather than black
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve({ blob, width: w, height: h }) : reject(new Error('Could not process this image.'))),
      'image/jpeg',
      JPEG_QUALITY
    );
  });
}

// Returns { full, display, width, height, origWidth, origHeight, small }
// (full/display are JPEG Blobs; width/height are the full copy's pixel size).
export async function prepareImage(file) {
  if (!file || !/^image\//.test(file.type || '')) {
    throw new Error(`"${file?.name || 'That file'}" isn't an image. Please choose a photo (JPEG, PNG, HEIC from an iPhone, etc.).`);
  }
  let source;
  try {
    source = await decodeImage(file);
  } catch {
    throw new Error(
      `Couldn't read "${file.name}". If it's an iPhone HEIC photo on a computer, try exporting it as JPEG first.`
    );
  }
  const origWidth = source.width;
  const origHeight = source.height;
  const full = await toJpeg(source, origWidth, origHeight, FULL_EDGE);
  const display = await toJpeg(source, origWidth, origHeight, DISPLAY_EDGE);
  if (typeof source.close === 'function') source.close();
  return {
    full: full.blob,
    display: display.blob,
    width: full.width,
    height: full.height,
    origWidth,
    origHeight,
    small: Math.max(origWidth, origHeight) < SMALL_EDGE,
  };
}

// For a small image, ask how to show it. Resolves 'enlarge' | 'pad' | null (cancel).
export function askSmallImageFit(fileName, w, h) {
  return choose({
    title: 'This photo is on the small side',
    html: `<p><strong>${escapeHtml(fileName)}</strong> is ${w}×${h} pixels — smaller than the
      others, so it may look soft or blurry if it's stretched to match them.</p>
      <p>How should it be shown?</p>`,
    choices: [
      { label: 'Enlarge to match the other photos', value: 'enlarge' },
      { label: 'Keep it small, centered with a border', value: 'pad', kind: 'secondary' },
      { label: 'Cancel this photo', value: null, kind: 'secondary' },
    ],
  });
}

// ---------- modal ----------
// choose({ title, html, choices: [{ label, value, kind: 'primary'|'secondary'|'danger' }] })
// resolves with the chosen value, or null if dismissed (Esc / backdrop).
// Pass collect(dialogEl) to read form fields from `html` before the dialog closes; the
// promise then resolves with { value, data }.
export function choose({ title, html = '', choices, collect }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = `
      <form method="dialog" class="modal-body">
        <h3>${escapeHtml(title)}</h3>
        <div class="modal-text">${html}</div>
        <div class="modal-actions">
          ${choices
            .map(
              (c, i) =>
                `<button type="button" data-i="${i}" class="${c.kind === 'secondary' ? 'secondary' : c.kind === 'danger' ? 'danger' : ''}">${escapeHtml(c.label)}</button>`
            )
            .join('')}
        </div>
      </form>`;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      const data = collect ? collect(dlg) : undefined;
      dlg.close();
      dlg.remove();
      resolve(collect ? { value, data } : value);
    };
    dlg.querySelectorAll('[data-i]').forEach((btn) =>
      btn.addEventListener('click', () => finish(choices[Number(btn.dataset.i)].value))
    );
    // pressing Enter in a text field must not silently close the dialog
    dlg.querySelector('form').addEventListener('submit', (e) => e.preventDefault());
    dlg.addEventListener('close', () => finish(null));
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      finish(null);
    });
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) finish(null); // backdrop click
    });
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.querySelector('[data-i]')?.focus();
  });
}

export function confirmDialog(title, html, confirmLabel = 'Yes', danger = false) {
  return choose({
    title,
    html,
    choices: [
      { label: confirmLabel, value: true, kind: danger ? 'danger' : 'primary' },
      { label: 'Cancel', value: false, kind: 'secondary' },
    ],
  }).then((v) => v === true);
}

// ---------- lightbox ----------
// items: [{ full, display, caption, credit, downloadUrl, shareUrl, shareTitle, onReport? }]
export function openLightbox(items, startIndex = 0) {
  if (!items.length) return;
  let index = startIndex;
  const prevFocus = document.activeElement;

  const box = document.createElement('div');
  box.className = 'lightbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Photo viewer');
  box.innerHTML = `
    <div class="lb-top">
      <span class="lb-count"></span>
      <button type="button" class="lb-icon" data-lb="close" aria-label="Close">✕</button>
    </div>
    <div class="lb-stage">
      <button type="button" class="lb-nav lb-prev" data-lb="prev" aria-label="Previous photo">‹</button>
      <img class="lb-img" alt="" />
      <button type="button" class="lb-nav lb-next" data-lb="next" aria-label="Next photo">›</button>
    </div>
    <div class="lb-bottom">
      <div class="lb-caption"></div>
      <div class="lb-actions">
        <a class="lb-btn" data-lb="download" href="#">Download</a>
        <a class="lb-btn" data-lb="open" href="#" target="_blank" rel="noopener">Full size</a>
        <button type="button" class="lb-btn" data-lb="share">Share</button>
        <button type="button" class="lb-btn lb-report" data-lb="report">⚑ Report</button>
      </div>
    </div>`;
  document.body.appendChild(box);
  document.body.classList.add('no-scroll');

  const img = box.querySelector('.lb-img');
  const multi = items.length > 1;
  box.querySelectorAll('.lb-nav').forEach((b) => b.classList.toggle('hidden', !multi));

  function show(i) {
    index = (i + items.length) % items.length;
    const it = items[index];
    // show the lighter display copy instantly, then swap in the full copy once it's loaded
    img.src = it.display || it.full;
    img.alt = it.caption || 'Photo';
    if (it.full && it.full !== it.display) {
      const hi = new Image();
      hi.onload = () => {
        if (items[index] === it) img.src = it.full;
      };
      hi.src = it.full;
    }
    box.querySelector('.lb-count').textContent = multi ? `${index + 1} / ${items.length}` : '';
    box.querySelector('.lb-caption').innerHTML =
      (it.caption ? `<p>${escapeHtml(it.caption)}</p>` : '') +
      (it.credit ? `<p class="lb-credit">${escapeHtml(it.credit)}</p>` : '');
    box.querySelector('[data-lb="download"]').href = it.downloadUrl || it.full;
    box.querySelector('[data-lb="open"]').href = it.full;
    box.querySelector('[data-lb="report"]').classList.toggle('hidden', !it.onReport);
  }

  function close() {
    document.removeEventListener('keydown', onKey);
    box.remove();
    document.body.classList.remove('no-scroll');
    prevFocus?.focus?.();
  }
  function onKey(e) {
    if (document.querySelector('dialog.modal[open]')) return; // a report dialog is on top
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft' && multi) show(index - 1);
    else if (e.key === 'ArrowRight' && multi) show(index + 1);
  }
  document.addEventListener('keydown', onKey);

  box.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-lb]')?.dataset.lb;
    if (!action && (e.target === box || e.target.classList.contains('lb-stage'))) return close();
    if (action === 'close') close();
    else if (action === 'prev') show(index - 1);
    else if (action === 'next') show(index + 1);
    else if (action === 'share') {
      const it = items[index];
      const url = it.shareUrl || it.full;
      try {
        if (navigator.share) {
          await navigator.share({ title: it.shareTitle || document.title, text: it.caption || undefined, url });
        } else {
          await navigator.clipboard.writeText(url);
          e.target.textContent = 'Link copied';
          setTimeout(() => (e.target.textContent = 'Share'), 1800);
        }
      } catch {
        // user cancelled the share sheet -- nothing to do
      }
    } else if (action === 'report') {
      items[index].onReport?.();
    }
  });

  // swipe left/right on touch screens
  let touchX = null;
  img.addEventListener('touchstart', (e) => (touchX = e.touches[0].clientX), { passive: true });
  img.addEventListener(
    'touchend',
    (e) => {
      if (touchX == null || !multi) return;
      const dx = e.changedTouches[0].clientX - touchX;
      if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
      touchX = null;
    },
    { passive: true }
  );

  show(index);
  box.querySelector('[data-lb="close"]').focus();
  return { close };
}

// Builds an <img> tag for a stored photo inside a frame, honoring its fit mode.
// Width/height attributes let the browser reserve space before the image loads.
export function frameHtml({ src, alt, width, height, fit, extraClass = '', attrs = '' }) {
  const fitClass = fit === 'pad' ? 'fit-pad' : fit === 'enlarge' ? 'fit-enlarge' : '';
  const dims = width && height ? `width="${width}" height="${height}"` : '';
  return `<button type="button" class="photo-frame ${fitClass} ${extraClass}" ${attrs} aria-label="View larger${alt ? ': ' + escapeHtml(alt) : ''}">
    <img src="${escapeHtml(src)}" alt="${escapeHtml(alt || '')}" ${dims} loading="lazy" decoding="async" />
  </button>`;
}
