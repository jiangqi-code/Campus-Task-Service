import { Router } from "express";
import { acceptTask, cancelOrder, complete, confirmOrder, deliver, pickup, urge } from "../controllers/order.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.post("/accept/:taskId", requireAuth, acceptTask);
router.put("/pickup/:orderId", requireAuth, pickup);
router.put("/deliver/:orderId", requireAuth, deliver);
router.put("/complete/:orderId", requireAuth, complete);
router.put("/:orderId/cancel", requireAuth, cancelOrder);
router.post("/confirm/:orderId", requireAuth, confirmOrder);
router.post("/:orderId/urge", requireAuth, urge);

export default router;
