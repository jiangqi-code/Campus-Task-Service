ALTER TABLE `orders`
  ADD COLUMN `delivery_start_time` DATETIME NULL AFTER `pickup_time`;
