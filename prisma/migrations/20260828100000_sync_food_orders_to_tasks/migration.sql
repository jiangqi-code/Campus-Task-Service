-- 每笔食堂订单在餐品备好时创建一个标准任务，供跑腿员从统一任务大厅接单。
ALTER TABLE `tasks`
  ADD COLUMN `food_order_id` INTEGER NULL;

CREATE UNIQUE INDEX `tasks_food_order_id_key` ON `tasks`(`food_order_id`);

ALTER TABLE `tasks`
  ADD CONSTRAINT `tasks_food_order_id_fkey`
  FOREIGN KEY (`food_order_id`) REFERENCES `food_orders`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
