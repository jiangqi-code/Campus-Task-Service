ALTER TABLE `food_orders`
  ADD COLUMN `user_coupon_id` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `food_orders_user_coupon_id_key`(`user_coupon_id`);

ALTER TABLE `food_orders` ADD CONSTRAINT `food_orders_user_coupon_id_fkey`
  FOREIGN KEY (`user_coupon_id`) REFERENCES `user_coupons`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
