-- AlterTable
ALTER TABLE `user_auths`
    ADD COLUMN `student_id` VARCHAR(191) NULL,
    ADD COLUMN `phone` VARCHAR(191) NULL,
    ADD COLUMN `id_card` VARCHAR(191) NULL,
    ADD COLUMN `dormitory` VARCHAR(191) NULL,
    ADD COLUMN `reason` TEXT NULL,
    MODIFY `audit_status` VARCHAR(191) NOT NULL DEFAULT 'PENDING';

-- Backfill
UPDATE `user_auths` SET `audit_status` = 'PENDING' WHERE `audit_status` IS NULL OR `audit_status` = '';

-- CreateIndex
CREATE INDEX `user_auths_audit_status_idx` ON `user_auths`(`audit_status`);

