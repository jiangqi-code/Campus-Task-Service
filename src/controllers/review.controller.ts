import type { RequestHandler } from "express";
import { ReviewError, ReviewService } from "../services/review.service";

const reviewService = new ReviewService();

export const create: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const orderId = Number.parseInt(String(req.params.orderId ?? ""), 10);
    const { rating, tags, comment } = req.body as Partial<Record<string, unknown>>;

    const review = await reviewService.createOrderReview({
      orderId,
      reviewerUserId: user.id,
      rating,
      tags,
      comment,
    });

    res.status(201).json({ review });
  } catch (err) {
    if (err instanceof ReviewError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

