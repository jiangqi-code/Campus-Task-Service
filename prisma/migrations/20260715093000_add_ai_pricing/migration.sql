CREATE TABLE `pricing_log` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_id` INT NOT NULL,
  `task_id` INT NULL,
  `distance_km` DECIMAL(10, 3) NULL,
  `time_slot` VARCHAR(32) NOT NULL,
  `weather` VARCHAR(32) NULL,
  `urgency` INT NOT NULL DEFAULT 0,
  `deal_price` DECIMAL(12, 2) NULL,
  `accept_latency_seconds` INT NULL,
  `ai_enabled` BOOLEAN NOT NULL DEFAULT false,
  `pricing_model_version` INT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `pricing_log_order_id_key`(`order_id`),
  INDEX `pricing_log_created_at_idx`(`created_at`),
  INDEX `pricing_log_time_slot_idx`(`time_slot`),
  INDEX `pricing_log_weather_idx`(`weather`),
  PRIMARY KEY (`id`),
  CONSTRAINT `pricing_log_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `pricing_recommendations` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `model_version` INT NOT NULL,
  `base_fee` DECIMAL(12, 2) NOT NULL,
  `distance_unit_price` DECIMAL(12, 4) NOT NULL,
  `time_coeff_json` JSON NULL,
  `weather_coeff_json` JSON NULL,
  `sample_size` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `pricing_recommendations_model_version_key`(`model_version`),
  INDEX `pricing_recommendations_created_at_idx`(`created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `system_config` (`key`, `value`) VALUES
  ('ai_pricing_enabled', 'false'),
  ('pricing_model_version', '0');
