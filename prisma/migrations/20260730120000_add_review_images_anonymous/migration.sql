ALTER TABLE `order_reviews`
  ADD COLUMN `images_json` JSON NULL,
  ADD COLUMN `is_anonymous` BOOLEAN NOT NULL DEFAULT false;
