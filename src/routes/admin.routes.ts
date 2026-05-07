import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { auditWithdraw, cancelOrder, setOrderStatus, withdrawList } from "../controllers/admin.controller";

const router = Router();

router.put("/order/:orderId/cancel", requireAuth, requireRole("ADMIN"), cancelOrder);
router.put("/order/:orderId/status", requireAuth, requireRole("ADMIN"), setOrderStatus);

router.get("/withdraw/list", requireAuth, requireRole("ADMIN"), withdrawList);
router.post("/withdraw/:withdrawId/audit", requireAuth, requireRole("ADMIN"), auditWithdraw);

export default router;
