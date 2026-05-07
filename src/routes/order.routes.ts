import { Router } from "express";
import { acceptTask, cancelOrder, complete, confirmOrder, deliver, getOrderList, getTrack, pickup, uploadDeliveryPhoto, uploadPickupPhoto, urge } from "../controllers/order.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { antiBrushAcceptTask, limitOrderCancel } from "../middleware/rateLimit.middleware";
import { uploadImage as uploadImageMiddleware } from "../middleware/upload.middleware";

const router = Router();

router.get("/list", requireAuth, getOrderList);
router.post("/accept/:taskId", requireAuth, antiBrushAcceptTask, acceptTask);
router.put("/pickup/:orderId", requireAuth, pickup);
router.put("/:orderId/pickup-photo", requireAuth, uploadImageMiddleware, uploadPickupPhoto);
router.put("/deliver/:orderId", requireAuth, deliver);
router.put("/:orderId/delivery-photo", requireAuth, uploadImageMiddleware, uploadDeliveryPhoto);
router.put("/complete/:orderId", requireAuth, complete);
router.put("/:orderId/cancel", requireAuth, limitOrderCancel, cancelOrder);
router.post("/confirm/:orderId", requireAuth, confirmOrder);
router.post("/:orderId/urge", requireAuth, urge);
router.get("/:orderId/track", requireAuth, getTrack);

export default router;
