-- AlterTable
ALTER TABLE `tasks` ADD COLUMN `is_fragile` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `size` VARCHAR(100) NULL,
    ADD COLUMN `weight` VARCHAR(50) NULL;
