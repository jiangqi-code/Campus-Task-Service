import cron, { type ScheduledTask } from "node-cron";
const prismaClientModule = require("@prisma/client") as any;
const PrismaClient = prismaClientModule.PrismaClient as any;
const TaskStatus = prismaClientModule.TaskStatus as any;

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
    const candidates = await prisma.task.findMany({
      where: { status: TaskStatus.SCHEDULED, scheduled_time: { lte: now } },
      select: { id: true },
      take: 200,
      orderBy: { scheduled_time: "asc" },
    });

    for (const row of candidates) {
      await prisma.task
        .updateMany({
          where: { id: row.id, status: TaskStatus.SCHEDULED, scheduled_time: { lte: now } },
          data: { status: TaskStatus.PENDING },
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[scheduledTask.processDueTasks] failed:", { taskId: row.id, message });
        });
    }
  }
}

export const scheduledTaskService = new ScheduledTaskService();
