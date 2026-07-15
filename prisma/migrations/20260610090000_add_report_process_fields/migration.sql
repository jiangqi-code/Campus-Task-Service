-- AlterTable
ALTER TABLE `reports`
    ADD COLUMN `status` ENUM('PENDING', 'PROCESSED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    ADD COLUMN `process_result` TEXT NULL,
    ADD COLUMN `process_action` ENUM('WARN', 'DEDUCT_SCORE', 'FREEZE') NULL,
    ADD COLUMN `processed_at` DATETIME(3) NULL,
    ADD COLUMN `processed_by` INTEGER NULL;

-- CreateIndex
CREATE INDEX `reports_status_idx` ON `reports`(`status`);

-- CreateIndex
CREATE INDEX `reports_processed_by_idx` ON `reports`(`processed_by`);

-- CreateIndex
CREATE INDEX `reports_processed_at_idx` ON `reports`(`processed_at`);

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_processed_by_fkey` FOREIGN KEY (`processed_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
