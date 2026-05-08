import { OrderStatus, Prisma, PrismaClient } from "@prisma/client";
import { Parser } from "json2csv";
import ExcelJS from "exceljs";

export class ExportError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const prisma = new PrismaClient();

export type ExportOrdersFormat = "csv" | "xlsx";

type ExportOrdersInput = {
  status?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  format?: unknown;
};

type ExportedFile = {
  filename: string;
  contentType: string;
  data: Buffer;
};

const toOptionalTrimmedString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const s = value.trim();
  return s ? s : null;
};

const hasQueryValue = (value: unknown) => {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
};

const toOptionalStartDate = (value: unknown) => {
  const s = toOptionalTrimmedString(value);
  if (!s) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
  const d = new Date(dateOnly ? `${s}T00:00:00` : s);
  if (!Number.isFinite(d.getTime())) return null;
  return d;
};

const toOptionalEndDate = (value: unknown) => {
  const s = toOptionalTrimmedString(value);
  if (!s) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
  const d = new Date(dateOnly ? `${s}T23:59:59.999` : s);
  if (!Number.isFinite(d.getTime())) return null;
  return d;
};

const isAdminListableOrderStatus = (value: unknown): value is OrderStatus => {
  if (typeof value !== "string") return false;
  return (
    value === OrderStatus.ACCEPTED ||
    value === OrderStatus.PICKED ||
    value === OrderStatus.DELIVERING ||
    value === OrderStatus.COMPLETED ||
    value === OrderStatus.CANCELLED
  );
};

const toOptionalExportFormat = (value: unknown): ExportOrdersFormat | null => {
  const s = toOptionalTrimmedString(value);
  if (!s) return null;
  const v = s.toLowerCase();
  if (v === "csv") return "csv";
  if (v === "xlsx" || v === "excel") return "xlsx";
  return null;
};

const pad2 = (n: number) => String(n).padStart(2, "0");

const formatDateTime = (d: Date | null | undefined): string => {
  if (!d) return "";
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
};

export const exportOrders = async (input: ExportOrdersInput): Promise<ExportedFile> => {
  const statusRaw = toOptionalTrimmedString(input.status);
  if (statusRaw && !isAdminListableOrderStatus(statusRaw)) {
    throw new ExportError(400, "status 不合法");
  }
  const status = statusRaw ? (statusRaw as OrderStatus) : null;

  const startDate = toOptionalStartDate(input.startDate);
  if (hasQueryValue(input.startDate) && !startDate) {
    throw new ExportError(400, "start_date 不合法");
  }

  const endDate = toOptionalEndDate(input.endDate);
  if (hasQueryValue(input.endDate) && !endDate) {
    throw new ExportError(400, "end_date 不合法");
  }

  if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
    throw new ExportError(400, "start_date 不能大于 end_date");
  }

  const format = toOptionalExportFormat(input.format) ?? "csv";
  if (hasQueryValue(input.format) && !toOptionalExportFormat(input.format)) {
    throw new ExportError(400, "format 不合法");
  }

  const where: Prisma.OrderWhereInput = {
    ...(status ? { status } : undefined),
    ...((startDate || endDate) && {
      created_at: {
        ...(startDate ? { gte: startDate } : undefined),
        ...(endDate ? { lte: endDate } : undefined),
      },
    }),
  };

  const orders = await prisma.order.findMany({
    where,
    orderBy: { created_at: "desc" },
    select: {
      id: true,
      status: true,
      created_at: true,
      complete_time: true,
      final_price: true,
      task: {
        select: {
          pickup_address: true,
          delivery_address: true,
          fee_total: true,
          publisher: { select: { nickname: true } },
        },
      },
      taker: { select: { nickname: true } },
    },
  });

  const rows = orders.map((order) => {
    const amount = order.final_price ?? order.task.fee_total;
    return {
      order_id: order.id,
      task_address: `${order.task.pickup_address} -> ${order.task.delivery_address}`,
      user_nickname: order.task.publisher.nickname ?? "",
      runner_nickname: order.taker?.nickname ?? "",
      amount: amount.toString(),
      status: order.status,
      created_time: formatDateTime(order.created_at),
      complete_time: formatDateTime(order.complete_time),
    };
  });

  const now = new Date();
  const filenameBase = `orders_${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}_${pad2(
    now.getHours(),
  )}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;

  if (format === "csv") {
    const parser = new Parser({
      fields: [
        { label: "订单ID", value: "order_id" },
        { label: "任务地址", value: "task_address" },
        { label: "用户昵称", value: "user_nickname" },
        { label: "跑腿员昵称", value: "runner_nickname" },
        { label: "金额", value: "amount" },
        { label: "状态", value: "status" },
        { label: "创建时间", value: "created_time" },
        { label: "完成时间", value: "complete_time" },
      ],
      withBOM: true,
    });

    const csv = parser.parse(rows);
    return {
      filename: `${filenameBase}.csv`,
      contentType: "text/csv; charset=utf-8",
      data: Buffer.from(csv, "utf8"),
    };
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Orders");
  sheet.columns = [
    { header: "订单ID", key: "order_id", width: 12 },
    { header: "任务地址", key: "task_address", width: 40 },
    { header: "用户昵称", key: "user_nickname", width: 16 },
    { header: "跑腿员昵称", key: "runner_nickname", width: 16 },
    { header: "金额", key: "amount", width: 12 },
    { header: "状态", key: "status", width: 14 },
    { header: "创建时间", key: "created_time", width: 20 },
    { header: "完成时间", key: "complete_time", width: 20 },
  ];
  sheet.addRows(rows);

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    filename: `${filenameBase}.xlsx`,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    data: Buffer.from(buffer),
  };
};

