import { OrderStatus, Prisma, PrismaClient } from "@prisma/client";
import { creditService, getCreditDeltaByReviewRating } from "./credit.service";
import { sensitiveWordService } from "./sensitiveWord.service";

export class ReviewError extends Error {
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

export class ReviewService {
  async createOrderReview(input: {
    orderId: number;
    reviewerUserId: number;
    rating: unknown;
    tags?: unknown;
    comment?: unknown;
  }) {
    const orderId = input.orderId;
    if (!Number.isFinite(orderId) || orderId <= 0) {
      throw new ReviewError(400, "orderId 不合法");
    }
    const reviewerUserId = input.reviewerUserId;
    if (!Number.isFinite(reviewerUserId) || reviewerUserId <= 0) {
      throw new ReviewError(400, "userId 不合法");
    }

    const rating = parseIntOr(input.rating, 0);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      throw new ReviewError(400, "rating 必须为 1-5 整数");
    }

    const tags =
      Array.isArray(input.tags) && input.tags.length
        ? input.tags.map((t) => String(t)).filter((t) => t.trim().length > 0)
        : [];
    const comment =
      input.comment === undefined || input.comment === null ? null : String(input.comment).trim() || null;

    if (comment) {
      const match = await sensitiveWordService.matchText(comment);
      if (match.matched) {
        throw new ReviewError(400, "评价内容包含敏感词");
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          status: true,
          taker_id: true,
          task: { select: { publisher_id: true } },
          review: { select: { id: true } },
        },
      });
      if (!order) {
        throw new ReviewError(404, "订单不存在");
      }
      if (order.task.publisher_id !== reviewerUserId) {
        throw new ReviewError(403, "无权限");
      }
      if (order.status !== OrderStatus.COMPLETED) {
        throw new ReviewError(409, "订单状态必须为 COMPLETED");
      }
      if (order.review) {
        throw new ReviewError(409, "订单已评价");
      }

      const created = await tx.orderReview.create({
        data: {
          order_id: orderId,
          rating,
          tags_json: tags as Prisma.InputJsonValue,
          comment,
        },
      });

      const takerId = order.taker_id;
      if (takerId) {
        await creditService.changeCreditScore({
          tx,
          userId: takerId,
          delta: getCreditDeltaByReviewRating(rating),
        });
      }

      return created;
    });

    return created;
  }
}
