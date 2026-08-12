// Triggers the hero art draw-in (see .hero-art-wrap.play in styles.css) once the hero
// actually scrolls into view, instead of on a page-load timer. On short viewports the
// old timer-based version could finish drawing off-screen before anyone scrolled down
// far enough to see it (issue #15). Kept in its own import-free file, loaded by its own
// <script> tag, so it can never be taken down by an unrelated failure elsewhere (e.g.
// index.js's Supabase CDN import) — the reveal should always work.
const heroArtWrap = document.querySelector('.hero-art-wrap');
if (heroArtWrap) {
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          heroArtWrap.classList.add('play');
          observer.disconnect();
        }
      }
    });
    observer.observe(heroArtWrap);
  } else {
    heroArtWrap.classList.add('play');
  }
}
