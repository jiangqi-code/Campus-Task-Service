-- Weekly business hours for food merchants. NULL means follow the manual opening switch only.
ALTER TABLE `merchants`
  ADD COLUMN `business_hours` JSON NULL;
