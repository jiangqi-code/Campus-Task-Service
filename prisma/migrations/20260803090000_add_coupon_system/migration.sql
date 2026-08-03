CREATE TABLE `coupons` (
  `id` VARCHAR(191) NOT NULL, `name` VARCHAR(191) NOT NULL, `code` VARCHAR(64) NOT NULL,
  `type` ENUM('DISCOUNT', 'CASH') NOT NULL, `value` DECIMAL(12,2) NOT NULL,
  `min_order_amount` DECIMAL(12,2) NOT NULL DEFAULT 0, `max_discount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `usage_limit` INTEGER NOT NULL DEFAULT 1, `total_limit` INTEGER NOT NULL DEFAULT 0,
  `received_count` INTEGER NOT NULL DEFAULT 0, `used_count` INTEGER NOT NULL DEFAULT 0,
  `start_date` DATETIME(3) NOT NULL, `end_date` DATETIME(3) NOT NULL,
  `status` ENUM('ACTIVE', 'EXPIRED', 'DISABLED') NOT NULL DEFAULT 'ACTIVE', `created_by` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `coupons_code_key`(`code`), INDEX `coupons_status_start_date_end_date_idx`(`status`, `start_date`, `end_date`),
  INDEX `coupons_created_by_idx`(`created_by`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `user_coupons` (
  `id` VARCHAR(191) NOT NULL, `user_id` INTEGER NOT NULL, `coupon_id` VARCHAR(191) NOT NULL, `order_id` INTEGER NULL,
  `status` ENUM('UNUSED', 'USED', 'EXPIRED') NOT NULL DEFAULT 'UNUSED',
  `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `used_at` DATETIME(3) NULL, `expired_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `user_coupons_order_id_key`(`order_id`), INDEX `user_coupons_user_id_status_expired_at_idx`(`user_id`, `status`, `expired_at`),
  INDEX `user_coupons_coupon_id_status_idx`(`coupon_id`, `status`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `coupon_logs` (
  `id` VARCHAR(191) NOT NULL, `user_id` INTEGER NOT NULL, `coupon_id` VARCHAR(191) NOT NULL,
  `action` ENUM('RECEIVE', 'USE', 'EXPIRE', 'ADMIN_GIVE') NOT NULL, `detail` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `coupon_logs_user_id_created_at_idx`(`user_id`, `created_at`), INDEX `coupon_logs_coupon_id_action_idx`(`coupon_id`, `action`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `tasks` ADD COLUMN `original_amount` DECIMAL(12,2) NULL, ADD COLUMN `discount_amount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN `user_coupon_id` VARCHAR(191) NULL, ADD UNIQUE INDEX `tasks_user_coupon_id_key`(`user_coupon_id`);
ALTER TABLE `coupons` ADD CONSTRAINT `coupons_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `user_coupons` ADD CONSTRAINT `user_coupons_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `user_coupons` ADD CONSTRAINT `user_coupons_coupon_id_fkey` FOREIGN KEY (`coupon_id`) REFERENCES `coupons`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `user_coupons` ADD CONSTRAINT `user_coupons_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_user_coupon_id_fkey` FOREIGN KEY (`user_coupon_id`) REFERENCES `user_coupons`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `coupon_logs` ADD CONSTRAINT `coupon_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `coupon_logs` ADD CONSTRAINT `coupon_logs_coupon_id_fkey` FOREIGN KEY (`coupon_id`) REFERENCES `coupons`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
