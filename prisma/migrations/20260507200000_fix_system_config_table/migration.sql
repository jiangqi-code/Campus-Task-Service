-- Ensure system_config table exists (keep data)
SET @has_system_configs := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'system_configs'
);

SET @has_system_config := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'system_config'
);

SET @rename_stmt := IF(
  @has_system_configs = 1 AND @has_system_config = 0,
  'RENAME TABLE `system_configs` TO `system_config`;',
  'SELECT ''OK: no rename needed'';'
);

PREPARE rename_stmt FROM @rename_stmt;
EXECUTE rename_stmt;
DEALLOCATE PREPARE rename_stmt;

CREATE TABLE IF NOT EXISTS `system_config` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `key` VARCHAR(191) NOT NULL,
  `value` TEXT NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `system_config_key_key` (`key`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
