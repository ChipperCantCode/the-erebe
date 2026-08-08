-- Feedback is now a public, unauthenticated endpoint (see submit-feedback edge
-- function) rather than admin-only — anyone visiting the site can leave a bug report
-- or feature request. These columns support that: submitter_name is optional context
-- for the resulting GitHub issue, submitter_ip backs a light per-IP rate limit (the
-- only real defense against abuse now that there's no login gate).

alter table feedback_requests add column submitter_ip text;
alter table feedback_requests add column submitter_name text;
