-- =============================================================================
-- SmartCanteen — Migration 004: Seed Data
-- Default 15 canteen menu items matching the existing frontend seed.
-- Prices stored as INTEGER paise (1 INR = 100 paise).
-- =============================================================================

INSERT INTO public.menu_items
  (name, description, category, image_url, price_paise, prep_time_mins, available, active)
VALUES
  -- Breakfast
  ('Masala Dosa',
   'Crisp rice crepe, spiced potato, coconut chutney & sambar',
   'Breakfast', '/images/masala-dosa.jpg', 6000, 12, TRUE, TRUE),

  ('Idli Sambar',
   'Three steamed idlis with piping-hot sambar',
   'Breakfast', '/images/idli-sambar.jpg', 4000, 6, TRUE, TRUE),

  ('Aloo Paratha',
   'Stuffed flatbread with butter, curd and pickle',
   'Breakfast', '/images/aloo-paratha.jpg', 5000, 10, TRUE, TRUE),

  -- Lunch
  ('Veg Thali',
   'Dal, two sabzis, rice, rotis, salad and sweet',
   'Lunch', '/images/veg-thali.jpg', 11000, 15, TRUE, TRUE),

  ('Paneer Butter Masala',
   'Creamy tomato gravy with soft paneer, served with 2 rotis',
   'Lunch', '/images/paneer-butter-masala.jpg', 12000, 15, TRUE, TRUE),

  ('Veg Biryani',
   'Fragrant basmati layered with vegetables, with raita',
   'Lunch', '/images/veg-biryani.jpg', 10000, 18, TRUE, TRUE),

  ('Chole Bhature',
   'Spiced chickpea curry with fluffy fried bhature',
   'Lunch', '/images/chole-bhature.jpg', 8000, 14, FALSE, TRUE),  -- seeded unavailable

  -- Snacks
  ('Veg Puff',
   'Flaky pastry filled with spiced mixed vegetables',
   'Snacks', '/images/veg-puff.jpg', 2500, 5, TRUE, TRUE),

  ('Samosa (2 pcs)',
   'Golden, crunchy and served with tamarind chutney',
   'Snacks', '/images/samosa.jpg', 3000, 5, TRUE, TRUE),

  ('Veg Sandwich',
   'Grilled with cucumber, tomato, potato and green chutney',
   'Snacks', '/images/veg-sandwich.jpg', 4500, 7, TRUE, TRUE),

  -- Beverages
  ('Masala Chai',
   'Strong tea brewed with ginger and cardamom',
   'Beverages', '/images/masala-chai.jpg', 1500, 3, TRUE, TRUE),

  ('Cold Coffee',
   'Thick, chilled and lightly sweetened',
   'Beverages', '/images/cold-coffee.jpg', 5000, 4, TRUE, TRUE),

  ('Fresh Lime Soda',
   'Sweet, salted or mixed — your call',
   'Beverages', '/images/fresh-lime-soda.jpg', 3000, 3, TRUE, TRUE),

  -- Desserts
  ('Gulab Jamun (2 pcs)',
   'Warm milk-solid dumplings soaked in rose sugar syrup',
   'Desserts', '/images/gulab-jamun.jpg', 3500, 2, TRUE, TRUE),

  ('Chocolate Brownie',
   'Rich, fudgy baked chocolate square',
   'Desserts', '/images/chocolate-brownie.jpg', 5500, 2, TRUE, TRUE)

ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Enable Realtime for these tables in Supabase
-- (Run this manually in Supabase SQL editor or via supabase CLI)
-- ---------------------------------------------------------------------------
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.menu_items;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.order_items;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.app_settings;
