# The Erebe

A project site for **The Erebe**, a temple build for YOUtopia 2026 (San Diego regional
Burning Man event) — plus a volunteer/material/donation sign-up system for Inani's crew.

Live at: https://erebe.art (custom domain via GoDaddy DNS -> GitHub Pages; also reachable
at https://chippercantcode.github.io/the-erebe/)

## Pages

- `index.html` — the public landing page. What the Erebe is, who's building it, and why
  — a hero reveal of the elevation drawing (bottom-up clip-path animation, fading into
  the title), then a short project description and a "Participate →" call to action.
  No sign-up mechanics live here on purpose; that's all one click away.
- `participate.html` — the wish list, in three sections: **Volunteers** (roles fill by
  headcount or, for one-owner leadership roles like Project Manager, by percentage —
  one person can take 0–100%, or several people can split it), **Materials & Supplies**
  (quantity-based), and **Donations** ($, USD) for cash asks like sales tax or a general
  build fund. Everyone can browse, see what's already covered, and see who to thank (or
  "Anonymous").
- `contribute.html` — the sign-up flow. Pick any number of items in any quantity
  (including fractions like `1/4`), create a simple account (chosen name + passcode,
  no email/password login), fill in per-item details, and submit.
- `my-list.html` — a donor's own dashboard. Log in with chosen name + passcode to see
  everything you've signed up for, update contact info, or request a change (reduce a
  quantity or remove an item — always with a reason, and always held for review rather
  than applied instantly, since Inani may already be counting on it). There's no
  self-service password reset (no email-sending infra, and a real reset flow would
  work against the whole point of avoiding a real auth system) — if a donor forgets
  their passcode, an admin resets it for them from the Donors tab and relays the new
  one directly.
- `admin.html` — shared admin view for Inani and the lead artist. Approve/deny donor change requests,
  edit any donor's contributions, reset a donor's passcode, edit the master wish list
  (add items, set target quantities/units so items can be "fully covered," archive
  items), and — under **Homepage Copy** — edit everything on the public landing page:
  the hero tagline/subtagline, the "Participate" pitch text, and a reorderable list of
  rich-text content sections (bold, headings, bulleted/numbered lists, links), via a
  small toolbar over a `contenteditable` box, and a list of **build livestream** entries
  (Inani goes live on Facebook roughly monthly to draw/plan) — the newest shows as a real
  embed on the homepage, older ones list underneath as a dated archive. No code changes
  needed for Inani to update the front page himself, add a new stream, or retire an old
  one. The **Portfolio** tab edits the portfolio's intro quote and credits footer, adds
  pieces, and archives/unarchives them (the pieces themselves are edited in place on
  `portfolio.html`). The **Inbox** tab holds Contact Inani messages and gallery photo
  reports (`admin.html#inbox` opens it directly). The **Feedback** tab shows the history of everything submitted through the public
  feedback form (see below) and can also submit directly.
- `portfolio.html` — Inani's art portfolio, the page to send grant reviewers. An intro
  quote, then every project newest-first (with big year markers between them), each
  with its date, event, Inani's role, a credit line, the story, and photos (the first
  shown large, the rest in a grid; tap any photo for a full-screen viewer with
  download / full size / share). A floating **Index** button opens a jump-to-piece menu,
  and every piece has its own link: `erebe.art/portfolio.html#<slug>` (e.g. `#wobot`).
  A **Contact Inani** form and the credits footer close the page. When you're logged in
  as admin (log in on `admin.html` first, then open the page), each piece gets a ✎
  button for **inline editing** — see "Portfolio" below.
- `gallery.html` — community photo gallery, split into sections that admins create,
  rename, reorder, and delete. Anyone can upload into any section — see "Gallery" below.
- `feedback.html` — public, no login needed. Anyone can leave a bug report or feature
  request; it's published as a GitHub issue on this repo automatically, so Chipper gets
  a normal GitHub notification without any of this needing to run back through a
  Claude conversation. Linked from the footer of every page.

## How it works

No build step — static HTML/CSS/JS, deployable straight to GitHub Pages. Data lives in
a dedicated Supabase Postgres project (`erebe-wishlist`). There's no real authentication
system: everything (donor accounts, admin login, all reads/writes) goes through Postgres
`SECURITY DEFINER` RPC functions that check a passcode and hand back a random session
token, stored in the browser's `localStorage`. Row Level Security is enabled with **no**
policies granted directly to the anon key — the tables themselves aren't reachable over
the API at all, only through the specific RPC functions, which is what keeps donor
emails/passcodes from being scraped by anyone poking at the public API.

**Admin login:** name `admin` plus the shared admin passcode. The passcode is stored only
as a bcrypt hash in the `admin_credentials` table (RLS on, no grants — not readable over
the API) and is never written in this repo. Ask Chipper for it. (`002_functions_and_grants.sql`
still shows the original placeholder passcode from before it was hashed; that function was
replaced by `015_admin_passcode_hashed.sql` and that old value no longer works.)

Connection details (`SUPABASE_URL` / anon key) are in `shared.js`. The anon key is safe
to be public — it can't do anything except call the whitelisted RPC functions.

The schema/functions/seed data live in `supabase/migrations/` in this repo, applied to
the `erebe-wishlist` Supabase project — that's the source of truth if the project ever
needs to be recreated.

`assets/elevation-view-white.png` is Inani's elevation drawing from the Drive folder,
inverted to white-on-transparent so it glows against the dark background — that's what
`index.html`'s hero reveal animates in.

Homepage copy is editable content, not hardcoded: `index.html` ships the current copy
as a static fallback (shown instantly, and what you see if the fetch ever fails —
Supabase being briefly down shouldn't tank the front page), and `index.js` swaps in
the live version from `get_homepage_content()` once it loads. Rich text is edited with
`document.execCommand` (bold/italic/heading/lists/links) rather than a bundled editor
library, to keep the no-build-step setup — deprecated but still implemented in every
major browser for exactly this basic a feature set. The one real security boundary is
`sanitizeRichText()` in `shared.js`: a strict tag/attribute allowlist that runs
client-side on `body_html` before it's ever set via `innerHTML` on a page a regular
visitor loads (writes only happen through the admin-passcode-gated RPCs, but that's an
access boundary, not a content one — sanitizing at render time is what actually stops
a stray `<script>` from running in a visitor's browser).

## Feedback -> GitHub issues

`feedback.html` and the admin Feedback tab both call a Supabase Edge Function
(`supabase/functions/submit-feedback`) rather than a Postgres RPC, since Postgres
functions can't make outbound HTTP calls. It's a deliberately public, unauthenticated
endpoint — anyone visiting the site can leave feedback without logging in — so the only
defense against abuse is a light per-IP rate limit (5/hour, tracked via a
`submitter_ip` column). Worst case of it being open is a spammy GitHub issue, which
costs nothing to close; that tradeoff seemed better than gating basic feedback behind
the shared admin passcode.

The function logs every submission to `feedback_requests`, then opens a GitHub issue
via the REST API using a token read from `integration_secrets` — a table locked down
the same way as everything else here (RLS, no policies, so it's unreachable via the
public API; only the edge function's service-role key or direct SQL can read it). That
table stands in for a real Supabase secret because there's no MCP tool available in
this environment to set one — if you ever manage this project with the Supabase CLI,
moving `github_issues_token` into `supabase secrets set` and reading it via
`Deno.env.get` instead would be the proper version of this.

The GitHub token needs exactly one permission: **Issues: Read and write**, scoped to
only this repository (a fine-grained PAT, not a classic one) — nothing else it can
reach or do.

## Portfolio

Tables (all locked down: RLS on, no grants — reachable only through the RPCs):

- `portfolio_projects` — one row per piece: `slug` (the `#link` name), `title`,
  `occurred_on` (a date, always the **1st of the month** — this sets page order),
  `year_label` (optional display override like "2019, 2022"), `event`, `role`, `credit`,
  `body_html` (paragraphs separated by `<br><br>`, same as `page_sections`), `sort_order`
  (tiebreak within the same month; higher shows first), `archived`.
- `portfolio_photos` — `project_id`, `storage_path` (the ~2000px "full" copy),
  `display_path` (~1200px copy used on the page), `width`/`height`, `fit`
  (`normal` / `enlarge` / `pad` — see below), `caption`, `sort_order`.
- `portfolio_page` — single row: `intro_quote`, `intro_attribution` (the "— Inani"
  line; blank for none), `footer_html` (credits). Edited in place on the portfolio page
  (✎ on the quote and on the credits) or from Admin → Portfolio, both through
  `admin_save_portfolio_page`. (`admin_update_portfolio_page` is the older version without
  the attribution; it's unused and kept only so no live function had to be dropped.)
- `portfolio_page_versions` — edit history for the quote/credits, filled by a trigger
  before every change, just like the pieces' history.
- `portfolio_project_versions` — **edit history.** A trigger snapshots a piece's row
  every time it's saved or deleted (deletes also keep a list of its photos), so the
  text of any earlier version can be brought back from the editor's **History** button.

`get_portfolio()` (anon-callable) returns `{ page, projects: [...] }`, newest first, each
project with `date_label` ("Feb 2024", or `year_label` when set) and its `photos`.
`admin_get_portfolio(token)` returns the same plus archived pieces and the raw fields.

**Inline editing** (`portfolio.js`): one thing at a time — a piece, the intro quote, or
the credits. Tapping ✎ on a second piece,
clicking a link off the page, or pressing Cancel while there are unsaved changes shows a
*Save / Discard / Keep editing* prompt; closing or reloading the tab shows the browser's
own "Leave site?" warning (browsers don't allow a custom one there). Text fields save with
the Save button. Photo uploads, replacements, deletions, and reordering save immediately.
The editor's bottom bar is **Save**, **Cancel & revert**, and a **⋯** menu with
History, Archive, and Delete. **Delete piece** asks for confirmation and offers **Archive** instead (archive is
reversible, delete removes the photos for good).

**Photos** are resized in the browser before upload (`media.js`: ~2000px long edge for
the full copy, ~1200px for the display copy, JPEG at 85%), which also strips hidden
EXIF data such as GPS location. If a photo is smaller than 1000px on its long edge, the
uploader is asked whether to **enlarge it to match** the others (`fit = enlarge`) or
**keep it small, centered with a border** (`fit = pad`), or skip it.

Storage: public buckets `portfolio` and `gallery`, with **no storage policies**: reads
work because the buckets are public, and writes only happen through Edge Functions using
the service role. The site doesn't use Supabase Auth, so storage policies couldn't tell
an admin apart from anyone else anyway:

- `supabase/functions/portfolio-photos` — admin only. Checks the session token against
  `admin_sessions` (not expired), then uploads / replaces / deletes photos (row and file
  together) or deletes a whole piece.
- Files are cached by the CDN for **1 hour**, so a deleted photo can keep loading for
  up to an hour for anyone who already had its link.

Link previews: crawlers don't run JavaScript, so `portfolio.html`'s `og:image` is a fixed
file (currently the site-wide `assets/og-image.jpg`). Once the portfolio has photos, save
a 1200×630 crop of a favorite as `assets/og-portfolio.jpg` and point the two image tags
at it.

## Gallery

- `gallery_sections` (title, description, sort order) and `gallery_photos` (full +
  display paths, size, `fit`, `caption`, `photographer`, `is_own_photo`,
  `uploader_name`, `donor_id`, `status` visible/hidden). `get_gallery(donor_token)` is
  public and never returns uploader IPs or donor ids. It marks your own uploads with `mine`.
- Uploads go through `supabase/functions/gallery-photos` (public, **20 uploads/hour per
  IP**). Following common practice for community photo pages, every upload requires
  **a photographer credit** ("I took it" or the photographer's name) and **a
  confirmation** that the uploader took it or has permission, and that anyone clearly
  recognizable is OK with it being posted. GPS/EXIF data is stripped by the browser-side
  resize. Collapsible guidelines on the page spell this out.
- If the uploader is **logged in** (their My List account), the photo is tied to them and
  they can later edit its caption or remove it (toggle "Show only my uploads"). Anonymous
  uploads can't be changed afterwards except by an admin.
- Admins (logged in on `admin.html`, then open the gallery) can add/rename/reorder/delete
  sections (only empty ones can be deleted), move photos between sections, reorder,
  edit captions/credits, hide/unhide, and delete.

## Contact messages, reports, and notifications

`supabase/functions/submit-message` handles both the **Contact Inani** form and the
gallery's **⚑ report** button. Like feedback, each submission is saved to the database
(`contact_messages` / `content_reports`) and also opens a GitHub issue so Chipper gets
notified. **This repo is public**, so those issues are *alerts only* ("New message for
Inani from Sam, read it in Admin → Inbox"). The sender's email, message, and report
details stay in the database and show only in **Admin → Inbox**, where you can reply by
email, archive messages, and hide / delete / restore reported photos. Close the GitHub
alert once it's handled.

- Rate limits: 5 contact messages and 10 reports per IP per hour. The contact form also
  has a hidden "honeypot" field that silently drops spam bots.
- Reported as **"I'm in this photo"** or **"my photo, posted without permission"**: the
  photo is hidden immediately, pending review (consent first; an admin can restore it).
  Any other reason: hidden automatically once **3 different visitors** report it.
- Email delivery via **Resend** isn't set up yet. When it is, it slots into
  `submit-message`, and the database rows stay the system of record.

## Database migrations

`supabase/migrations/` is the source of truth, numbered in the order applied. The live
project's own migration history uses different names and timestamps for some of them
(e.g. `015`–`017` here are live versions `20261103104309`, `20261103104416`,
`20261103104643`, applied from a Claude chat; each file's header says so). The live
project also has a `hours_and_shifts` migration (the `work_shifts` / `shift_signups` /
`hour_logs` tables) that isn't recorded in this folder yet.

Tip for future changes made through the Supabase connector: SQL containing the word
`delete` triggers a confirmation prompt that may not show up in every Claude app, which
makes the call time out. Deletes that can't be avoided (photos, sections) live in the
Edge Functions instead.

## Running it

```
python3 -m http.server 8000
```

then open `http://localhost:8000/`.

## Seed data & targets

The wish list was seeded from Inani's "Erebe Wish List" message and the YOUtopia grant
budget spreadsheet. Target quantities come from three sources, and it's worth knowing
which is which when something looks off:

- **Hard numbers from the budget** (e.g. Plywood: 120 sheets = 40 floor + 60 wall + 20
  spire slatting).
- **Estimates derived from the 30-person crew assumption** (e.g. Gloves: 30 pairs, one
  per crew member) — flagged as estimates in the item description.
- **Open-ended** (no target) where neither the budget nor a crew-size assumption gives a
  reasonable basis — these just show a running total, never "fully covered."

Build crew signups (CoLab prefab shop vs. the event site, or both) record availability
within the build window (Sept 16 – Oct 7, 2026, per Chipper) instead of a generic
arrival/departure date.
