# The Erebe — Wish List & Sign-Up

A volunteer/material sign-up site for **The Erebe**, a temple build for YOUtopia 2026
(San Diego regional Burning Man event). Built for Inani's crew.

Live at: https://chippercantcode.github.io/the-erebe/ (once GitHub Pages is enabled)

## Pages

- `index.html` — public wish list. Everyone can browse volunteer roles and material
  needs, see what's already covered, and see who to thank (or "Anonymous").
- `contribute.html` — the sign-up flow. Pick any number of items in any quantity
  (including fractions like `1/4`), create a simple account (chosen name + passcode,
  no email/password login), fill in per-item details, and submit.
- `my-list.html` — a donor's own dashboard. Log in with chosen name + passcode to see
  everything you've signed up for, update contact info, or request a change (reduce a
  quantity or remove an item — always with a reason, and always held for review rather
  than applied instantly, since Inani may already be counting on it).
- `admin.html` — shared admin view for Inani and the lead artist. Login is name `admin`,
  passcode `5555` (fixed, per the original request). Approve/deny donor change requests,
  edit any donor's contributions, and edit the master wish list (add items, set target
  quantities/units so items can be "fully covered," archive items).

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

## Running it

```
python3 -m http.server 8000
```

then open `http://localhost:8000/`.

## Seed data

The wish list was seeded directly from Inani's "Erebe Wish List" message: 13 volunteer
roles and 18 material items. Quantities/targets are left open-ended (no fixed target)
unless an admin sets one, since the original list didn't specify numeric targets for
most things — an item only gets crossed off once an admin gives it a target and
contributions meet it.
