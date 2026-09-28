import { supabase, sanitizeRichText, escapeHtml, renderAccountStatus, formatDate } from './shared.js';
import { formatTimeRange } from './hours.js';

renderAccountStatus(document.getElementById('account-status'));

// The static markup already in index.html is a real fallback (and what Inani edits
// via Admin -> Homepage Copy starts from it) — this just upgrades it live once the
// fetch resolves. The hero image + reveal animation (hero-reveal.js) are local-asset
// only and never wait on this.
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

async function loadUpcomingShifts() {
  const { data, error } = await supabase.rpc('get_upcoming_shifts');
  if (error || !Array.isArray(data) || !data.length) return;

  document.getElementById('upcoming-shift-list').innerHTML = data
    .map((s) => {
      const bits = [formatDate(s.shift_date), formatTimeRange(s.start_time, s.end_time)];
      if (s.location) bits.push(s.location);
      return `
        <div class="card shift-card">
          <div class="item-name">${escapeHtml(s.title)}</div>
          <div class="item-desc">${escapeHtml(bits.join(' · '))}</div>
          ${s.role_name && s.role_name !== s.title ? `<div class="item-desc">Role: ${escapeHtml(s.role_name)}</div>` : ''}
          ${s.description ? `<div class="item-desc">${escapeHtml(s.description)}</div>` : ''}
          <div class="shift-card-foot">
            <span class="item-desc">${s.signup_count} signed up</span>
            <a class="btn small-btn" href="my-list.html?shift=${encodeURIComponent(s.id)}#shifts">Sign up →</a>
          </div>
        </div>`;
    })
    .join('');
  document.getElementById('upcoming-shifts').classList.remove('hidden');
}

loadUpcomingShifts();
