-- CreateTable
CREATE TABLE IF NOT EXISTS `error_log` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `error_message` TEXT NOT NULL,
  `stack` TEXT NULL,
  `url` TEXT NOT NULL,
  `method` VARCHAR(16) NOT NULL,
  `ip` VARCHAR(45) NOT NULL,
  `user_id` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `error_log_user_id_idx` (`user_id`),
  INDEX `error_log_created_at_idx` (`created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

