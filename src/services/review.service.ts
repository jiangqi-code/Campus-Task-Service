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

const parseRatingFilter = (value: unknown) => {
  if (value === undefined || value === null || value === "") return null;

  const rating = parseIntOr(value, 0);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    throw new ReviewError(400, "rating 必须为 1-5 整数");
  }

  return rating;
};

const normalizeTags = (value: Prisma.JsonValue | null | undefined) => {
  if (!Array.isArray(value)) return [] as string[];
  return value.map((item) => String(item)).filter((item) => item.trim().length > 0);
};

export class ReviewService {
  async createOrderReview(input: {
    orderId: number;
    reviewerUserId: number;
    rating: unknown;
    tags?: unknown;
    comment?: unknown;
    images?: unknown;
    isAnonymous?: unknown;
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
    if (!comment || comment.length < 5) {
      throw new ReviewError(400, "文字评价至少需要 5 个字");
    }
    const images = Array.isArray(input.images)
      ? input.images.map((item) => String(item).trim()).filter(Boolean).slice(0, 3)
      : [];
    const isAnonymous = input.isAnonymous === true || input.isAnonymous === 1 || String(input.isAnonymous).toLowerCase() === "true";

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
          images_json: images as Prisma.InputJsonValue,
          is_anonymous: isAnonymous,
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

  async getReceivedReviews(input: {
    userId: number;
    page?: unknown;
    pageSize?: unknown;
    rating?: unknown;
  }) {
    if (!Number.isFinite(input.userId) || input.userId <= 0) {
      throw new ReviewError(400, "userId 不合法");
    }

    const page = Math.max(1, parseIntOr(input.page, 1));
    const pageSize = Math.min(100, Math.max(1, parseIntOr(input.pageSize, 10)));
    const skip = (page - 1) * pageSize;
    const rating = parseRatingFilter(input.rating);

    const where: Prisma.OrderReviewWhereInput = {
      ...(rating ? { rating } : undefined),
      order: {
        taker_id: input.userId,
      },
    };

    const [total, reviews] = await Promise.all([
      prisma.orderReview.count({ where }),
      prisma.orderReview.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take: pageSize,
        select: {
          id: true,
          rating: true,
          images_json: true,
          is_anonymous: true,
          tags_json: true,
          comment: true,
          created_at: true,
          order: {
            select: {
              id: true,
              status: true,
              task: {
                select: {
                  publisher: {
                    select: {
                      nickname: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    return {
      list: reviews.map((review) => ({
        id: review.id,
        rating: review.rating,
        tags: normalizeTags(review.tags_json),
        content: review.comment ?? "",
        images: normalizeTags(review.images_json),
        isAnonymous: review.is_anonymous,
        fromUserName: review.is_anonymous ? "匿名用户" : review.order.task.publisher.nickname ?? "",
        reviewerNickname: review.is_anonymous ? "匿名用户" : review.order.task.publisher.nickname ?? "",
        orderId: review.order.id,
        orderStatus: review.order.status,
        createdAt: review.created_at,
      })),
      total,
    };
  }

  async getGivenReviews(input: {
    userId: number;
    page?: unknown;
    pageSize?: unknown;
    rating?: unknown;
  }) {
    if (!Number.isFinite(input.userId) || input.userId <= 0) {
      throw new ReviewError(400, "userId 不合法");
    }

    const page = Math.max(1, parseIntOr(input.page, 1));
    const pageSize = Math.min(100, Math.max(1, parseIntOr(input.pageSize, 10)));
    const skip = (page - 1) * pageSize;
    const rating = parseRatingFilter(input.rating);

    const where: Prisma.OrderReviewWhereInput = {
      ...(rating ? { rating } : undefined),
      order: {
        task: {
          publisher_id: input.userId,
        },
      },
    };

    const [total, reviews] = await Promise.all([
      prisma.orderReview.count({ where }),
      prisma.orderReview.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take: pageSize,
        select: {
          id: true,
          rating: true,
          images_json: true,
          is_anonymous: true,
          tags_json: true,
          comment: true,
          created_at: true,
          order: {
            select: {
              id: true,
              status: true,
              taker: {
                select: {
                  nickname: true,
                },
              },
            },
          },
        },
      }),
    ]);

    return {
      list: reviews.map((review) => ({
        id: review.id,
        rating: review.rating,
        tags: normalizeTags(review.tags_json),
        content: review.comment ?? "",
        images: normalizeTags(review.images_json),
        isAnonymous: review.is_anonymous,
        toUserName: review.order.taker?.nickname ?? "",
        revieweeNickname: review.order.taker?.nickname ?? "",
        orderId: review.order.id,
        orderStatus: review.order.status,
        createdAt: review.created_at,
      })),
      total,
    };
  }
}
