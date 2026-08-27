-- CreateTable
CREATE TABLE `merchants` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_id` INTEGER NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `description` TEXT NULL,
    `logo` VARCHAR(500) NULL,
    `address` VARCHAR(160) NOT NULL,
    `phone` VARCHAR(30) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'DISABLED') NOT NULL DEFAULT 'PENDING',
    `audit_note` VARCHAR(300) NULL,
    `commission_rate` DECIMAL(5, 4) NOT NULL DEFAULT 0.1000,
    `is_open` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `merchants_owner_id_status_idx`(`owner_id`, `status`),
    INDEX `merchants_status_is_open_created_at_idx`(`status`, `is_open`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `menu_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `merchant_id` INTEGER NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(500) NULL,
    `image` VARCHAR(500) NULL,
    `price` DECIMAL(12, 2) NOT NULL,
    `stock` INTEGER NOT NULL DEFAULT -1,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `menu_items_merchant_id_is_active_sort_order_idx`(`merchant_id`, `is_active`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `food_orders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `merchant_id` INTEGER NOT NULL,
    `runner_id` INTEGER NULL,
    `status` ENUM('PENDING_PAYMENT', 'PAID', 'ACCEPTED', 'PICKED', 'DELIVERING', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING_PAYMENT',
    `delivery_address` VARCHAR(180) NOT NULL,
    `delivery_lat` DECIMAL(10, 6) NULL,
    `delivery_lng` DECIMAL(10, 6) NULL,
    `contact_phone` VARCHAR(30) NULL,
    `remark` VARCHAR(500) NULL,
    `item_amount` DECIMAL(12, 2) NOT NULL,
    `delivery_fee` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `commission_rate` DECIMAL(5, 4) NOT NULL,
    `commission_amount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `total_amount` DECIMAL(12, 2) NOT NULL,
    `payment_at` DATETIME(3) NULL,
    `accept_time` DATETIME(3) NULL,
    `pickup_time` DATETIME(3) NULL,
    `delivery_start_time` DATETIME(3) NULL,
    `complete_time` DATETIME(3) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `cancel_reason` VARCHAR(300) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `food_orders_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `food_orders_merchant_id_status_created_at_idx`(`merchant_id`, `status`, `created_at`),
    INDEX `food_orders_runner_id_status_created_at_idx`(`runner_id`, `status`, `created_at`),
    INDEX `food_orders_status_created_at_idx`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `food_order_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `food_order_id` INTEGER NOT NULL,
    `menu_item_id` INTEGER NULL,
    `item_name` VARCHAR(100) NOT NULL,
    `unit_price` DECIMAL(12, 2) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `food_order_items_food_order_id_idx`(`food_order_id`),
    INDEX `food_order_items_menu_item_id_idx`(`menu_item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `merchants` ADD CONSTRAINT `merchants_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `menu_items` ADD CONSTRAINT `menu_items_merchant_id_fkey` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `food_orders` ADD CONSTRAINT `food_orders_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `food_orders` ADD CONSTRAINT `food_orders_merchant_id_fkey` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `food_orders` ADD CONSTRAINT `food_orders_runner_id_fkey` FOREIGN KEY (`runner_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `food_order_items` ADD CONSTRAINT `food_order_items_food_order_id_fkey` FOREIGN KEY (`food_order_id`) REFERENCES `food_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `food_order_items` ADD CONSTRAINT `food_order_items_menu_item_id_fkey` FOREIGN KEY (`menu_item_id`) REFERENCES `menu_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
