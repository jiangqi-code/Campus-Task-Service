import { Router } from "express";
import {
  acceptFoodOrder,
  applyMerchant,
  cancelFoodOrder,
  createFoodOrder,
  createMenuItem,
  deactivateMenuItem,
  getFoodSettings,
  getMerchantDetail,
  getMyMerchant,
  listMerchantFoodOrders,
  listMerchants,
  listMyFoodOrders,
  listRunnerFoodOrders,
  payFoodOrder,
  updateFoodDeliveryStatus,
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
router.post("/merchant/:merchantId/menu", requireAuth, createMenuItem);
router.put("/merchant/:merchantId/menu/:itemId", requireAuth, updateMenuItem);
router.delete("/merchant/:merchantId/menu/:itemId", requireAuth, deactivateMenuItem);
router.get("/merchant/:merchantId/orders", requireAuth, listMerchantFoodOrders);
router.post("/orders", requireAuth, createFoodOrder);
router.get("/orders/my", requireAuth, listMyFoodOrders);
router.post("/orders/:orderId/pay", requireAuth, payFoodOrder);
router.post("/orders/:orderId/cancel", requireAuth, cancelFoodOrder);
router.get("/runner/orders", requireAuth, requireRole("RUNNER"), listRunnerFoodOrders);
router.post("/runner/orders/:orderId/accept", requireAuth, requireRole("RUNNER"), acceptFoodOrder);
router.post("/runner/orders/:orderId/status", requireAuth, requireRole("RUNNER"), updateFoodDeliveryStatus);

export default router;
