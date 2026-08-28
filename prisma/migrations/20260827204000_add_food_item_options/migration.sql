-- Merchant-configured menu options and the immutable option snapshot for each order item.
ALTER TABLE `menu_items`
  ADD COLUMN `option_groups` JSON NULL;

ALTER TABLE `food_order_items`
  ADD COLUMN `selected_options` JSON NULL;
