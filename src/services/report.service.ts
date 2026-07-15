import { Prisma, PrismaClient, ReportProcessAction, ReportStatus, Role } from "@prisma/client";
import { websocketService } from "./websocket.service";
import { creditService } from "./credit.service";

export class ReportError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const prisma = new PrismaClient();

const parseIntOr = (value: unknown, fallback: number) => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const n = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
};

const toAdminLogDetail = (value: unknown): Prisma.InputJsonValue | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value as Prisma.InputJsonValue;
};

type CreateReportInput = {
  orderId: number;
  runnerId: number;
  type: unknown;
  description: unknown;
  photos?: unknown;
};

type ListReportsInput = {
  page?: unknown;
  pageSize?: unknown;
  status?: unknown;
  orderId?: unknown;
  runnerId?: unknown;
  type?: unknown;
  keyword?: unknown;
};

export class ReportService {
  async createReport(input: CreateReportInput) {
    if (!Number.isFinite(input.orderId) || input.orderId <= 0) {
      throw new ReportError(400, "orderId 不合法");
    }
    if (!Number.isFinite(input.runnerId) || input.runnerId <= 0) {
      throw new ReportError(400, "runnerId 不合法");
    }

    const type = typeof input.type === "string" ? input.type.trim() : "";
    if (!type) {
      throw new ReportError(400, "type 为必填");
    }
    if (type.length > 50) {
      throw new ReportError(400, "type 长度不能超过 50");
    }

    const description = typeof input.description === "string" ? input.description.trim() : "";
    if (!description) {
      throw new ReportError(400, "description 为必填");
    }

    const photosRaw = input.photos;
    const photos =
      Array.isArray(photosRaw)
        ? photosRaw
            .filter((v): v is string => typeof v === "string")
            .map((v) => v.trim())
            .filter(Boolean)
        : undefined;

    const nowIso = new Date().toISOString();

    const { report, adminIds } = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: input.orderId },
        select: { id: true, taker_id: true },
      });
      if (!order) {
        throw new ReportError(404, "订单不存在");
      }
      if (!order.taker_id || order.taker_id !== input.runnerId) {
        throw new ReportError(403, "无权限");
      }

      const report = await tx.report.create({
        data: {
          order_id: input.orderId,
          runner_id: input.runnerId,
          type,
          description,
          photos_json: photos?.length ? (photos as Prisma.InputJsonValue) : undefined,
        },
        include: {
          order: {
            select: {
              id: true,
              status: true,
              task: { select: { pickup_address: true, delivery_address: true } },
            },
          },
          runner: { select: { id: true, student_id: true, phone: true, nickname: true, role: true } },
        },
      });

      const admins = await tx.user.findMany({
        where: { role: Role.ADMIN, status: { not: -1 } },
        select: { id: true },
      });
      const adminIds = admins.map((a) => a.id);

      if (adminIds.length) {
        await tx.adminLog.createMany({
          data: adminIds.map((adminId) => ({
            admin_id: adminId,
            action: "REPORT_CREATED",
            target_type: "REPORT",
            target_id: report.id,
            detail_json: toAdminLogDetail({
              reportId: report.id,
              orderId: input.orderId,
              runnerId: input.runnerId,
              type,
              at: nowIso,
            }),
          })),
        });
      }

      return { report, adminIds };
    });

    try {
      const io = websocketService.getIO();
      for (const adminId of adminIds) {
        io.to(`user:${adminId}`).emit("report:new", { report });
      }
    } catch {}

    return report;
  }

  async listReportsForAdmin(input: ListReportsInput) {
    const page = Math.max(1, parseIntOr(input.page, 1));
    const pageSize = Math.min(100, Math.max(1, parseIntOr(input.pageSize, 10)));
    const skip = (page - 1) * pageSize;

    const status =
      typeof input.status === "string" && input.status.trim()
        ? input.status.trim().toUpperCase()
        : undefined;
    const normalizedStatus =
      status && (Object.values(ReportStatus) as string[]).includes(status) ? (status as ReportStatus) : undefined;
    if (input.status !== undefined && input.status !== null && !normalizedStatus) {
      throw new ReportError(400, "status 不合法");
    }

    const orderIdRaw = typeof input.orderId === "string" ? input.orderId.trim() : input.orderId;
    const runnerIdRaw = typeof input.runnerId === "string" ? input.runnerId.trim() : input.runnerId;
    const orderId = /^\d+$/.test(String(orderIdRaw ?? "")) ? Number.parseInt(String(orderIdRaw), 10) : null;
    const runnerId = /^\d+$/.test(String(runnerIdRaw ?? "")) ? Number.parseInt(String(runnerIdRaw), 10) : null;

    const type = typeof input.type === "string" && input.type.trim() ? input.type.trim() : null;
    const keyword = typeof input.keyword === "string" && input.keyword.trim() ? input.keyword.trim() : null;

    const where: Prisma.ReportWhereInput = {
      ...(normalizedStatus ? { status: normalizedStatus } : undefined),
      ...(orderId ? { order_id: orderId } : undefined),
      ...(runnerId ? { runner_id: runnerId } : undefined),
      ...(type ? { type: { contains: type } } : undefined),
      ...(keyword
        ? {
            OR: [
              { type: { contains: keyword } },
              { description: { contains: keyword } },
              ...(/^\d+$/.test(keyword)
                ? [
                    { id: Number.parseInt(keyword, 10) },
                    { order_id: Number.parseInt(keyword, 10) },
                    { runner_id: Number.parseInt(keyword, 10) },
                  ]
                : []),
            ],
          }
        : undefined),
    };

    const [total, items] = await Promise.all([
      prisma.report.count({ where }),
      prisma.report.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take: pageSize,
        include: {
          order: {
            select: {
              id: true,
              status: true,
              taker_id: true,
              created_at: true,
              task: {
                select: {
                  pickup_address: true,
                  delivery_address: true,
                  type: true,
                  urgency: true,
                  publisher: { select: { id: true, student_id: true, phone: true, nickname: true, role: true } },
                },
              },
            },
          },
          runner: { select: { id: true, student_id: true, phone: true, nickname: true, role: true } },
          admin: { select: { id: true, student_id: true, phone: true, nickname: true, role: true } },
        },
      }),
    ]);

    return { page, pageSize, total, items };
  }

  async processReportByAdmin(input: {
    adminId: number;
    reportId: number;
    action: unknown;
    result: unknown;
  }) {
    if (!Number.isFinite(input.adminId) || input.adminId <= 0) {
      throw new ReportError(400, "adminId 不合法");
    }
    if (!Number.isFinite(input.reportId) || input.reportId <= 0) {
      throw new ReportError(400, "reportId 不合法");
    }

    const result = typeof input.result === "string" ? input.result.trim() : "";
    if (!result) {
      throw new ReportError(400, "result 为必填");
    }

    const actionRaw = typeof input.action === "string" ? input.action.trim().toUpperCase() : "";
    const action =
      actionRaw && (Object.values(ReportProcessAction) as string[]).includes(actionRaw)
        ? (actionRaw as ReportProcessAction)
        : null;
    if (!action) {
      throw new ReportError(400, "action 必须为 warn/deduct_score/freeze");
    }

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const report = await tx.report.findUnique({
        where: { id: input.reportId },
        select: {
          id: true,
          status: true,
          order_id: true,
          runner_id: true,
          order: { select: { task: { select: { publisher_id: true } } } },
        },
      });
      if (!report) {
        throw new ReportError(404, "举报不存在");
      }
      if (report.status !== ReportStatus.PENDING) {
        throw new ReportError(409, "举报已处理");
      }

      const accusedUserId = report.order.task.publisher_id;
      if (!Number.isFinite(accusedUserId) || accusedUserId <= 0) {
        throw new ReportError(409, "订单缺少发布者信息");
      }

      const next = await tx.report.update({
        where: { id: report.id },
        data: {
          status: ReportStatus.PROCESSED,
          process_action: action,
          process_result: result,
          processed_by: input.adminId,
          processed_at: now,
        },
        include: {
          order: {
            select: {
              id: true,
              status: true,
              taker_id: true,
              created_at: true,
              task: {
                select: {
                  pickup_address: true,
                  delivery_address: true,
                  type: true,
                  urgency: true,
                  publisher: { select: { id: true, student_id: true, phone: true, nickname: true, role: true } },
                },
              },
            },
          },
          runner: { select: { id: true, student_id: true, phone: true, nickname: true, role: true } },
          admin: { select: { id: true, student_id: true, phone: true, nickname: true, role: true } },
        },
      });

      if (action === ReportProcessAction.DEDUCT_SCORE) {
        await creditService.changeCreditScore({ tx, userId: accusedUserId, delta: -5 });
      } else if (action === ReportProcessAction.FREEZE) {
        await tx.user.updateMany({
          where: { id: accusedUserId, status: { not: -1 } },
          data: { status: 0 },
        });
      }

      await tx.adminLog.create({
        data: {
          admin_id: input.adminId,
          action: "REPORT_PROCESS",
          target_type: "REPORT",
          target_id: report.id,
          detail_json: toAdminLogDetail({
            action: actionRaw.toLowerCase(),
            to_status: ReportStatus.PROCESSED,
            order_id: report.order_id,
            reporter_id: report.runner_id,
            accused_user_id: accusedUserId,
            result,
            at: now.toISOString(),
          }),
        },
      });

      return next;
    });

    return updated;
  }
}

export const reportService = new ReportService();
