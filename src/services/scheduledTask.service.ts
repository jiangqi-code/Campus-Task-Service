import cron, { type ScheduledTask } from "node-cron";
import { PrismaClient, TaskStatus } from "@prisma/client";
import { runDailyPricingAnalysis } from "./pricing.service";

const prisma = new PrismaClient();

export class ScheduledTaskService {
  private tasks: ScheduledTask[] = [];
  private runningDueTasks = false;
  private runningPricingAnalysis = false;

  start() {
    if (this.tasks.length) return;

    const dueTask = cron.schedule("* * * * *", () => {
      this.runDueTasksOnce().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[scheduledTask.cron] runDueTasksOnce failed:", message);
      });
    });
    dueTask.start();
    this.tasks.push(dueTask);

    const pricingTask = cron.schedule("0 2 * * *", () => {
      this.runPricingAnalysisOnce().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[scheduledTask.cron] runPricingAnalysisOnce failed:", message);
      });
    });
    pricingTask.start();
    this.tasks.push(pricingTask);
  }

  stop() {
    for (const task of this.tasks) task.stop();
    this.tasks = [];
  }

  private async runDueTasksOnce() {
    if (this.runningDueTasks) return;
    this.runningDueTasks = true;
    try {
      await this.processDueTasks();
    } finally {
      this.runningDueTasks = false;
    }
  }

  private async processDueTasks() {
    const now = new Date();
    await prisma.task.updateMany({
      where: { status: TaskStatus.SCHEDULED, scheduled_time: { lte: now } },
      data: { status: TaskStatus.PENDING },
    });
  }

  private async runPricingAnalysisOnce() {
    if (this.runningPricingAnalysis) return;
    this.runningPricingAnalysis = true;
    try {
      const created = await runDailyPricingAnalysis();
      if (created) {
        console.log("[scheduledTask.pricing] created recommendation:", {
          model_version: created.model_version,
          sample_size: created.sample_size,
        });
      } else {
        console.log("[scheduledTask.pricing] skipped: not enough data");
      }
    } finally {
      this.runningPricingAnalysis = false;
    }
  }
}

export const scheduledTaskService = new ScheduledTaskService();
