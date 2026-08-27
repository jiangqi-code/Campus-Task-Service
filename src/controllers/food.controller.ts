import type { RequestHandler } from "express";
import { FoodError, foodService } from "../services/food.service";

const parseId = (value: unknown, label: string) => {
  const id = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0) throw new FoodError(400, `${label}不合法`);
  return id;
};

const merchantId = (req: any) => parseId(req.params.merchantId ?? req.params.id, "商家 ID");
const orderId = (req: any) => parseId(req.params.orderId ?? req.params.id, "订单 ID");
const itemId = (req: any) => parseId(req.params.itemId ?? req.params.id, "菜品 ID");

const handleError = (error: unknown, res: any, next: any) => {
  if (error instanceof FoodError) return res.status(error.status).json({ error: error.message });
  next(error);
};

export const getFoodSettings: RequestHandler = async (_req, res, next) => {
  try { res.status(200).json(await foodService.getSettings()); } catch (error) { handleError(error, res, next); }
};

export const listMerchants: RequestHandler = async (req, res, next) => {
  try {
    res.status(200).json(await foodService.listMerchants({ page: req.query.page, pageSize: req.query.pageSize ?? req.query.page_size, keyword: req.query.keyword }));
  } catch (error) { handleError(error, res, next); }
};

export const getMerchantDetail: RequestHandler = async (req, res, next) => {
  try {
    res.status(200).json(await foodService.getMerchantDetail({ merchantId: merchantId(req), viewerId: req.user?.id, isAdmin: req.user?.role === "ADMIN" }));
  } catch (error) { handleError(error, res, next); }
};

export const applyMerchant: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const merchant = await foodService.applyMerchant({ ownerId: req.user.id, name: body.name, description: body.description, logo: body.logo, address: body.address, phone: body.phone });
    res.status(201).json({ merchant });
  } catch (error) { handleError(error, res, next); }
};

export const getMyMerchant: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    res.status(200).json({ data: await foodService.getMyMerchant(req.user.id) });
  } catch (error) { handleError(error, res, next); }
};

export const updateMyMerchant: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const merchant = await foodService.updateMyMerchant({ ownerId: req.user.id, merchantId: merchantId(req), name: body.name, description: body.description, logo: body.logo, address: body.address, phone: body.phone, isOpen: body.is_open ?? body.isOpen });
    res.status(200).json({ merchant });
  } catch (error) { handleError(error, res, next); }
};

export const createMenuItem: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const item = await foodService.createMenuItem({ ownerId: req.user.id, merchantId: merchantId(req), name: body.name, description: body.description, image: body.image, price: body.price, stock: body.stock, sortOrder: body.sort_order ?? body.sortOrder });
    res.status(201).json({ item });
  } catch (error) { handleError(error, res, next); }
};

export const updateMenuItem: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const item = await foodService.updateMenuItem({ ownerId: req.user.id, merchantId: merchantId(req), itemId: itemId(req), name: body.name, description: body.description, image: body.image, price: body.price, stock: body.stock, sortOrder: body.sort_order ?? body.sortOrder, isActive: body.is_active ?? body.isActive });
    res.status(200).json({ item });
  } catch (error) { handleError(error, res, next); }
};

export const deactivateMenuItem: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    await foodService.deactivateMenuItem({ ownerId: req.user.id, merchantId: merchantId(req), itemId: itemId(req) });
    res.status(200).json({ success: true });
  } catch (error) { handleError(error, res, next); }
};

export const createFoodOrder: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const order = await foodService.createOrder({ userId: req.user.id, merchantId: body.merchant_id ?? body.merchantId, items: body.items, deliveryAddress: body.delivery_address ?? body.deliveryAddress, deliveryLat: body.delivery_lat ?? body.deliveryLat, deliveryLng: body.delivery_lng ?? body.deliveryLng, contactPhone: body.contact_phone ?? body.contactPhone, remark: body.remark });
    res.status(201).json({ order });
  } catch (error) { handleError(error, res, next); }
};

export const payFoodOrder: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    res.status(200).json({ order: await foodService.payOrder({ orderId: orderId(req), userId: req.user.id }) });
  } catch (error) { handleError(error, res, next); }
};

export const cancelFoodOrder: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    res.status(200).json({ order: await foodService.cancelOrder({ orderId: orderId(req), userId: req.user.id, reason: (req.body ?? {}).reason }) });
  } catch (error) { handleError(error, res, next); }
};

export const listMyFoodOrders: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    res.status(200).json(await foodService.listUserOrders({ userId: req.user.id, page: req.query.page, pageSize: req.query.pageSize ?? req.query.page_size }));
  } catch (error) { handleError(error, res, next); }
};

export const listRunnerFoodOrders: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    res.status(200).json(await foodService.listRunnerOrders({ runnerId: req.user.id, available: req.query.available, page: req.query.page, pageSize: req.query.pageSize ?? req.query.page_size }));
  } catch (error) { handleError(error, res, next); }
};

export const acceptFoodOrder: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    res.status(200).json({ order: await foodService.acceptOrder({ orderId: orderId(req), runnerId: req.user.id }) });
  } catch (error) { handleError(error, res, next); }
};

export const updateFoodDeliveryStatus: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    res.status(200).json({ order: await foodService.updateDeliveryStatus({ orderId: orderId(req), runnerId: req.user.id, action: (req.body ?? {}).action }) });
  } catch (error) { handleError(error, res, next); }
};

export const listMerchantFoodOrders: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    res.status(200).json(await foodService.listMerchantOrders({ ownerId: req.user.id, merchantId: merchantId(req), page: req.query.page, pageSize: req.query.pageSize ?? req.query.page_size }));
  } catch (error) { handleError(error, res, next); }
};

export const listAdminFoodMerchants: RequestHandler = async (req, res, next) => {
  try { res.status(200).json(await foodService.listAdminMerchants({ page: req.query.page, pageSize: req.query.pageSize ?? req.query.page_size, status: req.query.status, keyword: req.query.keyword })); } catch (error) { handleError(error, res, next); }
};

export const auditFoodMerchant: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const body = (req.body ?? {}) as Record<string, unknown>;
    await foodService.auditMerchant({ merchantId: merchantId(req), adminId: req.user.id, action: body.action, auditNote: body.audit_note ?? body.auditNote, commissionRate: body.commission_rate ?? body.commissionRate });
    res.status(200).json({ success: true });
  } catch (error) { handleError(error, res, next); }
};

export const listAdminFoodOrders: RequestHandler = async (req, res, next) => {
  try { res.status(200).json(await foodService.listAdminOrders({ page: req.query.page, pageSize: req.query.pageSize ?? req.query.page_size, status: req.query.status, merchantId: req.query.merchant_id ?? req.query.merchantId })); } catch (error) { handleError(error, res, next); }
};

export const updateFoodSettings: RequestHandler = async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.status(200).json(await foodService.updateSettings({
      deliveryFee: body.food_delivery_fee ?? body.delivery_fee,
      commissionRate: body.food_platform_commission_rate ?? body.commission_rate,
      runnerCompletionReward: body.food_runner_completion_reward ?? body.runner_completion_reward,
    }));
  } catch (error) { handleError(error, res, next); }
};
