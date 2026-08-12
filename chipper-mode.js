// Hidden "Chipper Mode" easter egg — Nina/Skippy and everyone who prefers sun to shadow.
// Entirely self-contained and import-free (like hero-reveal.js) so it can never be taken
// down by an unrelated failure elsewhere, and entirely additive: it never touches how the
// rest of the site works when it's off.
//
// Trigger: the Konami code (↑ ↑ ↓ ↓ ← → ← → B A) floods the site with daylight. Entering
// the code backwards (A B → ← → ← ↓ ↓ ↑ ↑) returns it to the gloom. State is in-memory
// only — a refresh resets to the normal dark theme.

const FORWARD_CODE = [
  'arrowup', 'arrowup', 'arrowdown', 'arrowdown',
  'arrowleft', 'arrowright', 'arrowleft', 'arrowright',
  'b', 'a',
];
const REVERSE_CODE = [...FORWARD_CODE].slice().reverse();
const HEMERA_HINT = 'To bring the day, type the ancient code of the sun (↑ ↑ ↓ ↓ ← → ← → B A).';
const SUN_HINT = 'To bring back the gloom, reverse the ancient code (A B → ← → ← ↓ ↓ ↑ ↑).';

// ---------- Hemera hover hint ----------
// Wraps the literal word "Hemera" wherever it appears in the homepage copy (static
// fallback or live admin-edited content — both land in #dynamic-sections) in an
// unstyled span carrying a cheerful hover/focus tooltip. Runs on load and again on any
// DOM change so it survives index.js swapping in live content asynchronously.
function wrapHemeraHint(root) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.includes('Hemera')) return NodeFilter.FILTER_REJECT;
      if (node.parentElement && node.parentElement.closest('.hemera-hint')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const targets = [];
  let node;
  while ((node = walker.nextNode())) targets.push(node);

  targets.forEach((textNode) => {
    const parts = textNode.nodeValue.split('Hemera');
    const frag = document.createDocumentFragment();
    parts.forEach((part, i) => {
      if (part) frag.appendChild(document.createTextNode(part));
      if (i < parts.length - 1) {
        const span = document.createElement('span');
        span.className = 'hemera-hint';
        span.tabIndex = 0;
        span.textContent = 'Hemera';
        const tip = document.createElement('span');
        tip.className = 'chipper-tooltip';
        tip.textContent = HEMERA_HINT;
        span.appendChild(tip);
        frag.appendChild(span);
      }
    });
    textNode.replaceWith(frag);
  });
}

function watchForHemera() {
  const container = document.getElementById('dynamic-sections') || document.body;
  wrapHemeraHint(container);
  const observer = new MutationObserver(() => wrapHemeraHint(container));
  observer.observe(container, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', watchForHemera);
} else {
  watchForHemera();
}

// ---------- Konami code listener ----------
// Index-based state machine (not a sliding-window buffer) so we only preventDefault —
// blocking the arrow keys' native page-scroll — while a sequence attempt is actually
// in progress, rather than on every arrow/b/a keystroke for every visitor forever.
let forwardIdx = 0;
let reverseIdx = 0;
document.addEventListener('keydown', (e) => {
  const target = e.target;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

  const key = e.key.toLowerCase();

  forwardIdx = key === FORWARD_CODE[forwardIdx] ? forwardIdx + 1 : (key === FORWARD_CODE[0] ? 1 : 0);
  reverseIdx = key === REVERSE_CODE[reverseIdx] ? reverseIdx + 1 : (key === REVERSE_CODE[0] ? 1 : 0);

  if (forwardIdx > 0 || reverseIdx > 0) e.preventDefault();

  if (forwardIdx === FORWARD_CODE.length) {
    forwardIdx = 0;
    activateChipperMode();
  } else if (reverseIdx === REVERSE_CODE.length) {
    reverseIdx = 0;
    deactivateChipperMode();
  }
});

// ---------- Chipper Mode ----------
const REDUCED_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let ambientIntervalId = null;
let cornerSunEl = null;
let floodEl = null;

function makeCornerSun(settled) {
  const sun = document.createElement('div');
  sun.className = settled ? 'chipper-corner-sun chipper-corner-sun--settled' : 'chipper-corner-sun';
  sun.tabIndex = 0;
  const tip = document.createElement('span');
  tip.className = 'chipper-tooltip';
  tip.textContent = SUN_HINT;
  sun.appendChild(tip);
  document.body.appendChild(sun);
  return sun;
}

function spawnFloatingIcon() {
  const icon = document.createElement('span');
  icon.className = 'chipper-float';
  icon.textContent = Math.random() < 0.6 ? '☀️' : '🐱';
  const startX = Math.random() * 100;
  const drift = (Math.random() * 160 - 80).toFixed(0) + 'px';
  const spin = (Math.random() * 40 - 20).toFixed(0) + 'deg';
  const duration = (6 + Math.random() * 5).toFixed(2) + 's';
  const size = (1.4 + Math.random() * 1.6).toFixed(2) + 'rem';
  icon.style.left = startX + 'vw';
  icon.style.setProperty('--drift', drift);
  icon.style.setProperty('--spin', spin);
  icon.style.fontSize = size;
  icon.style.animationDuration = duration;
  icon.addEventListener('animationend', () => icon.remove());
  document.body.appendChild(icon);
}

function spawnCornerSun() {
  const heroWrap = document.querySelector('.hero-art-wrap');
  const startRect = (heroWrap || document.body).getBoundingClientRect();

  const sun = makeCornerSun(false);

  const sunSize = 60;
  sun.style.top = (startRect.top + startRect.height / 2 - sunSize / 2) + 'px';
  sun.style.left = (startRect.left + startRect.width / 2 - sunSize / 2) + 'px';

  requestAnimationFrame(() => {
    sun.style.transition = 'top 2.4s cubic-bezier(.22,.61,.36,1), left 2.4s cubic-bezier(.22,.61,.36,1), transform 1.8s ease';
    sun.style.top = '16px';
    sun.style.left = (window.innerWidth - sunSize - 16) + 'px';
  });

  return sun;
}

function activateChipperMode() {
  if (document.body.classList.contains('chipper-mode')) return;

  if (REDUCED_MOTION) {
    document.body.classList.add('chipper-mode');
    cornerSunEl = makeCornerSun(true);
    return;
  }

  const heroWrap = document.querySelector('.hero-art-wrap');
  const rect = (heroWrap || document.body).getBoundingClientRect();

  floodEl = document.createElement('div');
  floodEl.className = 'chipper-flood';
  floodEl.style.top = (rect.top + rect.height / 2) + 'px';
  floodEl.style.left = (rect.left + rect.width / 2) + 'px';
  document.body.appendChild(floodEl);

  document.body.classList.add('chipper-dawning');

  for (let i = 0; i < 14; i++) {
    setTimeout(spawnFloatingIcon, i * 120);
  }

  setTimeout(() => {
    document.body.classList.remove('chipper-dawning');
    document.body.classList.add('chipper-mode');
    if (floodEl) {
      floodEl.remove();
      floodEl = null;
    }
    cornerSunEl = spawnCornerSun();
  }, 2600);

  ambientIntervalId = setInterval(() => {
    spawnFloatingIcon();
    if (Math.random() < 0.4) spawnFloatingIcon();
  }, 1400);
}

function deactivateChipperMode() {
  if (!document.body.classList.contains('chipper-mode') && !document.body.classList.contains('chipper-dawning')) return;

  document.body.classList.remove('chipper-mode', 'chipper-dawning');

  if (ambientIntervalId) {
    clearInterval(ambientIntervalId);
    ambientIntervalId = null;
  }
  if (cornerSunEl) {
    cornerSunEl.remove();
    cornerSunEl = null;
  }
  if (floodEl) {
    floodEl.remove();
    floodEl = null;
  }
  document.querySelectorAll('.chipper-float').forEach((el) => el.remove());
}
