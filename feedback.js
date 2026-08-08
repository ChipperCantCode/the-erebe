import { supabase, escapeHtml } from './shared.js';

// supabase-js only populates `data` for 2xx responses from functions.invoke(); for any
// non-2xx status it sets `error` (a FunctionsHttpError) with `data: null` instead, and
// the JSON body we actually returned has to be read off error.context (the raw
// Response), which can only be parsed once.
async function readFunctionErrorBody(error) {
  try {
    return await error.context.json();
  } catch {
    return null;
  }
}

const noticeArea = document.getElementById('notice-area');
function notice(msg, kind = 'error') {
  noticeArea.innerHTML = `<div class="notice ${kind}">${escapeHtml(msg)}</div>`;
  noticeArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function clearNotice() {
  noticeArea.innerHTML = '';
}

document.getElementById('fb-submit-btn').addEventListener('click', async () => {
  clearNotice();
  const name = document.getElementById('fb-name').value.trim();
  const title = document.getElementById('fb-title').value.trim();
  const body = document.getElementById('fb-body').value.trim();

  if (!title) {
    notice('Give it a short title before submitting.');
    return;
  }

  const btn = document.getElementById('fb-submit-btn');
  btn.disabled = true;
  try {
    const { data, error } = await supabase.functions.invoke('submit-feedback', {
      body: { title, body, submitter_name: name },
    });

    if (error) {
      const payload = await readFunctionErrorBody(error);
      if (payload?.error === 'rate_limited') {
        notice(payload.detail || 'Too many submissions recently — try again in a bit.');
        return;
      }
      if (payload?.logged) {
        notice("Your note was logged, but publishing it to GitHub failed on our end. We'll still see it.");
        document.getElementById('feedback-form').classList.add('hidden');
        return;
      }
      notice('Could not submit: ' + (payload?.error || error.message || 'unknown error'));
      return;
    }

    document.getElementById('feedback-form').innerHTML = `
      <p style="margin:0;">Thank you! This is now <a href="${escapeHtml(data.issue_url)}" target="_blank" rel="noopener noreferrer">issue #${data.issue_number}</a> on the project's GitHub.</p>`;
  } finally {
    btn.disabled = false;
  }
});
