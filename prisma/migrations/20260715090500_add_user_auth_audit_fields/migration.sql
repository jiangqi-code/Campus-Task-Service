-- AlterTable
ALTER TABLE `user_auths`
    ADD COLUMN `admin_id` INTEGER NULL,
    ADD COLUMN `processed_at` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `user_auths_admin_id_idx` ON `user_auths`(`admin_id`);

-- AddForeignKey
ALTER TABLE `user_auths`
    ADD CONSTRAINT `user_auths_admin_id_fkey` FOREIGN KEY (`admin_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

