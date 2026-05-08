import { Prisma, PrismaClient, Role } from "@prisma/client";
import { websocketService } from "./websocket.service";

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

    const orderIdRaw = typeof input.orderId === "string" ? input.orderId.trim() : input.orderId;
    const runnerIdRaw = typeof input.runnerId === "string" ? input.runnerId.trim() : input.runnerId;
    const orderId = /^\d+$/.test(String(orderIdRaw ?? "")) ? Number.parseInt(String(orderIdRaw), 10) : null;
    const runnerId = /^\d+$/.test(String(runnerIdRaw ?? "")) ? Number.parseInt(String(runnerIdRaw), 10) : null;

    const type = typeof input.type === "string" && input.type.trim() ? input.type.trim() : null;
    const keyword = typeof input.keyword === "string" && input.keyword.trim() ? input.keyword.trim() : null;

    const where: Prisma.ReportWhereInput = {
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
              task: { select: { pickup_address: true, delivery_address: true, type: true, urgency: true } },
            },
          },
          runner: { select: { id: true, student_id: true, phone: true, nickname: true, role: true } },
        },
      }),
    ]);

    return { page, pageSize, total, items };
  }
}

export const reportService = new ReportService();

