import { ComplaintStatus, Prisma, PrismaClient } from "@prisma/client";

export class ComplaintError extends Error {
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

type CreateComplaintInput = {
  orderId: number;
  userId: number;
  reason: unknown;
  description?: unknown;
  photos?: unknown;
};

type ListComplaintsInput = {
  page?: unknown;
  pageSize?: unknown;
  status?: unknown;
};

type ProcessComplaintInput = {
  adminId: number;
  complaintId: number;
  action: unknown;
  admin_note?: unknown;
};

type ProcessAction = "resolve" | "reject";

const toProcessAction = (value: unknown): ProcessAction | null => {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (v === "resolve" || v === "reject") return v;
  return null;
};

const toComplaintStatus = (value: unknown): ComplaintStatus | null => {
  if (typeof value !== "string") return null;
  const v = value.trim().toUpperCase();
  const all = Object.values(ComplaintStatus) as string[];
  if (!all.includes(v)) return null;
  return v as ComplaintStatus;
};

const toOptionalText = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  return v ? v : undefined;
};

const toPhotoArray = (value: unknown): string[] | null => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const photos = value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => Boolean(v));
  return photos;
};

export class ComplaintService {
  async createComplaint(input: CreateComplaintInput) {
    if (!Number.isFinite(input.orderId) || input.orderId <= 0) {
      throw new ComplaintError(400, "orderId 不合法");
    }
    if (!Number.isFinite(input.userId) || input.userId <= 0) {
      throw new ComplaintError(400, "userId 不合法");
    }

    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (!reason) {
      throw new ComplaintError(400, "reason 为必填");
    }

    const description = toOptionalText(input.description);
    const photos = toPhotoArray(input.photos);
    if (!photos) {
      throw new ComplaintError(400, "photos 必须为字符串数组");
    }

    const now = new Date();

    try {
      const complaint = await prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: input.orderId },
          select: { id: true, taker_id: true, task: { select: { publisher_id: true } } },
        });

        if (!order) {
          throw new ComplaintError(404, "订单不存在");
        }

        const isPublisher = order.task.publisher_id === input.userId;
        const isRunner = order.taker_id === input.userId;
        if (!isPublisher && !isRunner) {
          throw new ComplaintError(403, "无权限");
        }

        const existing = await tx.complaint.findUnique({
          where: { order_id: input.orderId },
          select: { id: true },
        });
        if (existing) {
          throw new ComplaintError(409, "该订单已投诉");
        }

        return tx.complaint.create({
          data: {
            order_id: input.orderId,
            creator_id: input.userId,
            reason,
            description,
            photos_json: photos.length ? toAdminLogDetail(photos) : undefined,
            status: ComplaintStatus.PENDING,
            processed_at: null,
            created_at: now,
          },
        });
      });

      return complaint;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === "P2002") {
          throw new ComplaintError(409, "该订单已投诉");
        }
      }
      throw err;
    }
  }

  async listComplaints(input: ListComplaintsInput) {
    const page = Math.max(1, parseIntOr(input.page, 1));
    const pageSize = Math.min(100, Math.max(1, parseIntOr(input.pageSize, 10)));
    const skip = (page - 1) * pageSize;

    const status = input.status === undefined ? undefined : toComplaintStatus(input.status);
    if (input.status !== undefined && !status) {
      throw new ComplaintError(400, "status 不合法");
    }

    const where: Prisma.ComplaintWhereInput = {
      ...(status ? { status } : undefined),
    };

    const [total, items] = await Promise.all([
      prisma.complaint.count({ where }),
      prisma.complaint.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take: pageSize,
        include: {
          creator: { select: { id: true, student_id: true, phone: true, nickname: true, role: true } },
          admin: { select: { id: true, student_id: true, phone: true, nickname: true, role: true } },
          order: {
            select: {
              id: true,
              status: true,
              created_at: true,
              updated_at: true,
              taker: { select: { id: true, student_id: true, phone: true, nickname: true, role: true } },
              task: {
                select: {
                  id: true,
                  type: true,
                  pickup_address: true,
                  delivery_address: true,
                  fee_total: true,
                  tip: true,
                  publisher: { select: { id: true, student_id: true, phone: true, nickname: true, role: true } },
                },
              },
            },
          },
        },
      }),
    ]);

    return { page, pageSize, total, items };
  }

  async processComplaint(input: ProcessComplaintInput) {
    if (!Number.isFinite(input.adminId) || input.adminId <= 0) {
      throw new ComplaintError(400, "adminId 不合法");
    }
    if (!Number.isFinite(input.complaintId) || input.complaintId <= 0) {
      throw new ComplaintError(400, "complaintId 不合法");
    }

    const action = toProcessAction(input.action);
    if (!action) {
      throw new ComplaintError(400, "action 必须为 resolve/reject");
    }

    const admin_note = toOptionalText(input.admin_note);

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const complaint = await tx.complaint.findUnique({
        where: { id: input.complaintId },
        select: { id: true, order_id: true, creator_id: true, status: true },
      });
      if (!complaint) {
        throw new ComplaintError(404, "投诉工单不存在");
      }
      if (complaint.status === ComplaintStatus.RESOLVED || complaint.status === ComplaintStatus.REJECTED) {
        throw new ComplaintError(409, "投诉工单已处理");
      }

      const to_status = action === "resolve" ? ComplaintStatus.RESOLVED : ComplaintStatus.REJECTED;

      const next = await tx.complaint.update({
        where: { id: complaint.id },
        data: {
          status: to_status,
          admin_note,
          admin_id: input.adminId,
          processed_at: now,
        },
      });

      await tx.adminLog.create({
        data: {
          admin_id: input.adminId,
          action: "COMPLAINT_PROCESS",
          target_type: "COMPLAINT",
          target_id: complaint.id,
          detail_json: toAdminLogDetail({
            action,
            to_status,
            order_id: complaint.order_id,
            creator_id: complaint.creator_id,
            admin_note: admin_note ?? null,
            at: now.toISOString(),
          }),
        },
      });

      return next;
    });

    return updated;
  }
}

export const complaintService = new ComplaintService();

