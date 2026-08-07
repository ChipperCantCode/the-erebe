-- Set target quantities/units from the Erebe grant budget (erebebudget.xlsx) and the
-- crew-size assumption (30-person combined build crew), and add donation-category
-- items + material items that appear in the budget but weren't on the wish list yet.

-- 1) Leadership/specialist volunteer roles fill by percentage (one role, can be split
--    among multiple people, or one person can take the whole 100%).
update wishlist_items set target_quantity = 100, unit = '%'
where category = 'volunteer' and name in (
  'Project Manager', 'Volunteer Coordinator', 'CoLab Trusted Comptroller',
  'Safety Lead', 'Lighting Designer/Engineer', 'Sound Designer', 'Electrician'
);

-- 2) General hands-on build crew target: 30 people combined across CoLab + event site.
update wishlist_items set target_quantity = 30, unit = 'people'
where category = 'volunteer' and name = 'Carpenters of All Skill Levels';

-- 3) PPE/tool targets estimated from the 30-person crew assumption (no explicit counts
--    in the budget — these are estimates, flagged as such in the description).
update wishlist_items set target_quantity = 30, unit = 'pairs',
  description = 'PPE. Estimated at 1 per crew member (crew target: 30).'
where category = 'material' and name = 'Gloves';
update wishlist_items set target_quantity = 30, unit = 'pairs',
  description = 'PPE. Estimated at 1 per crew member (crew target: 30).'
where category = 'material' and name = 'Safety Glasses';
update wishlist_items set target_quantity = 30, unit = 'each',
  description = 'PPE. Estimated at 1 per crew member (crew target: 30).'
where category = 'material' and name = 'Dust Masks';
update wishlist_items set target_quantity = 10, unit = 'each',
  description = 'PPE — in case we do lifts. Estimated at a shared pool, not 1-per-person.'
where category = 'material' and name = 'Hard Hats';

update wishlist_items set target_quantity = 10, unit = 'each',
  description = 'Basic carpentry hand tool. Estimated shared-pool count for a 30-person crew, not 1-per-person.'
where category = 'material' and name in ('Hammers', 'Speed Squares', 'Tape Measures');
update wishlist_items set target_quantity = 20, unit = 'each',
  description = 'Basic carpentry sundry. Estimated shared-pool count for a 30-person crew.'
where category = 'material' and name = 'Pencils';

-- 4) Plywood target from the budget doc: floor sheeting (40 sheets) + wall cladding
--    (60 sheets) = 100 sheets of sheathing (plywood OR OSB is fine here), plus spire
--    slatting (20 sheets, must be real plywood, not OSB) = 120 sheets total.
update wishlist_items set target_quantity = 120, unit = 'sheets (4x8)',
  description = 'From the project budget: ~100 sheets for floor/wall sheathing (plywood or OSB both fine) + 20 sheets for spire slatting (must be real plywood, not OSB — see the Star Drive Screws item for how Inani feels about substitutions). Already in the project budget — donating/loaning this helps stretch the grant further.'
where category = 'material' and name = 'Plywood';

update wishlist_items set
  description = 'For 2x4 framing, 4x4 posts, 2x6 floor joists, and spire armature/support. ~$1,350 budgeted if purchased new — already in the project budget, so donating/loaning helps stretch the grant. No piece count set (mixed dimensions/lengths); Inani would rather score salvaged/reclaimed lumber from local demo projects.'
where category = 'material' and name = 'Dimensional Lumber';

update wishlist_items set
  description = 'Fuel for build/exodus vehicles. See also the Transportation Fund (cash toward fuel/rental) if you''d rather donate money than gas.'
where category = 'material' and name = 'Fuel';

-- 5) Donations become their own USD-denominated category, separate from physical materials.
update wishlist_items set category = 'donation', unit = 'USD', description = 'Funding for local artists to create their worlds within the project (see the Artists — Worlds Within Erebe volunteer entry). Stretch goal, not in the formal grant budget.', sort_order = 40
where category = 'material' and name = 'Funding for Local Artists';

insert into wishlist_items (category, name, description, target_quantity, unit, sort_order) values
('donation', 'Erebe Build Fund', 'General, unrestricted cash toward the build — covers anything the grant and in-kind donations don''t. From the project budget (total project cost ~$5,807.73, entirely from the pending grant application as of now — $0 secured from other sources).', null, 'USD', 10),
('donation', 'Sales Tax Fund', 'Sales tax on purchased materials — this specific line can only be covered in cash. From the project budget.', 417.73, 'USD', 20),
('donation', 'Transportation Fund', 'Fuel cost + possible truck rental, if volunteer trucks/trailers aren''t available. From the project budget. Every truck/trailer donated via the Trucks/Trailers items reduces how much of this is needed.', 600, 'USD', 30),
('donation', 'Generator Fuel Fund', 'Fuel for the build-site generator. From the project budget ($200, Power line).', 200, 'USD', 60);

insert into wishlist_items (category, name, description, sort_order) values
('material', 'Drill/Driver Bits', 'Shares a $150 "blades and bits" stipend with the saw blade items — already in the project budget.', 305),
('material', 'Pneumatic Staples', 'Part of the $500 hardware budget (screws, nails, SDS, staples) — already in the project budget.', 310),
('material', 'Contractor Bags', 'Leave No Trace supplies. ~$40 budgeted — already in the project budget.', 320),
('material', 'Romex', 'Electrical wire. Part of the $500 lighting/electrical budget — already in the project budget.', 330),
('material', 'Electrical Outlets (110V)', 'Part of the $500 lighting/electrical budget — already in the project budget.', 340),
('material', 'Junction Boxes', 'Part of the $500 lighting/electrical budget — already in the project budget.', 350),
('material', 'Shop Lights', 'Simple shop lights for temple lighting. Part of the $500 lighting/electrical budget.', 360),
('material', 'Theatre Gels', 'For coloring the shop lights. Part of the $500 lighting/electrical budget.', 370),
('material', '100W Light Bulbs', 'Part of the $500 lighting/electrical budget.', 380),
('material', 'LED Strips', 'Part of the $500 lighting/electrical budget.', 390),
('material', 'Paint, Rollers & Brushes', '~$300 budgeted — already in the project budget.', 400);

update wishlist_items set sort_order = 300 where category='material' and name = 'Jig Saw Blades';
