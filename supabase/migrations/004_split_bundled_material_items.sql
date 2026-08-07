-- Split bundled material items into individually-trackable records. Items like "PPE"
-- or "Blades" originally lumped several distinct physical things into one row, which
-- made the running totals useless for inventory purposes (e.g. "12 PPE committed"
-- doesn't tell you whether you still have zero gloves). Confirmed zero contributions
-- existed on any of these before running this, so it's a clean replace.

delete from wishlist_items where category = 'material' and name in (
  'Trucks and Trailers', 'Power Source', 'PPE',
  'Basic Carpentry Hand Tools & Sundries', '3" and 2" Star Drive Screws', 'Blades'
);

-- renumber the surviving material items into a clean sequence with gaps for the new ones
update wishlist_items set sort_order = 10 where category='material' and name = 'Funding for Local Artists';
update wishlist_items set sort_order = 40 where category='material' and name = 'Fuel';
update wishlist_items set sort_order = 50 where category='material' and name = 'Salvaged and Reclaimed Material';
update wishlist_items set sort_order = 80 where category='material' and name = 'Refreshments for Crew';
update wishlist_items set sort_order = 130 where category='material' and name = 'Cordless Power Tools';
update wishlist_items set sort_order = 180 where category='material' and name = 'Air Compressor';
update wishlist_items set sort_order = 190 where category='material' and name = 'Plywood';
update wishlist_items set sort_order = 200 where category='material' and name = 'Dimensional Lumber';
update wishlist_items set sort_order = 210 where category='material' and name = 'SDS (Heavy Duty Structural Fasteners)';
update wishlist_items set sort_order = 240 where category='material' and name = 'Ratchet Straps';
update wishlist_items set sort_order = 250 where category='material' and name = 'Framing Nails for Nail Gun';
update wishlist_items set sort_order = 260 where category='material' and name = 'Sheathing Nails for Nail Gun';

insert into wishlist_items (category, name, description, sort_order) values
('material', 'Trucks', $$For build and exodus$$, 20),
('material', 'Trailers', $$For build and exodus$$, 30),
('material', 'Generator', $$One possible power source for the build/temple — see also Solar Panels$$, 60),
('material', 'Solar Panels', $$One possible power source for the build/temple — see also Generator$$, 70),
('material', 'Gloves', $$PPE$$, 90),
('material', 'Safety Glasses', $$PPE$$, 100),
('material', 'Dust Masks', $$PPE$$, 110),
('material', 'Hard Hats', $$PPE — in case we do lifts$$, 120),
('material', 'Hammers', $$Basic carpentry hand tool$$, 140),
('material', 'Speed Squares', $$Basic carpentry hand tool$$, 150),
('material', 'Tape Measures', $$Basic carpentry hand tool$$, 160),
('material', 'Pencils', $$Basic carpentry sundry$$, 170),
('material', '3" Star Drive Screws', $$Already in the project budget. We will not accept Phillips screws, even for free!$$, 220),
('material', '2" Star Drive Screws', $$Already in the project budget. We will not accept Phillips screws, even for free!$$, 230),
('material', 'Circular Saw Blades', $$Already in the project budget$$, 270),
('material', 'Sawzall Blades', $$Already in the project budget$$, 280),
('material', 'Utility/Razor Knife Blades', $$Already in the project budget$$, 290),
('material', 'Jig Saw Blades', $$Already in the project budget$$, 300);
