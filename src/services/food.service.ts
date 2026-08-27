import { FoodOrderStatus, MerchantStatus, Prisma, PrismaClient } from "@prisma/client";
import { sensitiveWordService } from "./sensitiveWord.service";
import { notificationService } from "./notification.service";

const prisma = new PrismaClient();

const defaultSettings = {
  food_delivery_fee: "2",
  food_platform_commission_rate: "0.1",
  food_runner_completion_reward: "0",
} as const;

export class FoodError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const intOr = (value: unknown, fallback: number) => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number.parseInt(value.trim(), 10);
  return fallback;
};

const positiveId = (value: unknown, label: string) => {
  const id = intOr(value, 0);
  if (id <= 0) throw new FoodError(400, `${label}不合法`);
  return id;
};

const stringValue = (value: unknown) => (value === undefined || value === null ? "" : String(value).trim());

const decimal = (value: unknown, field: string, min = 0) => {
  const parsed = new Prisma.Decimal(value === undefined || value === null || value === "" ? "NaN" : String(value));
  if (!parsed.isFinite() || parsed.lt(min)) throw new FoodError(400, `${field}不合法`);
  return parsed;
};

const coordinate = (value: unknown, min: number, max: number, label: string) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new FoodError(400, `${label}不合法`);
  return parsed;
};

const normalizeImage = (value: unknown) => {
  const image = stringValue(value);
  if (!image) return null;
  if (image.length > 500 || (!/^https?:\/\//i.test(image) && !image.startsWith("/uploads/"))) {
    throw new FoodError(400, "图片地址不合法");
  }
  return image;
};

const parsePage = (page: unknown, pageSize: unknown, max = 50) => {
  const safePage = Math.max(1, intOr(page, 1));
  const safePageSize = Math.min(max, Math.max(1, intOr(pageSize, 10)));
  return { page: safePage, pageSize: safePageSize, skip: (safePage - 1) * safePageSize };
};

const toNumber = (value: Prisma.Decimal | number | null | undefined) => Number(value ?? 0);

const mapMerchant = (merchant: any) => ({
  id: merchant.id,
  owner_id: merchant.owner_id,
  name: merchant.name,
  description: merchant.description,
  logo: merchant.logo,
  address: merchant.address,
  phone: merchant.phone,
  status: merchant.status,
  audit_note: merchant.audit_note,
  commission_rate: toNumber(merchant.commission_rate),
  is_open: merchant.is_open,
  created_at: merchant.created_at,
  updated_at: merchant.updated_at,
  owner: merchant.owner,
  menu_item_count: merchant._count?.menu_items,
});

const mapMenuItem = (item: any) => ({
  id: item.id,
  merchant_id: item.merchant_id,
  name: item.name,
  description: item.description,
  image: item.image,
  price: toNumber(item.price),
  stock: item.stock,
  is_active: item.is_active,
  sort_order: item.sort_order,
  created_at: item.created_at,
  updated_at: item.updated_at,
});

const mapFoodOrder = (order: any) => ({
  id: order.id,
  user_id: order.user_id,
  merchant_id: order.merchant_id,
  runner_id: order.runner_id,
  status: order.status,
  delivery_address: order.delivery_address,
  delivery_lat: order.delivery_lat,
  delivery_lng: order.delivery_lng,
  contact_phone: order.contact_phone,
  remark: order.remark,
  item_amount: toNumber(order.item_amount),
  delivery_fee: toNumber(order.delivery_fee),
  commission_rate: toNumber(order.commission_rate),
  commission_amount: toNumber(order.commission_amount),
  total_amount: toNumber(order.total_amount),
  payment_at: order.payment_at,
  accept_time: order.accept_time,
  pickup_time: order.pickup_time,
  delivery_start_time: order.delivery_start_time,
  complete_time: order.complete_time,
  cancelled_at: order.cancelled_at,
  cancel_reason: order.cancel_reason,
  created_at: order.created_at,
  merchant: order.merchant ? mapMerchant(order.merchant) : undefined,
  user: order.user,
  runner: order.runner,
  items: Array.isArray(order.items)
    ? order.items.map((item: any) => ({ id: item.id, menu_item_id: item.menu_item_id, item_name: item.item_name, unit_price: toNumber(item.unit_price), quantity: item.quantity }))
    : [],
});

const orderInclude = {
  merchant: { select: { id: true, name: true, logo: true, address: true, phone: true, is_open: true, status: true, commission_rate: true } },
  user: { select: { id: true, nickname: true, phone: true } },
  runner: { select: { id: true, nickname: true, phone: true } },
  items: { orderBy: { id: "asc" as const } },
};

const ensureSettings = async () => {
  await Promise.all(
    Object.entries(defaultSettings).map(([key, value]) =>
      prisma.systemConfig.upsert({ where: { key }, update: {}, create: { key, value } }),
    ),
  );
};

const getSettings = async () => {
  await ensureSettings();
  const rows = await prisma.systemConfig.findMany({ where: { key: { in: Object.keys(defaultSettings) } }, select: { key: true, value: true } });
  const map = new Map(rows.map((row) => [row.key, row.value]));
  const deliveryFee = decimal(map.get("food_delivery_fee") ?? defaultSettings.food_delivery_fee, "外卖配送费");
  const commissionRate = decimal(map.get("food_platform_commission_rate") ?? defaultSettings.food_platform_commission_rate, "平台抽成");
  const runnerCompletionReward = decimal(map.get("food_runner_completion_reward") ?? defaultSettings.food_runner_completion_reward, "跑腿员完成配送奖励");
  if (commissionRate.gt(0.8)) throw new FoodError(500, "外卖抽成配置异常");
  return { deliveryFee, commissionRate, runnerCompletionReward };
};

const ensureSafeText = async (value: string, label: string) => {
  if (!value) return;
  const match = await sensitiveWordService.matchText(value);
  if (match.matched) throw new FoodError(400, `${label}包含敏感词，请修改后再提交`);
};

const getOwnedMerchant = async (merchantId: number, ownerId: number) => {
  const merchant = await prisma.merchant.findUnique({ where: { id: merchantId } });
  if (!merchant) throw new FoodError(404, "商家不存在");
  if (merchant.owner_id !== ownerId) throw new FoodError(403, "无权操作该商家");
  return merchant;
};

export class FoodService {
  async getSettings() {
    const settings = await getSettings();
    return {
      food_delivery_fee: toNumber(settings.deliveryFee),
      food_platform_commission_rate: toNumber(settings.commissionRate),
      food_runner_completion_reward: toNumber(settings.runnerCompletionReward),
    };
  }

  async updateSettings(input: { deliveryFee?: unknown; commissionRate?: unknown; runnerCompletionReward?: unknown }) {
    const updates: Array<{ key: string; value: string }> = [];
    if (input.deliveryFee !== undefined) updates.push({ key: "food_delivery_fee", value: decimal(input.deliveryFee, "外卖配送费").toFixed(2) });
    if (input.commissionRate !== undefined) {
      const rate = decimal(input.commissionRate, "平台抽成");
      if (rate.gt(0.8)) throw new FoodError(400, "平台抽成不能超过 80% ");
      updates.push({ key: "food_platform_commission_rate", value: rate.toFixed(4) });
    }
    if (input.runnerCompletionReward !== undefined) {
      updates.push({ key: "food_runner_completion_reward", value: decimal(input.runnerCompletionReward, "跑腿员完成配送奖励").toFixed(2) });
    }
    if (!updates.length) throw new FoodError(400, "没有可更新的配置");
    await Promise.all(updates.map((item) => prisma.systemConfig.upsert({ where: { key: item.key }, update: { value: item.value }, create: item })));
    return this.getSettings();
  }

  async listMerchants(input: { page?: unknown; pageSize?: unknown; keyword?: unknown }) {
    const { page, pageSize, skip } = parsePage(input.page, input.pageSize);
    const keyword = stringValue(input.keyword).slice(0, 50);
    const where: Prisma.MerchantWhereInput = {
      status: MerchantStatus.APPROVED,
      is_open: true,
      ...(keyword ? { OR: [{ name: { contains: keyword } }, { address: { contains: keyword } }] } : {}),
    };
    const [total, merchants] = await Promise.all([
      prisma.merchant.count({ where }),
      prisma.merchant.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take: pageSize,
        include: { _count: { select: { menu_items: { where: { is_active: true } } } } },
      }),
    ]);
    return { page, page_size: pageSize, total, list: merchants.map(mapMerchant) };
  }

  async getMerchantDetail(input: { merchantId: number; viewerId?: number; isAdmin?: boolean }) {
    const merchant = await prisma.merchant.findUnique({
      where: { id: input.merchantId },
      include: {
        _count: { select: { menu_items: true } },
        menu_items: { where: { is_active: true }, orderBy: [{ sort_order: "asc" }, { id: "asc" }] },
      },
    });
    if (!merchant) throw new FoodError(404, "商家不存在");
    const canView = merchant.status === MerchantStatus.APPROVED || merchant.owner_id === input.viewerId || input.isAdmin;
    if (!canView) throw new FoodError(404, "商家暂不可见");
    return { merchant: mapMerchant(merchant), menu_items: merchant.menu_items.map(mapMenuItem) };
  }

  async applyMerchant(input: { ownerId: number; name: unknown; description?: unknown; logo?: unknown; address: unknown; phone?: unknown }) {
    const name = stringValue(input.name);
    const description = stringValue(input.description);
    const address = stringValue(input.address);
    const phone = stringValue(input.phone);
    const logo = normalizeImage(input.logo);
    if (name.length < 2 || name.length > 80) throw new FoodError(400, "商家名称应为 2-80 个字符");
    if (!address || address.length > 160) throw new FoodError(400, "请填写 1-160 个字符的商家地址");
    if (description.length > 2000 || phone.length > 30) throw new FoodError(400, "商家资料长度不合法");
    await Promise.all([ensureSafeText(name, "商家名称"), ensureSafeText(description, "商家介绍")]);
    const existing = await prisma.merchant.findFirst({
      where: { owner_id: input.ownerId, status: { in: [MerchantStatus.PENDING, MerchantStatus.APPROVED] } },
      select: { id: true },
    });
    if (existing) throw new FoodError(409, "当前账号已有待审核或已通过的商家");
    const settings = await getSettings();
    const merchant = await prisma.merchant.create({
      data: { owner_id: input.ownerId, name, description: description || null, logo, address, phone: phone || null, commission_rate: settings.commissionRate },
      include: { _count: { select: { menu_items: true } } },
    });
    return mapMerchant(merchant);
  }

  async getMyMerchant(ownerId: number) {
    const merchant = await prisma.merchant.findFirst({
      where: { owner_id: ownerId },
      orderBy: { updated_at: "desc" },
      include: { _count: { select: { menu_items: true } }, menu_items: { orderBy: [{ sort_order: "asc" }, { id: "asc" }] } },
    });
    if (!merchant) return null;
    return { merchant: mapMerchant(merchant), menu_items: merchant.menu_items.map(mapMenuItem) };
  }

  async updateMyMerchant(input: { ownerId: number; merchantId: number; name?: unknown; description?: unknown; logo?: unknown; address?: unknown; phone?: unknown; isOpen?: unknown }) {
    const merchant = await getOwnedMerchant(input.merchantId, input.ownerId);
    if (merchant.status === MerchantStatus.DISABLED) throw new FoodError(409, "商家已被停用");
    const data: Prisma.MerchantUpdateInput = {};
    if (input.name !== undefined) {
      const name = stringValue(input.name);
      if (name.length < 2 || name.length > 80) throw new FoodError(400, "商家名称应为 2-80 个字符");
      await ensureSafeText(name, "商家名称");
      data.name = name;
    }
    if (input.description !== undefined) {
      const description = stringValue(input.description);
      if (description.length > 2000) throw new FoodError(400, "商家介绍不能超过 2000 个字符");
      await ensureSafeText(description, "商家介绍");
      data.description = description || null;
    }
    if (input.logo !== undefined) data.logo = normalizeImage(input.logo);
    if (input.address !== undefined) {
      const address = stringValue(input.address);
      if (!address || address.length > 160) throw new FoodError(400, "请填写 1-160 个字符的商家地址");
      data.address = address;
    }
    if (input.phone !== undefined) {
      const phone = stringValue(input.phone);
      if (phone.length > 30) throw new FoodError(400, "联系电话不合法");
      data.phone = phone || null;
    }
    if (input.isOpen !== undefined) data.is_open = input.isOpen === true || String(input.isOpen).toLowerCase() === "true" || String(input.isOpen) === "1";
    const updated = await prisma.merchant.update({ where: { id: merchant.id }, data, include: { _count: { select: { menu_items: true } } } });
    return mapMerchant(updated);
  }

  async createMenuItem(input: { ownerId: number; merchantId: number; name: unknown; description?: unknown; image?: unknown; price: unknown; stock?: unknown; sortOrder?: unknown }) {
    const merchant = await getOwnedMerchant(input.merchantId, input.ownerId);
    if (merchant.status === MerchantStatus.DISABLED) throw new FoodError(409, "商家已被停用");
    const name = stringValue(input.name);
    const description = stringValue(input.description);
    const itemPrice = decimal(input.price, "菜品价格", 0.01).toDecimalPlaces(2);
    const stock = input.stock === undefined || input.stock === "" ? -1 : intOr(input.stock, -2);
    if (name.length < 1 || name.length > 100 || description.length > 500 || stock < -1) throw new FoodError(400, "菜品信息不合法");
    await Promise.all([ensureSafeText(name, "菜品名称"), ensureSafeText(description, "菜品介绍")]);
    const item = await prisma.menuItem.create({
      data: { merchant_id: merchant.id, name, description: description || null, image: normalizeImage(input.image), price: itemPrice, stock, sort_order: intOr(input.sortOrder, 0) },
    });
    return mapMenuItem(item);
  }

  async updateMenuItem(input: { ownerId: number; merchantId: number; itemId: number; name?: unknown; description?: unknown; image?: unknown; price?: unknown; stock?: unknown; sortOrder?: unknown; isActive?: unknown }) {
    await getOwnedMerchant(input.merchantId, input.ownerId);
    const item = await prisma.menuItem.findFirst({ where: { id: input.itemId, merchant_id: input.merchantId } });
    if (!item) throw new FoodError(404, "菜品不存在");
    const data: Prisma.MenuItemUpdateInput = {};
    if (input.name !== undefined) {
      const name = stringValue(input.name);
      if (!name || name.length > 100) throw new FoodError(400, "菜品名称应为 1-100 个字符");
      await ensureSafeText(name, "菜品名称");
      data.name = name;
    }
    if (input.description !== undefined) {
      const description = stringValue(input.description);
      if (description.length > 500) throw new FoodError(400, "菜品介绍不能超过 500 个字符");
      await ensureSafeText(description, "菜品介绍");
      data.description = description || null;
    }
    if (input.image !== undefined) data.image = normalizeImage(input.image);
    if (input.price !== undefined) data.price = decimal(input.price, "菜品价格", 0.01).toDecimalPlaces(2);
    if (input.stock !== undefined) {
      const stock = intOr(input.stock, -2);
      if (stock < -1) throw new FoodError(400, "库存不合法");
      data.stock = stock;
    }
    if (input.sortOrder !== undefined) data.sort_order = intOr(input.sortOrder, 0);
    if (input.isActive !== undefined) data.is_active = input.isActive === true || String(input.isActive).toLowerCase() === "true" || String(input.isActive) === "1";
    return mapMenuItem(await prisma.menuItem.update({ where: { id: item.id }, data }));
  }

  async deactivateMenuItem(input: { ownerId: number; merchantId: number; itemId: number }) {
    await getOwnedMerchant(input.merchantId, input.ownerId);
    const updated = await prisma.menuItem.updateMany({ where: { id: input.itemId, merchant_id: input.merchantId }, data: { is_active: false } });
    if (!updated.count) throw new FoodError(404, "菜品不存在");
  }

  async createOrder(input: { userId: number; merchantId: unknown; items: unknown; deliveryAddress: unknown; deliveryLat?: unknown; deliveryLng?: unknown; contactPhone?: unknown; remark?: unknown }) {
    const merchantId = positiveId(input.merchantId, "商家 ID");
    const address = stringValue(input.deliveryAddress);
    const contactPhone = stringValue(input.contactPhone);
    const remark = stringValue(input.remark);
    const deliveryLat = coordinate(input.deliveryLat, -90, 90, "送达纬度");
    const deliveryLng = coordinate(input.deliveryLng, -180, 180, "送达经度");
    if (!address || address.length > 180 || contactPhone.length > 30 || remark.length > 500 || (deliveryLat === null) !== (deliveryLng === null)) throw new FoodError(400, "配送信息不合法");
    await Promise.all([ensureSafeText(address, "配送地址"), ensureSafeText(remark, "订单备注")]);
    if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 30) throw new FoodError(400, "请选择 1-30 个菜品");
    const quantities = new Map<number, number>();
    for (const raw of input.items) {
      const itemId = positiveId((raw as any)?.menu_item_id ?? (raw as any)?.menuItemId ?? (raw as any)?.id, "菜品 ID");
      const quantity = intOr((raw as any)?.quantity, 0);
      if (quantity < 1 || quantity > 99) throw new FoodError(400, "菜品数量应为 1-99");
      quantities.set(itemId, (quantities.get(itemId) ?? 0) + quantity);
    }
    const merchant = await prisma.merchant.findFirst({ where: { id: merchantId, status: MerchantStatus.APPROVED, is_open: true } });
    if (!merchant) throw new FoodError(409, "商家暂未营业");
    const menuItems = await prisma.menuItem.findMany({ where: { merchant_id: merchant.id, id: { in: Array.from(quantities.keys()) }, is_active: true } });
    if (menuItems.length !== quantities.size) throw new FoodError(409, "购物车中存在已下架菜品");
    for (const item of menuItems) {
      const quantity = quantities.get(item.id) ?? 0;
      if (item.stock >= 0 && item.stock < quantity) throw new FoodError(409, `${item.name} 库存不足`);
    }
    const settings = await getSettings();
    const itemAmount = menuItems.reduce((sum, item) => sum.plus(item.price.mul(quantities.get(item.id) ?? 0)), new Prisma.Decimal(0)).toDecimalPlaces(2);
    const deliveryFee = settings.deliveryFee.toDecimalPlaces(2);
    const commissionRate = merchant.commission_rate.toDecimalPlaces(4);
    const commissionAmount = itemAmount.mul(commissionRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const totalAmount = itemAmount.plus(deliveryFee).toDecimalPlaces(2);
    const order = await prisma.foodOrder.create({
      data: {
        user_id: input.userId,
        merchant_id: merchant.id,
        delivery_address: address,
        delivery_lat: deliveryLat,
        delivery_lng: deliveryLng,
        contact_phone: contactPhone || null,
        remark: remark || null,
        item_amount: itemAmount,
        delivery_fee: deliveryFee,
        commission_rate: commissionRate,
        commission_amount: commissionAmount,
        total_amount: totalAmount,
        items: { create: menuItems.map((item) => ({ menu_item_id: item.id, item_name: item.name, unit_price: item.price, quantity: quantities.get(item.id) ?? 0 })) },
      },
      include: orderInclude,
    });
    return mapFoodOrder(order);
  }

  async payOrder(input: { orderId: number; userId: number }) {
    const paid = await prisma.$transaction(async (tx) => {
      const order = await tx.foodOrder.findUnique({ where: { id: input.orderId }, include: { items: true } });
      if (!order) throw new FoodError(404, "外卖订单不存在");
      if (order.user_id !== input.userId) throw new FoodError(403, "无权支付该订单");
      if (order.status !== FoodOrderStatus.PENDING_PAYMENT) throw new FoodError(409, "当前订单不可支付");
      const wallet = await tx.userWallet.upsert({ where: { user_id: input.userId }, update: {}, create: { user_id: input.userId } });
      if (wallet.balance.lt(order.total_amount)) throw new FoodError(409, "钱包余额不足，请先充值");
      for (const item of order.items) {
        if (!item.menu_item_id) continue;
        const result = await tx.menuItem.updateMany({ where: { id: item.menu_item_id, OR: [{ stock: -1 }, { stock: { gte: item.quantity } }] }, data: { stock: { decrement: item.quantity } } });
        if (!result.count) throw new FoodError(409, `${item.item_name} 库存不足，请重新下单`);
      }
      const beforeBalance = wallet.balance;
      const afterBalance = beforeBalance.minus(order.total_amount);
      await tx.userWallet.update({ where: { id: wallet.id }, data: { balance: afterBalance } });
      await tx.walletLog.create({ data: { wallet_id: wallet.id, type: "FOOD_ORDER_PAY", amount: order.total_amount.negated(), before_balance: beforeBalance, after_balance: afterBalance } });
      return tx.foodOrder.update({ where: { id: order.id }, data: { status: FoodOrderStatus.PAID, payment_at: new Date() }, include: orderInclude });
    });
    void notificationService.notifyFoodOrderStatusChanged({ orderId: paid.id, fromStatus: FoodOrderStatus.PENDING_PAYMENT, toStatus: FoodOrderStatus.PAID });
    return mapFoodOrder(paid);
  }

  async cancelOrder(input: { orderId: number; userId: number; reason?: unknown }) {
    const reason = stringValue(input.reason);
    if (reason.length > 300) throw new FoodError(400, "取消原因不能超过 300 个字符");
    let fromStatus: FoodOrderStatus = FoodOrderStatus.PENDING_PAYMENT;
    const cancelled = await prisma.$transaction(async (tx) => {
      const order = await tx.foodOrder.findUnique({ where: { id: input.orderId }, include: { items: true } });
      if (!order) throw new FoodError(404, "外卖订单不存在");
      if (order.user_id !== input.userId) throw new FoodError(403, "无权取消该订单");
      if (order.status !== FoodOrderStatus.PENDING_PAYMENT && order.status !== FoodOrderStatus.PAID) {
        throw new FoodError(409, "订单已被接单，无法取消");
      }
      fromStatus = order.status;
      if (order.status === FoodOrderStatus.PAID) {
        const wallet = await tx.userWallet.upsert({ where: { user_id: input.userId }, update: {}, create: { user_id: input.userId } });
        const beforeBalance = wallet.balance;
        const afterBalance = beforeBalance.plus(order.total_amount);
        await tx.userWallet.update({ where: { id: wallet.id }, data: { balance: afterBalance } });
        await tx.walletLog.create({ data: { wallet_id: wallet.id, type: "FOOD_ORDER_REFUND", amount: order.total_amount, before_balance: beforeBalance, after_balance: afterBalance } });
        for (const item of order.items) if (item.menu_item_id) await tx.menuItem.updateMany({ where: { id: item.menu_item_id, stock: { gte: 0 } }, data: { stock: { increment: item.quantity } } });
      }
      return tx.foodOrder.update({ where: { id: order.id }, data: { status: FoodOrderStatus.CANCELLED, cancelled_at: new Date(), cancel_reason: reason || null }, include: orderInclude });
    });
    void notificationService.notifyFoodOrderStatusChanged({ orderId: cancelled.id, fromStatus, toStatus: FoodOrderStatus.CANCELLED });
    return mapFoodOrder(cancelled);
  }

  async listUserOrders(input: { userId: number; page?: unknown; pageSize?: unknown }) {
    const { page, pageSize, skip } = parsePage(input.page, input.pageSize);
    const where = { user_id: input.userId };
    const [total, orders] = await Promise.all([
      prisma.foodOrder.count({ where }),
      prisma.foodOrder.findMany({ where, orderBy: { created_at: "desc" }, skip, take: pageSize, include: orderInclude }),
    ]);
    return { page, page_size: pageSize, total, list: orders.map(mapFoodOrder) };
  }

  async listRunnerOrders(input: { runnerId: number; available?: unknown; page?: unknown; pageSize?: unknown }) {
    const { page, pageSize, skip } = parsePage(input.page, input.pageSize);
    const available = input.available === true || String(input.available).toLowerCase() === "true" || String(input.available) === "1";
    const where: Prisma.FoodOrderWhereInput = available ? { status: FoodOrderStatus.PAID, runner_id: null } : { runner_id: input.runnerId };
    const [total, orders] = await Promise.all([
      prisma.foodOrder.count({ where }),
      prisma.foodOrder.findMany({ where, orderBy: { created_at: "desc" }, skip, take: pageSize, include: orderInclude }),
    ]);
    return { page, page_size: pageSize, total, list: orders.map(mapFoodOrder) };
  }

  async acceptOrder(input: { orderId: number; runnerId: number }) {
    const updated = await prisma.foodOrder.updateMany({
      where: { id: input.orderId, status: FoodOrderStatus.PAID, runner_id: null },
      data: { status: FoodOrderStatus.ACCEPTED, runner_id: input.runnerId, accept_time: new Date() },
    });
    if (!updated.count) throw new FoodError(409, "该配送单已被其他跑腿员接取");
    const order = await prisma.foodOrder.findUnique({ where: { id: input.orderId }, include: orderInclude });
    void notificationService.notifyFoodOrderStatusChanged({ orderId: input.orderId, fromStatus: FoodOrderStatus.PAID, toStatus: FoodOrderStatus.ACCEPTED });
    return mapFoodOrder(order);
  }

  async updateDeliveryStatus(input: { orderId: number; runnerId: number; action: unknown }) {
    const action = stringValue(input.action).toUpperCase();
    const transitions: Record<string, { from: FoodOrderStatus; to: FoodOrderStatus; time: "pickup_time" | "delivery_start_time" | "complete_time" }> = {
      PICKUP: { from: FoodOrderStatus.ACCEPTED, to: FoodOrderStatus.PICKED, time: "pickup_time" },
      DELIVER: { from: FoodOrderStatus.PICKED, to: FoodOrderStatus.DELIVERING, time: "delivery_start_time" },
      COMPLETE: { from: FoodOrderStatus.DELIVERING, to: FoodOrderStatus.COMPLETED, time: "complete_time" },
    };
    const transition = transitions[action];
    if (!transition) throw new FoodError(400, "action 必须为 pickup、deliver 或 complete");
    const now = new Date();
    const settings = transition.to === FoodOrderStatus.COMPLETED ? await getSettings() : null;
    const order = await prisma.$transaction(async (tx) => {
      const current = await tx.foodOrder.findFirst({ where: { id: input.orderId, runner_id: input.runnerId, status: transition.from }, include: { items: true } });
      if (!current) throw new FoodError(409, "订单状态已变化，无法执行该操作");
      const updated = await tx.foodOrder.update({ where: { id: current.id }, data: { status: transition.to, [transition.time]: now }, include: orderInclude });
      const earningAmount = current.delivery_fee.plus(settings?.runnerCompletionReward ?? 0).toDecimalPlaces(2);
      if (transition.to === FoodOrderStatus.COMPLETED && earningAmount.gt(0)) {
        const wallet = await tx.userWallet.upsert({ where: { user_id: input.runnerId }, update: {}, create: { user_id: input.runnerId } });
        const beforeBalance = wallet.balance;
        const afterBalance = beforeBalance.plus(earningAmount);
        await tx.userWallet.update({ where: { id: wallet.id }, data: { balance: afterBalance } });
        await tx.walletLog.create({ data: { wallet_id: wallet.id, type: "FOOD_DELIVERY_EARNING", amount: earningAmount, before_balance: beforeBalance, after_balance: afterBalance } });
        await tx.earning.create({ data: { user_id: input.runnerId, amount: earningAmount, type: "FOOD_DELIVERY", status: "SETTLED", settled_at: now } });
      }
      return updated;
    });
    void notificationService.notifyFoodOrderStatusChanged({ orderId: order.id, fromStatus: transition.from, toStatus: transition.to });
    return mapFoodOrder(order);
  }

  async listMerchantOrders(input: { ownerId: number; merchantId: number; page?: unknown; pageSize?: unknown }) {
    await getOwnedMerchant(input.merchantId, input.ownerId);
    const { page, pageSize, skip } = parsePage(input.page, input.pageSize);
    const where = { merchant_id: input.merchantId };
    const [total, orders] = await Promise.all([
      prisma.foodOrder.count({ where }),
      prisma.foodOrder.findMany({ where, orderBy: { created_at: "desc" }, skip, take: pageSize, include: orderInclude }),
    ]);
    return { page, page_size: pageSize, total, list: orders.map(mapFoodOrder) };
  }

  async listAdminMerchants(input: { page?: unknown; pageSize?: unknown; status?: unknown; keyword?: unknown }) {
    const { page, pageSize, skip } = parsePage(input.page, input.pageSize, 100);
    const statusValue = stringValue(input.status).toUpperCase();
    const status = statusValue ? (Object.values(MerchantStatus) as string[]).includes(statusValue) ? (statusValue as MerchantStatus) : null : undefined;
    if (status === null) throw new FoodError(400, "商家状态不合法");
    const keyword = stringValue(input.keyword).slice(0, 50);
    const where: Prisma.MerchantWhereInput = { ...(status ? { status } : {}), ...(keyword ? { OR: [{ name: { contains: keyword } }, { owner: { nickname: { contains: keyword } } }] } : {}) };
    const [total, merchants] = await Promise.all([
      prisma.merchant.count({ where }),
      prisma.merchant.findMany({ where, orderBy: [{ status: "asc" }, { created_at: "desc" }], skip, take: pageSize, include: { owner: { select: { id: true, nickname: true, phone: true } }, _count: { select: { menu_items: true } } } }),
    ]);
    return { page, page_size: pageSize, total, list: merchants.map(mapMerchant) };
  }

  async auditMerchant(input: { merchantId: number; adminId: number; action: unknown; auditNote?: unknown; commissionRate?: unknown }) {
    const action = stringValue(input.action).toUpperCase();
    const statusMap: Record<string, MerchantStatus> = { APPROVE: MerchantStatus.APPROVED, REJECT: MerchantStatus.REJECTED, DISABLE: MerchantStatus.DISABLED };
    const status = statusMap[action];
    if (!status) throw new FoodError(400, "action 必须为 approve、reject 或 disable");
    const auditNote = stringValue(input.auditNote);
    if (auditNote.length > 300 || (status === MerchantStatus.REJECTED && !auditNote)) throw new FoodError(400, status === MerchantStatus.REJECTED ? "驳回时请填写原因" : "审核说明不能超过 300 个字符");
    const merchant = await prisma.merchant.findUnique({ where: { id: input.merchantId } });
    if (!merchant) throw new FoodError(404, "商家不存在");
    const settings = await getSettings();
    const rate = input.commissionRate === undefined ? merchant.commission_rate : decimal(input.commissionRate, "商家抽成");
    if (rate.gt(0.8)) throw new FoodError(400, "商家抽成不能超过 80% ");
    const now = new Date();
    await prisma.$transaction([
      prisma.merchant.update({ where: { id: merchant.id }, data: { status, audit_note: auditNote || null, commission_rate: action === "APPROVE" && input.commissionRate === undefined ? settings.commissionRate : rate, ...(status === MerchantStatus.DISABLED ? { is_open: false } : {}) } }),
      prisma.adminLog.create({ data: { admin_id: input.adminId, action: "MERCHANT_AUDIT", target_type: "MERCHANT", target_id: merchant.id, detail_json: { action: action.toLowerCase(), audit_note: auditNote || null, commission_rate: rate.toString(), at: now.toISOString() } as Prisma.InputJsonValue } }),
    ]);
  }

  async listAdminOrders(input: { page?: unknown; pageSize?: unknown; status?: unknown; merchantId?: unknown }) {
    const { page, pageSize, skip } = parsePage(input.page, input.pageSize, 100);
    const statusValue = stringValue(input.status).toUpperCase();
    const status = statusValue ? (Object.values(FoodOrderStatus) as string[]).includes(statusValue) ? (statusValue as FoodOrderStatus) : null : undefined;
    if (status === null) throw new FoodError(400, "订单状态不合法");
    const merchantId = input.merchantId === undefined || input.merchantId === "" ? undefined : positiveId(input.merchantId, "商家 ID");
    const where: Prisma.FoodOrderWhereInput = { ...(status ? { status } : {}), ...(merchantId ? { merchant_id: merchantId } : {}) };
    const [total, orders] = await Promise.all([
      prisma.foodOrder.count({ where }),
      prisma.foodOrder.findMany({ where, orderBy: { created_at: "desc" }, skip, take: pageSize, include: orderInclude }),
    ]);
    return { page, page_size: pageSize, total, list: orders.map(mapFoodOrder) };
  }
}

export const foodService = new FoodService();
