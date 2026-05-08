import cron, { type ScheduledTask } from "node-cron";
import { PrismaClient, TaskStatus } from "@prisma/client";

const prisma = new PrismaClient();

export class ScheduledTaskService {
  private task: ScheduledTask | null = null;
  private running = false;

  start() {
    if (this.task) return;

    this.task = cron.schedule("* * * * *", () => {
      this.runOnce().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[scheduledTask.cron] runOnce failed:", message);
      });
    });

    this.task.start();
  }

  stop() {
    this.task?.stop();
    this.task = null;
  }

  private async runOnce() {
    if (this.running) return;
    this.running = true;
    try {
      await this.processDueTasks();
    } finally {
      this.running = false;
    }
  }

  private async processDueTasks() {
    const now = new Date();
    await prisma.task.updateMany({
      where: { status: TaskStatus.SCHEDULED, scheduled_time: { lte: now } },
      data: { status: TaskStatus.PENDING },
    });
  }
}

export const scheduledTaskService = new ScheduledTaskService();
