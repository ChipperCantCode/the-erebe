import { supabase, sanitizeRichText, escapeHtml } from './shared.js';

// The static markup already in index.html is a real fallback (and what Inani edits
// via Admin -> Homepage Copy starts from it) — this just upgrades it live once the
// fetch resolves. The hero image + reveal animation are pure CSS/local-asset and never
// wait on this.
async function loadHomepageContent() {
  const { data, error } = await supabase.rpc('get_homepage_content');
  if (error || !data) return; // keep the static fallback already on the page

  if (data.hero_tagline) {
    document.getElementById('hero-tagline').textContent = data.hero_tagline;
  }
  if (data.hero_subtagline) {
    document.getElementById('hero-subtagline').textContent = data.hero_subtagline;
  }
  if (data.cta_text) {
    document.getElementById('cta-text').textContent = data.cta_text;
  }

  if (Array.isArray(data.sections) && data.sections.length) {
    const el = document.getElementById('dynamic-sections');
    el.innerHTML = data.sections
      .map((s) => {
        const heading = s.heading ? `<h2>${escapeHtml(s.heading)}</h2>` : '';
        return heading + sanitizeRichText(s.body_html || '');
      })
      .join('');
  }
}

loadHomepageContent();
