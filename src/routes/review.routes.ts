import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { create, getGivenReviews, getReceivedReviews } from "../controllers/review.controller";

const router = Router();

router.post("/order/:orderId/review", requireAuth, create);
router.get("/reviews/received", requireAuth, getReceivedReviews);
router.get("/reviews/given", requireAuth, getGivenReviews);

export default router;
