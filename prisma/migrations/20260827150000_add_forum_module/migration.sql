-- CreateTable
CREATE TABLE `forum_categories` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(40) NOT NULL,
    `icon` VARCHAR(16) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `forum_categories_code_key`(`code`),
    INDEX `forum_categories_is_active_sort_order_idx`(`is_active`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `forum_posts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `author_id` INTEGER NOT NULL,
    `category_id` INTEGER NOT NULL,
    `title` VARCHAR(100) NOT NULL,
    `content` TEXT NOT NULL,
    `images_json` JSON NULL,
    `location_name` VARCHAR(120) NULL,
    `latitude` DECIMAL(10, 6) NULL,
    `longitude` DECIMAL(10, 6) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'HIDDEN') NOT NULL DEFAULT 'PENDING',
    `audit_note` VARCHAR(300) NULL,
    `audited_by` INTEGER NULL,
    `audited_at` DATETIME(3) NULL,
    `is_pinned` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `forum_posts_author_id_created_at_idx`(`author_id`, `created_at`),
    INDEX `forum_posts_category_id_status_created_at_idx`(`category_id`, `status`, `created_at`),
    INDEX `forum_posts_status_is_pinned_created_at_idx`(`status`, `is_pinned`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `forum_comments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `post_id` INTEGER NOT NULL,
    `author_id` INTEGER NOT NULL,
    `content` TEXT NOT NULL,
    `status` ENUM('APPROVED', 'HIDDEN') NOT NULL DEFAULT 'APPROVED',
    `audited_by` INTEGER NULL,
    `audited_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `forum_comments_post_id_status_created_at_idx`(`post_id`, `status`, `created_at`),
    INDEX `forum_comments_author_id_created_at_idx`(`author_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `forum_post_likes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `post_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `forum_post_likes_post_id_user_id_key`(`post_id`, `user_id`),
    INDEX `forum_post_likes_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `forum_favorites` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `post_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `forum_favorites_post_id_user_id_key`(`post_id`, `user_id`),
    INDEX `forum_favorites_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Seed the five system categories. Existing customizations are preserved on re-run.
INSERT INTO `forum_categories` (`code`, `name`, `icon`, `sort_order`, `is_active`) VALUES
  ('LOST_FOUND', '失物招领', '🔎', 10, true),
  ('SECOND_HAND', '二手交易', '🛍️', 20, true),
  ('CONFESSION', '表白墙', '💌', 30, true),
  ('NOTICE', '校园通知', '📢', 40, true),
  ('RIDE_SHARE', '拼车', '🚗', 50, true)
ON DUPLICATE KEY UPDATE `code` = VALUES(`code`);

-- AddForeignKey
ALTER TABLE `forum_posts` ADD CONSTRAINT `forum_posts_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `forum_posts` ADD CONSTRAINT `forum_posts_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `forum_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `forum_posts` ADD CONSTRAINT `forum_posts_audited_by_fkey` FOREIGN KEY (`audited_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `forum_comments` ADD CONSTRAINT `forum_comments_post_id_fkey` FOREIGN KEY (`post_id`) REFERENCES `forum_posts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `forum_comments` ADD CONSTRAINT `forum_comments_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `forum_comments` ADD CONSTRAINT `forum_comments_audited_by_fkey` FOREIGN KEY (`audited_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `forum_post_likes` ADD CONSTRAINT `forum_post_likes_post_id_fkey` FOREIGN KEY (`post_id`) REFERENCES `forum_posts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `forum_post_likes` ADD CONSTRAINT `forum_post_likes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `forum_favorites` ADD CONSTRAINT `forum_favorites_post_id_fkey` FOREIGN KEY (`post_id`) REFERENCES `forum_posts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `forum_favorites` ADD CONSTRAINT `forum_favorites_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
