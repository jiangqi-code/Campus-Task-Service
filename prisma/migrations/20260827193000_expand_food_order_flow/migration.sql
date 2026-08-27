-- Expand the existing food-order module without invalidating historical orders.
ALTER TABLE `food_orders`
  MODIFY `status` ENUM('PENDING_PAYMENT', 'PAID', 'MERCHANT_ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'ACCEPTED', 'PICKED', 'DELIVERING', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'REFUNDING', 'REFUNDED') NOT NULL DEFAULT 'PENDING_PAYMENT',
  ADD COLUMN `order_no` VARCHAR(40) NULL,
  ADD COLUMN `discount_amount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN `payable_amount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN `merchant_income` DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN `runner_income` DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN `platform_income` DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN `pickup_code` VARCHAR(12) NULL,
  ADD COLUMN `payment_expire_at` DATETIME(3) NULL,
  ADD COLUMN `delivered_at` DATETIME(3) NULL,
  ADD UNIQUE INDEX `food_orders_order_no_key`(`order_no`),
  ADD INDEX `food_orders_order_no_idx`(`order_no`);

ALTER TABLE `merchants`
  ADD COLUMN `cover_image` VARCHAR(500) NULL,
  ADD COLUMN `announcement` VARCHAR(500) NULL,
  ADD COLUMN `min_order_amount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN `prepare_minutes` INTEGER NOT NULL DEFAULT 15;

CREATE TABLE `food_categories` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `merchant_id` INTEGER NOT NULL,
  `name` VARCHAR(60) NOT NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `food_categories_merchant_id_name_key`(`merchant_id`, `name`),
  INDEX `food_categories_merchant_id_is_active_sort_order_idx`(`merchant_id`, `is_active`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `menu_items`
  ADD COLUMN `category_id` INTEGER NULL,
  ADD COLUMN `original_price` DECIMAL(12,2) NULL,
  ADD INDEX `menu_items_category_id_idx`(`category_id`);

CREATE TABLE `food_order_timelines` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `food_order_id` INTEGER NOT NULL,
  `from_status` ENUM('PENDING_PAYMENT', 'PAID', 'MERCHANT_ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'ACCEPTED', 'PICKED', 'DELIVERING', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'REFUNDING', 'REFUNDED') NULL,
  `to_status` ENUM('PENDING_PAYMENT', 'PAID', 'MERCHANT_ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'ACCEPTED', 'PICKED', 'DELIVERING', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'REFUNDING', 'REFUNDED') NOT NULL,
  `actor_id` INTEGER NULL,
  `actor_role` VARCHAR(24) NULL,
  `note` VARCHAR(300) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `food_order_timelines_food_order_id_created_at_idx`(`food_order_id`, `created_at`),
  INDEX `food_order_timelines_actor_id_idx`(`actor_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `wallet_logs`
  ADD COLUMN `food_order_id` INTEGER NULL,
  ADD INDEX `wallet_logs_food_order_id_idx`(`food_order_id`);

ALTER TABLE `earnings`
  ADD COLUMN `food_order_id` INTEGER NULL,
  ADD INDEX `earnings_food_order_id_idx`(`food_order_id`);

ALTER TABLE `food_categories` ADD CONSTRAINT `food_categories_merchant_id_fkey`
  FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `menu_items` ADD CONSTRAINT `menu_items_category_id_fkey`
  FOREIGN KEY (`category_id`) REFERENCES `food_categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `food_order_timelines` ADD CONSTRAINT `food_order_timelines_food_order_id_fkey`
  FOREIGN KEY (`food_order_id`) REFERENCES `food_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `food_order_timelines` ADD CONSTRAINT `food_order_timelines_actor_id_fkey`
  FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `wallet_logs` ADD CONSTRAINT `wallet_logs_food_order_id_fkey`
  FOREIGN KEY (`food_order_id`) REFERENCES `food_orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `earnings` ADD CONSTRAINT `earnings_food_order_id_fkey`
  FOREIGN KEY (`food_order_id`) REFERENCES `food_orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
