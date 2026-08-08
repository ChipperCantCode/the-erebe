# The Erebe

A project site for **The Erebe**, a temple build for YOUtopia 2026 (San Diego regional
Burning Man event) — plus a volunteer/material/donation sign-up system for Inani's crew.

Live at: https://chippercantcode.github.io/the-erebe/

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
  than applied instantly, since Inani may already be counting on it).
- `admin.html` — shared admin view for Inani and the lead artist. Login is name `admin`,
  passcode `5555` (fixed, per the original request). Approve/deny donor change requests,
  edit any donor's contributions, edit the master wish list (add items, set target
  quantities/units so items can be "fully covered," archive items), and — under
  **Homepage Copy** — edit everything on the public landing page: the hero
  tagline/subtagline, the "Participate" pitch text, and a reorderable list of rich-text
  content sections (bold, headings, bulleted/numbered lists, links), via a small
  toolbar over a `contenteditable` box. No code changes needed for Inani to update the
  front page himself.

## How it works

No build step — static HTML/CSS/JS, deployable straight to GitHub Pages. Data lives in
a dedicated Supabase Postgres project (`erebe-wishlist`). There's no real authentication
system: everything (donor accounts, admin login, all reads/writes) goes through Postgres
`SECURITY DEFINER` RPC functions that check a passcode and hand back a random session
token, stored in the browser's `localStorage`. Row Level Security is enabled with **no**
policies granted directly to the anon key — the tables themselves aren't reachable over
the API at all, only through the specific RPC functions, which is what keeps donor
emails/passcodes from being scraped by anyone poking at the public API.

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
