-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `student_id` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `nickname` VARCHAR(191) NULL,
    `avatar` VARCHAR(191) NULL,
    `role` ENUM('USER', 'RUNNER', 'ADMIN') NOT NULL DEFAULT 'USER',
    `status` INTEGER NOT NULL DEFAULT 1,
    `credit_score` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `users_student_id_key`(`student_id`),
    UNIQUE INDEX `users_phone_key`(`phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_auths` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `real_name` VARCHAR(191) NOT NULL,
    `card_image_url` VARCHAR(191) NOT NULL,
    `audit_status` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `user_auths_user_id_key`(`user_id`),
    INDEX `user_auths_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_wallets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `balance` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `frozen` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `user_wallets_user_id_key`(`user_id`),
    INDEX `user_wallets_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wallet_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `wallet_id` INTEGER NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `ref_order_id` INTEGER NULL,
    `before_balance` DECIMAL(12, 2) NOT NULL,
    `after_balance` DECIMAL(12, 2) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `wallet_logs_wallet_id_idx`(`wallet_id`),
    INDEX `wallet_logs_ref_order_id_idx`(`ref_order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tasks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `publisher_id` INTEGER NOT NULL,
    `pickup_address` VARCHAR(191) NOT NULL,
    `pickup_lat` DECIMAL(10, 6) NULL,
    `pickup_lng` DECIMAL(10, 6) NULL,
    `delivery_address` VARCHAR(191) NOT NULL,
    `delivery_lat` DECIMAL(10, 6) NULL,
    `delivery_lng` DECIMAL(10, 6) NULL,
    `type` VARCHAR(191) NOT NULL,
    `urgency` INTEGER NOT NULL DEFAULT 0,
    `remark` TEXT NULL,
    `images_json` JSON NULL,
    `fee_total` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `tip` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `status` ENUM('PENDING', 'ACCEPTED', 'COMPLETED') NOT NULL DEFAULT 'PENDING',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tasks_publisher_id_idx`(`publisher_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `orders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `task_id` INTEGER NOT NULL,
    `taker_id` INTEGER NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'PICKED', 'DELIVERING', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `accept_time` DATETIME(3) NULL,
    `pickup_time` DATETIME(3) NULL,
    `delivery_time` DATETIME(3) NULL,
    `complete_time` DATETIME(3) NULL,
    `eta_minutes` INTEGER NULL,
    `final_price` DECIMAL(12, 2) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `orders_task_id_idx`(`task_id`),
    INDEX `orders_taker_id_idx`(`taker_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_tracks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_id` INTEGER NOT NULL,
    `pickup_photo_url` VARCHAR(191) NULL,
    `delivery_photo_url` VARCHAR(191) NULL,
    `location_points_json` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `order_tracks_order_id_key`(`order_id`),
    INDEX `order_tracks_order_id_idx`(`order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_reviews` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_id` INTEGER NOT NULL,
    `rating` INTEGER NOT NULL,
    `tags_json` JSON NULL,
    `comment` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `order_reviews_order_id_key`(`order_id`),
    INDEX `order_reviews_order_id_idx`(`order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `earnings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `order_id` INTEGER NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `settled_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `earnings_user_id_idx`(`user_id`),
    INDEX `earnings_order_id_idx`(`order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `withdraws` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `apply_time` DATETIME(3) NULL,
    `audit_time` DATETIME(3) NULL,
    `audit_admin_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `withdraws_user_id_idx`(`user_id`),
    INDEX `withdraws_audit_admin_id_idx`(`audit_admin_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_configs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(191) NOT NULL,
    `value` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `system_configs_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `admin_id` INTEGER NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `target_type` VARCHAR(191) NOT NULL,
    `target_id` INTEGER NULL,
    `detail_json` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `admin_logs_admin_id_idx`(`admin_id`),
    INDEX `admin_logs_target_type_target_id_idx`(`target_type`, `target_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_auths` ADD CONSTRAINT `user_auths_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_wallets` ADD CONSTRAINT `user_wallets_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wallet_logs` ADD CONSTRAINT `wallet_logs_wallet_id_fkey` FOREIGN KEY (`wallet_id`) REFERENCES `user_wallets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wallet_logs` ADD CONSTRAINT `wallet_logs_ref_order_id_fkey` FOREIGN KEY (`ref_order_id`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_publisher_id_fkey` FOREIGN KEY (`publisher_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_taker_id_fkey` FOREIGN KEY (`taker_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_tracks` ADD CONSTRAINT `order_tracks_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_reviews` ADD CONSTRAINT `order_reviews_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `earnings` ADD CONSTRAINT `earnings_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `earnings` ADD CONSTRAINT `earnings_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `withdraws` ADD CONSTRAINT `withdraws_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `withdraws` ADD CONSTRAINT `withdraws_audit_admin_id_fkey` FOREIGN KEY (`audit_admin_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admin_logs` ADD CONSTRAINT `admin_logs_admin_id_fkey` FOREIGN KEY (`admin_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
