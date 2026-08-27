import { Router } from "express";
import {
  acceptFoodOrder,
  applyMerchant,
  cancelFoodOrder,
  confirmFoodOrder,
  createFoodCategory,
  createFoodOrder,
  createMenuItem,
  deactivateFoodCategory,
  deactivateMenuItem,
  getFoodSettings,
  getMyFoodOrder,
  getMerchantDetail,
  getMyMerchant,
  listMerchantFoodOrders,
  listMerchants,
  listMyFoodOrders,
  listRunnerFoodOrders,
  payFoodOrder,
  quoteFoodOrder,
  rejectMerchantFoodOrder,
  updateFoodDeliveryStatus,
  updateFoodCategory,
  updateMerchantFoodOrder,
  updateMenuItem,
  updateMyMerchant,
} from "../controllers/food.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";

const router = Router();

router.get("/settings", requireAuth, getFoodSettings);
router.get("/merchants", requireAuth, listMerchants);
router.get("/merchants/:merchantId", requireAuth, getMerchantDetail);
router.post("/merchant/apply", requireAuth, applyMerchant);
router.get("/merchant/my", requireAuth, getMyMerchant);
router.put("/merchant/:merchantId", requireAuth, updateMyMerchant);
router.post("/merchant/:merchantId/categories", requireAuth, createFoodCategory);
router.put("/merchant/:merchantId/categories/:categoryId", requireAuth, updateFoodCategory);
router.delete("/merchant/:merchantId/categories/:categoryId", requireAuth, deactivateFoodCategory);
router.post("/merchant/:merchantId/menu", requireAuth, createMenuItem);
router.put("/merchant/:merchantId/menu/:itemId", requireAuth, updateMenuItem);
router.delete("/merchant/:merchantId/menu/:itemId", requireAuth, deactivateMenuItem);
router.get("/merchant/:merchantId/orders", requireAuth, listMerchantFoodOrders);
router.post("/merchant/:merchantId/orders/:orderId/status", requireAuth, updateMerchantFoodOrder);
router.post("/merchant/:merchantId/orders/:orderId/reject", requireAuth, rejectMerchantFoodOrder);
router.post("/orders/quote", requireAuth, quoteFoodOrder);
router.post("/orders", requireAuth, createFoodOrder);
router.get("/orders/my", requireAuth, listMyFoodOrders);
router.get("/orders/:orderId", requireAuth, getMyFoodOrder);
router.post("/orders/:orderId/pay", requireAuth, payFoodOrder);
router.post("/orders/:orderId/cancel", requireAuth, cancelFoodOrder);
router.post("/orders/:orderId/confirm", requireAuth, confirmFoodOrder);
router.get("/runner/orders", requireAuth, requireRole("RUNNER"), listRunnerFoodOrders);
router.post("/runner/orders/:orderId/accept", requireAuth, requireRole("RUNNER"), acceptFoodOrder);
router.post("/runner/orders/:orderId/status", requireAuth, requireRole("RUNNER"), updateFoodDeliveryStatus);

export default router;
