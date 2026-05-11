-- CreateTable
CREATE TABLE IF NOT EXISTS `chat_message` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `order_id` INTEGER NOT NULL,
  `from_user_id` INTEGER NOT NULL,
  `to_user_id` INTEGER NOT NULL,
  `message` TEXT NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `chat_message_order_id_created_at_idx` (`order_id`, `created_at`),
  INDEX `chat_message_from_user_id_idx` (`from_user_id`),
  INDEX `chat_message_to_user_id_idx` (`to_user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
