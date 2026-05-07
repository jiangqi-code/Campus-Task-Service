-- AlterTable
ALTER TABLE `tasks`
    MODIFY `status` ENUM('PENDING', 'SCHEDULED', 'ACCEPTED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING';

SET @scheduled_time_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tasks'
    AND COLUMN_NAME = 'scheduled_time'
);

SET @scheduled_time_stmt := IF(
  @scheduled_time_exists = 0,
  'ALTER TABLE `tasks` ADD COLUMN `scheduled_time` DATETIME(3) NULL;',
  'SELECT ''OK: tasks.scheduled_time already exists'';'
);

PREPARE scheduled_time_stmt FROM @scheduled_time_stmt;
EXECUTE scheduled_time_stmt;
DEALLOCATE PREPARE scheduled_time_stmt;
