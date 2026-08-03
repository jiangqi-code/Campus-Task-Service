ALTER TABLE `users`
  ADD COLUMN `birth_date` DATE NULL,
  ADD COLUMN `id_card` VARCHAR(18) NULL;

ALTER TABLE `coupons`
  ADD COLUMN `discount_type` VARCHAR(32) NULL,
  ADD COLUMN `discount_value` DECIMAL(12,2) NULL,
  ADD COLUMN `min_amount` DECIMAL(12,2) NULL,
  ADD COLUMN `validity_days` INT NOT NULL DEFAULT 30;

ALTER TABLE `user_coupons`
  ADD COLUMN `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD COLUMN `used_order_id` INT NULL,
  ADD COLUMN `claimed_at` DATETIME(3) NULL,
  ADD COLUMN `source_event_id` VARCHAR(191) NULL,
  ADD COLUMN `distribution_key` VARCHAR(191) NULL;

-- Existing coupons were already claimed before this workflow existed.
UPDATE `user_coupons` SET `claimed_at` = `received_at` WHERE `claimed_at` IS NULL;

CREATE UNIQUE INDEX `user_coupons_distribution_key_key` ON `user_coupons`(`distribution_key`);
CREATE INDEX `user_coupons_user_id_claimed_at_idx` ON `user_coupons`(`user_id`, `claimed_at`);

CREATE TABLE `coupon_events` (
  `id` VARCHAR(191) NOT NULL,
  `coupon_id` VARCHAR(191) NOT NULL,
  `trigger_type` ENUM('NEW_USER','BIRTHDAY','HOLIDAY') NOT NULL,
  `start_date` DATETIME(3) NULL,
  `end_date` DATETIME(3) NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_by` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `coupon_events_trigger_type_is_active_start_date_end_date_idx`(`trigger_type`, `is_active`, `start_date`, `end_date`),
  INDEX `coupon_events_coupon_id_idx`(`coupon_id`),
  CONSTRAINT `coupon_events_coupon_id_fkey` FOREIGN KEY (`coupon_id`) REFERENCES `coupons`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `coupon_events_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
