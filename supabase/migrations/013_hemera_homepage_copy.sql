-- Adds a short lore aside about Hemera to the "What is the Erebe?" section. Purely a
-- copy change (no schema/RPC change) — needed so the word "Hemera" actually exists in
-- the live homepage copy for the front-end Easter egg (chipper-mode.js) to hook into,
-- matching the static fallback already updated in index.html.
update page_sections
set body_html = body_html || '<p>The name Erebe borrows from Erebus, the primordial dark. But Erebus had a daughter too — <strong>Hemera</strong>, goddess of day — and she is never far behind him.</p>'
where heading = 'What is the Erebe?'
  and body_html not like '%Hemera%';
