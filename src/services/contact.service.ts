import { Prisma, PrismaClient, Role } from "@prisma/client";
import { websocketService } from "./websocket.service";

export class ContactError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const prisma = new PrismaClient();

const toAdminLogDetail = (value: unknown): Prisma.InputJsonValue | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value as Prisma.InputJsonValue;
};

const runnerContactShowRealPhoneConfigKey = "runner_contact_show_real_phone";

const parseBooleanConfigValue = (raw: string | null | undefined): boolean | null => {
  if (raw === undefined || raw === null) return null;
  const v = String(raw).trim().toLowerCase();
  if (!v) return null;
  if (["1", "true", "yes", "y", "on", "是", "开启", "open"].includes(v)) return true;
  if (["0", "false", "no", "n", "off", "否", "关闭", "close"].includes(v)) return false;
  return null;
};

const maskPhone = (phone: string) => {
  const p = phone.trim();
  if (p.length < 7) return p;
  return `${p.slice(0, 3)}****${p.slice(-4)}`;
};

export type ContactPublisherResult = {
  orderId: number;
  publisherId: number;
  runnerId: number;
  runnerNickname: string | null;
  contact: string | null;
  showRealPhone: boolean;
  at: string;
};

export class ContactService {
  async contactPublisher(input: { orderId: number; runnerId: number }) {
    if (!Number.isFinite(input.orderId) || input.orderId <= 0) {
      throw new ContactError(400, "orderId 不合法");
    }
    if (!Number.isFinite(input.runnerId) || input.runnerId <= 0) {
      throw new ContactError(400, "runnerId 不合法");
    }

    const nowIso = new Date().toISOString();

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const order = await tx.order.findUnique({
        where: { id: input.orderId },
        select: {
          id: true,
          taker_id: true,
          task: { select: { publisher_id: true } },
        },
      });
      if (!order) {
        throw new ContactError(404, "订单不存在");
      }
      if (order.taker_id !== input.runnerId) {
        throw new ContactError(403, "无权限");
      }

      const runner = await tx.user.findUnique({
        where: { id: input.runnerId },
        select: { id: true, role: true, status: true, nickname: true, phone: true },
      });
      if (!runner || runner.status === -1) {
        throw new ContactError(404, "跑腿员不存在");
      }
      if (runner.role !== Role.RUNNER) {
        throw new ContactError(403, "无权限");
      }

      const configRow = await tx.systemConfig.findUnique({
        where: { key: runnerContactShowRealPhoneConfigKey },
        select: { value: true },
      });
      const showRealPhone = parseBooleanConfigValue(configRow?.value) ?? false;

      const phone = runner.phone ? runner.phone.trim() : "";
      const contact = showRealPhone ? (phone || null) : phone ? maskPhone(phone) : null;

      const payload: ContactPublisherResult = {
        orderId: input.orderId,
        publisherId: order.task.publisher_id,
        runnerId: input.runnerId,
        runnerNickname: runner.nickname ?? null,
        contact,
        showRealPhone,
        at: nowIso,
      };

      await tx.adminLog.create({
        data: {
          admin_id: input.runnerId,
          action: "ORDER_CONTACT",
          target_type: "ORDER",
          target_id: input.orderId,
          detail_json: toAdminLogDetail({
            orderId: input.orderId,
            publisherId: order.task.publisher_id,
            runnerId: input.runnerId,
            runnerNickname: runner.nickname ?? null,
            showRealPhone,
            contact: contact ? (showRealPhone ? contact : "MASKED") : null,
            at: nowIso,
          }),
        },
      });

      return payload;
    });

    websocketService.pushToUser(result.publisherId, "order:contact", result);

    return { contact: result };
  }
}

export const contactService = new ContactService();
