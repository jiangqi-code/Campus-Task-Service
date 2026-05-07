import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { auditAuth, getAuthList } from "../controllers/auth.controller";
import { auditRefund, getRefundList } from "../controllers/refund.controller";
import {
  addSensitiveWord,
  auditWithdraw,
  cancelOrder,
  deleteSensitiveWord,
  deleteTask,
  deleteUser,
  freezeUser,
  getConfig,
  getDashboard,
  getLogs,
  getSensitiveWords,
  orderList,
  setOrderStatus,
  taskList,
  updateConfig,
  userList,
  withdrawList,
} from "../controllers/admin.controller";

const router = Router();

router.get("/dashboard", requireAuth, requireRole("ADMIN"), getDashboard);
router.get("/logs", requireAuth, requireRole("ADMIN"), getLogs);
router.get("/config", requireAuth, requireRole("ADMIN"), getConfig);
router.put("/config/:key", requireAuth, requireRole("ADMIN"), updateConfig);
router.get("/sensitive-words", requireAuth, requireRole("ADMIN"), getSensitiveWords);
router.post("/sensitive-words", requireAuth, requireRole("ADMIN"), addSensitiveWord);
router.delete("/sensitive-words/:id", requireAuth, requireRole("ADMIN"), deleteSensitiveWord);
router.get("/users", requireAuth, requireRole("ADMIN"), userList);
router.put("/users/:userId/freeze", requireAuth, requireRole("ADMIN"), freezeUser);
router.delete("/users/:userId", requireAuth, requireRole("ADMIN"), deleteUser);

router.get("/tasks", requireAuth, requireRole("ADMIN"), taskList);
router.delete("/tasks/:taskId", requireAuth, requireRole("ADMIN"), deleteTask);

router.get("/orders", requireAuth, requireRole("ADMIN"), orderList);
router.put("/order/:orderId/cancel", requireAuth, requireRole("ADMIN"), cancelOrder);
router.put("/order/:orderId/status", requireAuth, requireRole("ADMIN"), setOrderStatus);

router.get("/withdraw/list", requireAuth, requireRole("ADMIN"), withdrawList);
router.post("/withdraw/:withdrawId/audit", requireAuth, requireRole("ADMIN"), auditWithdraw);

router.get("/refund/list", requireAuth, requireRole("ADMIN"), getRefundList);
router.post("/refund/:refundId/audit", requireAuth, requireRole("ADMIN"), auditRefund);

router.get("/auth/list", requireAuth, requireRole("ADMIN"), getAuthList);
router.post("/auth/:authId/audit", requireAuth, requireRole("ADMIN"), auditAuth);

export default router;
