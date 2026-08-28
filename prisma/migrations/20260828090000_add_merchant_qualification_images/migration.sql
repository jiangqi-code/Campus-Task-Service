-- Store the business license image submitted alongside a merchant application.
ALTER TABLE `merchants`
  ADD COLUMN `business_license_image` VARCHAR(500) NULL;
