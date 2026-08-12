import { supabase, sanitizeRichText, escapeHtml, renderAccountStatus, formatDate } from './shared.js';

renderAccountStatus(document.getElementById('account-status'));

// Inani livestreams a build session on Facebook roughly monthly. Newest one shown as a
// real embed; older ones listed as a dated archive. Admin-editable via Homepage Copy ->
// Build Streams, so no code change is needed each time he goes live again.
async function loadBuildStreams() {
  const { data, error } = await supabase.rpc('get_build_streams');
  if (error || !Array.isArray(data) || !data.length) return;

  const [latest, ...past] = data;
  const block = document.getElementById('live-block');
  const embedEl = document.getElementById('live-embed');
  const fallbackEl = document.getElementById('live-fallback');
  const headingEl = document.getElementById('live-heading');

  headingEl.textContent = latest.title ? `Live from the build — ${latest.title}` : 'Live from the build';
  const encodedUrl = encodeURIComponent(latest.video_url);
  embedEl.innerHTML = `
    <iframe
      src="https://www.facebook.com/plugins/video.php?height=314&href=${encodedUrl}&show_text=false&width=560&t=0"
      width="100%"
      height="400"
      style="border:none;overflow:hidden"
      scrolling="no"
      frameborder="0"
      allowfullscreen="true"
      allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
      title="${escapeHtml(latest.title || 'Live stream from the Erebe build')}"
    ></iframe>`;
  fallbackEl.innerHTML = `Not loading? <a href="${escapeHtml(latest.video_url)}" target="_blank" rel="noopener">Watch on Facebook →</a>`;
  block.classList.remove('hidden');

  if (past.length) {
    const listEl = document.getElementById('past-streams-list');
    listEl.innerHTML = past
      .map(
        (s) =>
          `<li><a href="${escapeHtml(s.video_url)}" target="_blank" rel="noopener">${formatDate(s.stream_date)}${
            s.title ? ' — ' + escapeHtml(s.title) : ''
          } →</a></li>`
      )
      .join('');
    document.getElementById('past-streams').classList.remove('hidden');
  }
}
loadBuildStreams();

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
