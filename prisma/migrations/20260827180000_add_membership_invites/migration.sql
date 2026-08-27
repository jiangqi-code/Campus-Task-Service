-- AlterTable
ALTER TABLE `users`
  ADD COLUMN `member_level` ENUM('BRONZE', 'SILVER', 'GOLD', 'DIAMOND') NOT NULL DEFAULT 'BRONZE',
  ADD COLUMN `invite_code` VARCHAR(16) NULL,
  ADD COLUMN `invited_by` INTEGER NULL;

-- CreateIndex
CREATE UNIQUE INDEX `users_invite_code_key` ON `users`(`invite_code`);
CREATE INDEX `users_invited_by_idx` ON `users`(`invited_by`);

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_invited_by_fkey` FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
