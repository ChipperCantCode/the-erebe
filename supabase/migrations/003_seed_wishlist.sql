-- Seed data taken directly from Inani's "Erebe Wish List" Facebook message.
-- Quantities/targets are intentionally left null (open-ended) since the source
-- message didn't specify numeric targets for most items; set target_quantity/unit
-- from the admin panel to turn on the "fully covered" crossed-off behavior for an item.

insert into wishlist_items (category, name, description, sort_order) values
('volunteer', 'Project Manager', $$• Identify the crucial aspects of the project versus aspirational
• Set dated targets to arrive at completion
• Monitor progress and crew needs
• Alert when aspirational targets are threatening crucial ones
• Schedule all-hands and leads meetings for check-ins and information dissemination$$, 10),

('volunteer', 'Volunteer Coordinator', $$• Seek volunteer recruits from the community
• Schedule volunteers to shifts
• Alert lead artist and build leads as to who they can expect
• Facilitate communication between leads and their volunteers$$, 20),

('volunteer', 'CoLab Trusted Comptroller', $$Helps manage funds.
• Hold grant and donated fund gates
• Dispense funds for purchases
• Dispense funds for discretionary needs like hardware store runs
• Keep accounting in a transparent public ledger
• Communicate with project manager and vested CoLab financial arms to assess expenditure vs progress regularly for goal calibration$$, 30),

('volunteer', 'Drivers with Trucks and Trailers', $$• Transport materials to CoLab shop
• Transport materials and prefabs to build site
• Post-event transport of components to Borrego Springs, where it will be stored (1hr 42min drive per MapQuest)$$, 40),

('volunteer', 'Material Scavenger', $$• Identify sources of reclaimed, scrap, or salvageable materials
• Assess stockpiles for project viability
• Prepare those materials for use (e.g. de-nailing 2x4 from demo)
• Deliver the materials to where they can be used$$, 50),

('volunteer', 'Drafters', $$Adepts with drafting programs like SketchUp, CAD, etc. to help lighten the build plan generation load and make alterations in the field that we can print or share as needed$$, 60),

('volunteer', 'Carpenters of All Skill Levels', $$• Lead carpenters with conventional framing experience
• Carpenters who work in wood as an art form
• Novices who have basic tool experience
• Brand new green beans who want to learn$$, 70),

('volunteer', 'Safety Lead', $$Review the Erebe Safety Plan, and make sure crews are mostly adhering to it$$, 80),

('volunteer', 'Lighting Designer/Engineer', $$• Work with lead artist to develop a low-cost but effective lighting plan
• Install, maintain, and direct temple lights$$, 90),

('volunteer', 'Sound Designer', $$Artist with low-wattage gear who would like to provide ambient aural environments in the Erebe chambers$$, 100),

('volunteer', 'Electrician', $$• Run Romex in aesthetically discreet locations
• Attach junction boxes
• Install 110 electrical outlets
• Assist lighting designer in powering lights
• Assure safe connection and balanced load from power source$$, 110),

('volunteer', 'Large-Scale Art Production Experience', $$Anyone who has experience with any aspect of producing large scale art.
• Work with lead artist and project manager to share collective wisdom
• Help point out logistical blind spots in planning and known solutions$$, 120),

('volunteer', 'Artists — Worlds Within Erebe', $$The Erebe has many opportunities for local artists to add their own personal flair.
• Create complementary or contrasting aesthetics in hidden chambers and passages
• Create complementary or contrasting aesthetic themes in upper stories of the structure
• Design and lead the ornamented construction of the central altar
• Design and lead an ornamented chandelier above the altar in collaboration with altar designer and lighting designer
• Embellish the 19 mini shrines in the Erebe walls with trim details
• Design aesthetically interesting and economical benches or other seating$$, 130),

('material', 'Funding for Local Artists', $$Funding for local artists to create their worlds within the project$$, 10),
('material', 'Trucks and Trailers', $$For build and exodus$$, 20),
('material', 'Fuel', $$Fuel for build/exodus vehicles$$, 30),
('material', 'Salvaged and Reclaimed Material', $$To stretch grant and donations$$, 40),
('material', 'Power Source', $$Generator, solar panels, YOUtopia-provided cord...$$, 50),
('material', 'Refreshments for Crew', $$Anyone want to feed us?$$, 60),
('material', 'PPE', $$Gloves, safety glasses, dust masks, hard hats (if we decide to do lifts)$$, 70),
('material', 'Cordless Power Tools', $$For any fearless souls willing to loan them$$, 80),
('material', 'Basic Carpentry Hand Tools & Sundries', $$Hammers, speed squares, tape measures, pencils, etc.$$, 90),
('material', 'Air Compressor', $$Loan. Inani has one, but it's heavy and would be nice not to have to bring it$$, 100),
('material', 'Plywood', $$Already in the project budget — donating/loaning this helps stretch the grant further so we don't have to buy it$$, 110),
('material', 'Dimensional Lumber', $$Already in the project budget — helps stretch the grant further so we don't have to buy it$$, 120),
('material', 'SDS (Heavy Duty Structural Fasteners)', $$Or other heavy duty structural fasteners. Already in the project budget$$, 130),
('material', '3" and 2" Star Drive Screws', $$Already in the project budget. We will not accept Phillips screws, even for free!$$, 140),
('material', 'Ratchet Straps', $$You can never have too many. Already in the project budget$$, 150),
('material', 'Framing Nails for Nail Gun', $$Already in the project budget$$, 160),
('material', 'Sheathing Nails for Nail Gun', $$Already in the project budget$$, 170),
('material', 'Blades', $$Circular saw, sawzall, razor knife, jig saw. Already in the project budget$$, 180);
