import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { getRefundList, auditRefund } from "../controllers/admin.controller";
import {
  getDashboard,
  getHeatmapData,
  userList,
  getLogs,
  getLoginLogs,
  getErrorLogs,
  freezeUser,
  deleteUser,
  resetPassword,
  taskList,
  deleteTask,
  cancelOrder,
  setOrderStatus,
  orderList,
  exportOrders,
  withdrawList,
  auditWithdraw,
  getConfig,
  updateConfig,
  getSensitiveWords,
  addSensitiveWord,
  deleteSensitiveWord,
  getUnfreezeApplications,
  processUnfreezeApplication,
} from "../controllers/admin.controller";
import { getAuthList, auditAuth } from "../controllers/auth.controller";
import { getAdminReportList, processAdminReport } from "../controllers/report.controller";
import { getAdminComplaintList, processAdminComplaint } from "../controllers/complaint.controller";
import {
  auditForumPost,
  createForumCategory,
  deactivateForumCategory,
  hideForumCommentByAdmin,
  listAdminForumCategories,
  listAdminForumComments,
  listAdminForumPosts,
  updateForumCategory,
} from "../controllers/forum.controller";
import {
  auditFoodMerchant,
  listAdminFoodMerchants,
  listAdminFoodOrders,
  updateFoodSettings,
} from "../controllers/food.controller";

const router = Router();
router.get("/auth/list", requireAuth, getAuthList);
router.post("/auth/:authId/audit", requireAuth, auditAuth);
router.get("/runner/apply/list", requireAuth, getAuthList);


router.get("/refund/list", requireAuth, getRefundList);
router.post("/refund/:refundId/audit", requireAuth, auditRefund);

router.get("/reports", requireAuth, requireRole("ADMIN"), getAdminReportList);
router.put("/reports/:id/process", requireAuth, requireRole("ADMIN"), processAdminReport);

router.get("/complaints", requireAuth, requireRole("ADMIN"), getAdminComplaintList);
router.put("/complaints/:id/process", requireAuth, requireRole("ADMIN"), processAdminComplaint);

// 仪表盘
router.get("/dashboard", requireAuth, getDashboard);
router.get("/heatmap", requireAuth, getHeatmapData);

// 日志
router.get("/logs", requireAuth, getLogs);
router.get("/logs/login", requireAuth, getLoginLogs);
router.get("/logs/error", requireAuth, getErrorLogs);

// 用户管理
router.get("/users", requireAuth, userList);
router.put("/users/:userId/freeze", requireAuth, freezeUser);
router.delete("/users/:userId", requireAuth, deleteUser);
router.put("/users/:userId/reset-password", requireAuth, resetPassword);

// 解封审核（新增）
router.get("/unfreeze-applications", requireAuth, getUnfreezeApplications);
router.post("/unfreeze-applications/:id/process", requireAuth, processUnfreezeApplication);

// 任务管理
router.get("/tasks", requireAuth, taskList);
router.delete("/tasks/:taskId", requireAuth, deleteTask);

// 订单管理
router.get("/orders", requireAuth, orderList);
router.put("/order/:orderId/cancel", requireAuth, cancelOrder);
router.put("/order/:orderId/status", requireAuth, setOrderStatus);
router.get("/orders/export", requireAuth, exportOrders);

// 提现审核
router.get("/withdraw/list", requireAuth, withdrawList);
router.post("/withdraw/:withdrawId/audit", requireAuth, auditWithdraw);

// 系统配置
router.get("/config", requireAuth, getConfig);
router.put("/config/:key", requireAuth, updateConfig);

// 敏感词管理
router.get("/sensitive-words", requireAuth, getSensitiveWords);
router.post("/sensitive-words", requireAuth, addSensitiveWord);
router.delete("/sensitive-words/:id", requireAuth, deleteSensitiveWord);

// 信息发布广场：内容审核、分类与评论治理
router.get("/forum/posts", requireAuth, requireRole("ADMIN"), listAdminForumPosts);
router.put("/forum/posts/:postId/audit", requireAuth, requireRole("ADMIN"), auditForumPost);
router.get("/forum/categories", requireAuth, requireRole("ADMIN"), listAdminForumCategories);
router.post("/forum/categories", requireAuth, requireRole("ADMIN"), createForumCategory);
router.put("/forum/categories/:categoryId", requireAuth, requireRole("ADMIN"), updateForumCategory);
router.delete("/forum/categories/:categoryId", requireAuth, requireRole("ADMIN"), deactivateForumCategory);
router.get("/forum/comments", requireAuth, requireRole("ADMIN"), listAdminForumComments);
router.put("/forum/comments/:commentId/hide", requireAuth, requireRole("ADMIN"), hideForumCommentByAdmin);

// 校园外卖：商家准入、订单跟踪与抽成设置
router.get("/food/merchants", requireAuth, requireRole("ADMIN"), listAdminFoodMerchants);
router.put("/food/merchants/:merchantId/audit", requireAuth, requireRole("ADMIN"), auditFoodMerchant);
router.get("/food/orders", requireAuth, requireRole("ADMIN"), listAdminFoodOrders);
router.put("/food/settings", requireAuth, requireRole("ADMIN"), updateFoodSettings);

export default router;
