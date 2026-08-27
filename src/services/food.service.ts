import { FoodOrderStatus, MerchantStatus, Prisma, PrismaClient } from "@prisma/client";
import { sensitiveWordService } from "./sensitiveWord.service";
import { notificationService } from "./notification.service";

const prisma = new PrismaClient();

const defaultSettings = {
  food_delivery_fee: "2",
  food_platform_commission_rate: "0.1",
  food_runner_completion_reward: "0",
  food_payment_timeout_minutes: "15",
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
  cover_image: merchant.cover_image,
  announcement: merchant.announcement,
  min_order_amount: toNumber(merchant.min_order_amount),
  prepare_minutes: merchant.prepare_minutes,
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
  category_id: item.category_id,
  name: item.name,
  description: item.description,
  image: item.image,
  price: toNumber(item.price),
  original_price: item.original_price === null || item.original_price === undefined ? null : toNumber(item.original_price),
  stock: item.stock,
  is_active: item.is_active,
  sort_order: item.sort_order,
  created_at: item.created_at,
  updated_at: item.updated_at,
});

const mapFoodCategory = (category: any) => ({
  id: category.id,
  merchant_id: category.merchant_id,
  name: category.name,
  sort_order: category.sort_order,
  is_active: category.is_active,
  created_at: category.created_at,
  updated_at: category.updated_at,
});

const mapFoodOrder = (order: any) => ({
  id: order.id,
  order_no: order.order_no,
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
  discount_amount: toNumber(order.discount_amount),
  commission_rate: toNumber(order.commission_rate),
  commission_amount: toNumber(order.commission_amount),
  total_amount: toNumber(order.total_amount),
  payable_amount: toNumber(order.payable_amount),
  merchant_income: toNumber(order.merchant_income),
  runner_income: toNumber(order.runner_income),
  platform_income: toNumber(order.platform_income),
  pickup_code: order.pickup_code,
  payment_expire_at: order.payment_expire_at,
  payment_at: order.payment_at,
  accept_time: order.accept_time,
  pickup_time: order.pickup_time,
  delivery_start_time: order.delivery_start_time,
  delivered_at: order.delivered_at,
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
  timeline: Array.isArray(order.timelines)
    ? order.timelines.map((row: any) => ({ id: row.id, from_status: row.from_status, to_status: row.to_status, actor_role: row.actor_role, note: row.note, created_at: row.created_at, actor: row.actor }))
    : [],
});

const orderInclude = {
  merchant: { select: { id: true, name: true, logo: true, cover_image: true, address: true, phone: true, is_open: true, status: true, commission_rate: true, prepare_minutes: true } },
  user: { select: { id: true, nickname: true, phone: true } },
  runner: { select: { id: true, nickname: true, phone: true } },
  items: { orderBy: { id: "asc" as const } },
  timelines: { orderBy: { created_at: "asc" as const }, include: { actor: { select: { id: true, nickname: true } } } },
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
  const paymentTimeoutMinutes = intOr(map.get("food_payment_timeout_minutes") ?? defaultSettings.food_payment_timeout_minutes, 15);
  if (commissionRate.gt(0.8)) throw new FoodError(500, "外卖抽成配置异常");
  return { deliveryFee, commissionRate, runnerCompletionReward, paymentTimeoutMinutes: Math.min(60, Math.max(5, paymentTimeoutMinutes)) };
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
      food_payment_timeout_minutes: settings.paymentTimeoutMinutes,
    };
  }

  async updateSettings(input: { deliveryFee?: unknown; commissionRate?: unknown; runnerCompletionReward?: unknown; paymentTimeoutMinutes?: unknown }) {
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
    if (input.paymentTimeoutMinutes !== undefined) {
      const value = intOr(input.paymentTimeoutMinutes, 0);
      if (value < 5 || value > 60) throw new FoodError(400, "支付超时时间应为 5-60 分钟");
      updates.push({ key: "food_payment_timeout_minutes", value: String(value) });
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
        categories: { where: { is_active: true }, orderBy: [{ sort_order: "asc" }, { id: "asc" }] },
        menu_items: { where: { is_active: true }, orderBy: [{ sort_order: "asc" }, { id: "asc" }] },
      },
    });
    if (!merchant) throw new FoodError(404, "商家不存在");
    const canView = merchant.status === MerchantStatus.APPROVED || merchant.owner_id === input.viewerId || input.isAdmin;
    if (!canView) throw new FoodError(404, "商家暂不可见");
    return { merchant: mapMerchant(merchant), categories: merchant.categories.map(mapFoodCategory), menu_items: merchant.menu_items.map(mapMenuItem) };
  }

  async applyMerchant(input: { ownerId: number; name: unknown; description?: unknown; logo?: unknown; coverImage?: unknown; announcement?: unknown; minOrderAmount?: unknown; prepareMinutes?: unknown; address: unknown; phone?: unknown }) {
    const name = stringValue(input.name);
    const description = stringValue(input.description);
    const address = stringValue(input.address);
    const phone = stringValue(input.phone);
    const logo = normalizeImage(input.logo);
    const coverImage = input.coverImage === undefined ? null : normalizeImage(input.coverImage);
    const announcement = stringValue(input.announcement);
    const minOrderAmount = input.minOrderAmount === undefined ? new Prisma.Decimal(0) : decimal(input.minOrderAmount, "起送金额").toDecimalPlaces(2);
    const prepareMinutes = input.prepareMinutes === undefined ? 15 : intOr(input.prepareMinutes, 0);
    if (name.length < 2 || name.length > 80) throw new FoodError(400, "商家名称应为 2-80 个字符");
    if (!address || address.length > 160) throw new FoodError(400, "请填写 1-160 个字符的商家地址");
    if (description.length > 2000 || announcement.length > 500 || phone.length > 30 || prepareMinutes < 1 || prepareMinutes > 180) throw new FoodError(400, "商家资料长度不合法");
    await Promise.all([ensureSafeText(name, "商家名称"), ensureSafeText(description, "商家介绍"), ensureSafeText(announcement, "商家公告")]);
    const existing = await prisma.merchant.findFirst({
      where: { owner_id: input.ownerId, status: { in: [MerchantStatus.PENDING, MerchantStatus.APPROVED] } },
      select: { id: true },
    });
    if (existing) throw new FoodError(409, "当前账号已有待审核或已通过的商家");
    const settings = await getSettings();
    const merchant = await prisma.merchant.create({
      data: { owner_id: input.ownerId, name, description: description || null, logo, cover_image: coverImage, announcement: announcement || null, min_order_amount: minOrderAmount, prepare_minutes: prepareMinutes, address, phone: phone || null, commission_rate: settings.commissionRate },
      include: { _count: { select: { menu_items: true } } },
    });
    return mapMerchant(merchant);
  }

  async getMyMerchant(ownerId: number) {
    const merchant = await prisma.merchant.findFirst({
      where: { owner_id: ownerId },
      orderBy: { updated_at: "desc" },
      include: { _count: { select: { menu_items: true } }, categories: { orderBy: [{ sort_order: "asc" }, { id: "asc" }] }, menu_items: { orderBy: [{ sort_order: "asc" }, { id: "asc" }] } },
    });
    if (!merchant) return null;
    return { merchant: mapMerchant(merchant), categories: merchant.categories.map(mapFoodCategory), menu_items: merchant.menu_items.map(mapMenuItem) };
  }

  async updateMyMerchant(input: { ownerId: number; merchantId: number; name?: unknown; description?: unknown; logo?: unknown; coverImage?: unknown; announcement?: unknown; minOrderAmount?: unknown; prepareMinutes?: unknown; address?: unknown; phone?: unknown; isOpen?: unknown }) {
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
    if (input.coverImage !== undefined) data.cover_image = normalizeImage(input.coverImage);
    if (input.announcement !== undefined) {
      const announcement = stringValue(input.announcement);
      if (announcement.length > 500) throw new FoodError(400, "商家公告不能超过 500 个字符");
      await ensureSafeText(announcement, "商家公告");
      data.announcement = announcement || null;
    }
    if (input.minOrderAmount !== undefined) data.min_order_amount = decimal(input.minOrderAmount, "起送金额").toDecimalPlaces(2);
    if (input.prepareMinutes !== undefined) {
      const prepareMinutes = intOr(input.prepareMinutes, 0);
      if (prepareMinutes < 1 || prepareMinutes > 180) throw new FoodError(400, "预计备餐时间应为 1-180 分钟");
      data.prepare_minutes = prepareMinutes;
    }
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

  async createMenuItem(input: { ownerId: number; merchantId: number; categoryId?: unknown; name: unknown; description?: unknown; image?: unknown; price: unknown; originalPrice?: unknown; stock?: unknown; sortOrder?: unknown }) {
    const merchant = await getOwnedMerchant(input.merchantId, input.ownerId);
    if (merchant.status === MerchantStatus.DISABLED) throw new FoodError(409, "商家已被停用");
    const name = stringValue(input.name);
    const description = stringValue(input.description);
    const itemPrice = decimal(input.price, "菜品价格", 0.01).toDecimalPlaces(2);
    const stock = input.stock === undefined || input.stock === "" ? -1 : intOr(input.stock, -2);
    const categoryId = input.categoryId === undefined || input.categoryId === null || input.categoryId === "" ? null : positiveId(input.categoryId, "分类 ID");
    if (categoryId && !(await prisma.foodCategory.findFirst({ where: { id: categoryId, merchant_id: merchant.id } }))) throw new FoodError(400, "菜品分类不属于当前商家");
    if (name.length < 1 || name.length > 100 || description.length > 500 || stock < -1) throw new FoodError(400, "菜品信息不合法");
    await Promise.all([ensureSafeText(name, "菜品名称"), ensureSafeText(description, "菜品介绍")]);
    const item = await prisma.menuItem.create({
      data: { merchant_id: merchant.id, category_id: categoryId, name, description: description || null, image: normalizeImage(input.image), price: itemPrice, original_price: input.originalPrice === undefined || input.originalPrice === "" ? null : decimal(input.originalPrice, "菜品原价", 0.01).toDecimalPlaces(2), stock, sort_order: intOr(input.sortOrder, 0) },
    });
    return mapMenuItem(item);
  }

  async updateMenuItem(input: { ownerId: number; merchantId: number; itemId: number; categoryId?: unknown; name?: unknown; description?: unknown; image?: unknown; price?: unknown; originalPrice?: unknown; stock?: unknown; sortOrder?: unknown; isActive?: unknown }) {
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
    if (input.categoryId !== undefined) {
      const categoryId = input.categoryId === null || input.categoryId === "" ? null : positiveId(input.categoryId, "分类 ID");
      if (categoryId && !(await prisma.foodCategory.findFirst({ where: { id: categoryId, merchant_id: input.merchantId } }))) throw new FoodError(400, "菜品分类不属于当前商家");
      data.category = categoryId ? { connect: { id: categoryId } } : { disconnect: true };
    }
    if (input.price !== undefined) data.price = decimal(input.price, "菜品价格", 0.01).toDecimalPlaces(2);
    if (input.originalPrice !== undefined) data.original_price = input.originalPrice === null || input.originalPrice === "" ? null : decimal(input.originalPrice, "菜品原价", 0.01).toDecimalPlaces(2);
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

  async createCategory(input: { ownerId: number; merchantId: number; name: unknown; sortOrder?: unknown }) {
    const merchant = await getOwnedMerchant(input.merchantId, input.ownerId);
    if (merchant.status === MerchantStatus.DISABLED) throw new FoodError(409, "商家已被停用");
    const name = stringValue(input.name);
    if (!name || name.length > 60) throw new FoodError(400, "分类名称应为 1-60 个字符");
    await ensureSafeText(name, "菜品分类");
    try {
      return mapFoodCategory(await prisma.foodCategory.create({ data: { merchant_id: merchant.id, name, sort_order: intOr(input.sortOrder, 0) } }));
    } catch (error: any) {
      if (error?.code === "P2002") throw new FoodError(409, "已存在同名分类");
      throw error;
    }
  }

  async updateCategory(input: { ownerId: number; merchantId: number; categoryId: number; name?: unknown; sortOrder?: unknown; isActive?: unknown }) {
    await getOwnedMerchant(input.merchantId, input.ownerId);
    const category = await prisma.foodCategory.findFirst({ where: { id: input.categoryId, merchant_id: input.merchantId } });
    if (!category) throw new FoodError(404, "菜品分类不存在");
    const data: Prisma.FoodCategoryUpdateInput = {};
    if (input.name !== undefined) {
      const name = stringValue(input.name);
      if (!name || name.length > 60) throw new FoodError(400, "分类名称应为 1-60 个字符");
      await ensureSafeText(name, "菜品分类");
      data.name = name;
    }
    if (input.sortOrder !== undefined) data.sort_order = intOr(input.sortOrder, 0);
    if (input.isActive !== undefined) data.is_active = input.isActive === true || String(input.isActive).toLowerCase() === "true" || String(input.isActive) === "1";
    return mapFoodCategory(await prisma.foodCategory.update({ where: { id: category.id }, data }));
  }

  async deactivateCategory(input: { ownerId: number; merchantId: number; categoryId: number }) {
    await getOwnedMerchant(input.merchantId, input.ownerId);
    const updated = await prisma.foodCategory.updateMany({ where: { id: input.categoryId, merchant_id: input.merchantId }, data: { is_active: false } });
    if (!updated.count) throw new FoodError(404, "菜品分类不存在");
  }

  async quoteOrder(input: { merchantId: unknown; items: unknown }) {
    const merchantId = positiveId(input.merchantId, "商家 ID");
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
    if (itemAmount.lt(merchant.min_order_amount)) throw new FoodError(409, `该商家起送金额为 ¥${merchant.min_order_amount.toFixed(2)}`);
    const deliveryFee = settings.deliveryFee.toDecimalPlaces(2);
    const commissionRate = merchant.commission_rate.toDecimalPlaces(4);
    const commissionAmount = itemAmount.mul(commissionRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const totalAmount = itemAmount.plus(deliveryFee).toDecimalPlaces(2);
    return { merchant, menuItems, quantities, settings, itemAmount, deliveryFee, commissionRate, commissionAmount, totalAmount };
  }

  async createOrder(input: { userId: number; merchantId: unknown; items: unknown; deliveryAddress: unknown; deliveryLat?: unknown; deliveryLng?: unknown; contactPhone?: unknown; remark?: unknown }) {
    const address = stringValue(input.deliveryAddress);
    const contactPhone = stringValue(input.contactPhone);
    const remark = stringValue(input.remark);
    const deliveryLat = coordinate(input.deliveryLat, -90, 90, "送达纬度");
    const deliveryLng = coordinate(input.deliveryLng, -180, 180, "送达经度");
    if (!address || address.length > 180 || contactPhone.length > 30 || remark.length > 500 || (deliveryLat === null) !== (deliveryLng === null)) throw new FoodError(400, "配送信息不合法");
    await Promise.all([ensureSafeText(address, "配送地址"), ensureSafeText(remark, "订单备注")]);
    const quote = await this.quoteOrder({ merchantId: input.merchantId, items: input.items });
    const now = new Date();
    const paymentExpireAt = new Date(now.getTime() + quote.settings.paymentTimeoutMinutes * 60 * 1000);
    const orderNo = `FO${now.getTime().toString(36).toUpperCase()}${Math.floor(1000 + Math.random() * 9000)}`;
    const order = await prisma.foodOrder.create({
      data: {
        order_no: orderNo, user_id: input.userId, merchant_id: quote.merchant.id,
        delivery_address: address, delivery_lat: deliveryLat, delivery_lng: deliveryLng, contact_phone: contactPhone || null, remark: remark || null,
        item_amount: quote.itemAmount, delivery_fee: quote.deliveryFee, discount_amount: 0, commission_rate: quote.commissionRate, commission_amount: quote.commissionAmount,
        total_amount: quote.totalAmount, payable_amount: quote.totalAmount, merchant_income: quote.itemAmount.minus(quote.commissionAmount), runner_income: quote.deliveryFee.plus(quote.settings.runnerCompletionReward), platform_income: quote.commissionAmount,
        payment_expire_at: paymentExpireAt,
        items: { create: quote.menuItems.map((item) => ({ menu_item_id: item.id, item_name: item.name, unit_price: item.price, quantity: quote.quantities.get(item.id) ?? 0 })) },
        timelines: { create: { to_status: FoodOrderStatus.PENDING_PAYMENT, actor_id: input.userId, actor_role: "USER", note: "订单已创建，等待支付" } },
      }, include: orderInclude,
    });
    return mapFoodOrder(order);
  }

  async payOrder(input: { orderId: number; userId: number }) {
    const paid = await prisma.$transaction(async (tx) => {
      const order = await tx.foodOrder.findUnique({ where: { id: input.orderId }, include: { items: true } });
      if (!order) throw new FoodError(404, "外卖订单不存在");
      if (order.user_id !== input.userId) throw new FoodError(403, "无权支付该订单");
      if (order.status !== FoodOrderStatus.PENDING_PAYMENT) throw new FoodError(409, "当前订单不可支付");
      if (order.payment_expire_at && order.payment_expire_at <= new Date()) throw new FoodError(409, "订单支付已超时，请重新下单");
      const payableAmount = order.payable_amount.gt(0) ? order.payable_amount : order.total_amount;
      const wallet = await tx.userWallet.upsert({ where: { user_id: input.userId }, update: {}, create: { user_id: input.userId } });
      if (wallet.balance.lt(payableAmount)) throw new FoodError(409, "钱包余额不足，请先充值");
      for (const item of order.items) {
        if (!item.menu_item_id) continue;
        const result = await tx.menuItem.updateMany({ where: { id: item.menu_item_id, OR: [{ stock: -1 }, { stock: { gte: item.quantity } }] }, data: { stock: { decrement: item.quantity } } });
        if (!result.count) throw new FoodError(409, `${item.item_name} 库存不足，请重新下单`);
      }
      const beforeBalance = wallet.balance;
      const afterBalance = beforeBalance.minus(payableAmount);
      await tx.userWallet.update({ where: { id: wallet.id }, data: { balance: afterBalance } });
      await tx.walletLog.create({ data: { wallet_id: wallet.id, food_order_id: order.id, type: "FOOD_ORDER_PAY", amount: payableAmount.negated(), before_balance: beforeBalance, after_balance: afterBalance } });
      return tx.foodOrder.update({ where: { id: order.id }, data: { status: FoodOrderStatus.PAID, payment_at: new Date(), pickup_code: String(Math.floor(100000 + Math.random() * 900000)), timelines: { create: { from_status: FoodOrderStatus.PENDING_PAYMENT, to_status: FoodOrderStatus.PAID, actor_id: input.userId, actor_role: "USER", note: "支付成功，等待商家接单" } } }, include: orderInclude });
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
      const cancellableStatuses: FoodOrderStatus[] = [FoodOrderStatus.PENDING_PAYMENT, FoodOrderStatus.PAID];
      if (!cancellableStatuses.includes(order.status)) throw new FoodError(409, "商家已开始处理，暂不能自行取消");
      fromStatus = order.status;
      if (order.status === FoodOrderStatus.PAID) {
        const wallet = await tx.userWallet.upsert({ where: { user_id: input.userId }, update: {}, create: { user_id: input.userId } });
        const amount = order.payable_amount.gt(0) ? order.payable_amount : order.total_amount;
        const beforeBalance = wallet.balance, afterBalance = beforeBalance.plus(amount);
        await tx.userWallet.update({ where: { id: wallet.id }, data: { balance: afterBalance } });
        await tx.walletLog.create({ data: { wallet_id: wallet.id, food_order_id: order.id, type: "FOOD_ORDER_REFUND", amount, before_balance: beforeBalance, after_balance: afterBalance } });
        for (const item of order.items) if (item.menu_item_id) await tx.menuItem.updateMany({ where: { id: item.menu_item_id, stock: { gte: 0 } }, data: { stock: { increment: item.quantity } } });
      }
      return tx.foodOrder.update({ where: { id: order.id }, data: { status: FoodOrderStatus.CANCELLED, cancelled_at: new Date(), cancel_reason: reason || null, timelines: { create: { from_status: fromStatus, to_status: FoodOrderStatus.CANCELLED, actor_id: input.userId, actor_role: "USER", note: reason || "用户取消订单" } } }, include: orderInclude });
    });
    void notificationService.notifyFoodOrderStatusChanged({ orderId: cancelled.id, fromStatus, toStatus: FoodOrderStatus.CANCELLED });
    return mapFoodOrder(cancelled);
  }

  async listUserOrders(input: { userId: number; page?: unknown; pageSize?: unknown; status?: unknown }) {
    const { page, pageSize, skip } = parsePage(input.page, input.pageSize);
    const rawStatus = stringValue(input.status).toUpperCase();
    const status = rawStatus && (Object.values(FoodOrderStatus) as string[]).includes(rawStatus) ? rawStatus as FoodOrderStatus : undefined;
    const where = { user_id: input.userId, ...(status ? { status } : {}) };
    const [total, orders] = await Promise.all([
      prisma.foodOrder.count({ where }),
      prisma.foodOrder.findMany({ where, orderBy: { created_at: "desc" }, skip, take: pageSize, include: orderInclude }),
    ]);
    return { page, page_size: pageSize, total, list: orders.map(mapFoodOrder) };
  }

  async getUserOrder(input: { orderId: number; userId: number }) {
    const order = await prisma.foodOrder.findUnique({ where: { id: input.orderId }, include: orderInclude });
    if (!order) throw new FoodError(404, "外卖订单不存在");
    if (order.user_id !== input.userId) throw new FoodError(403, "无权查看该订单");
    return mapFoodOrder(order);
  }

  async updateMerchantOrderStatus(input: { ownerId: number; merchantId: number; orderId: number; action: unknown; note?: unknown }) {
    await getOwnedMerchant(input.merchantId, input.ownerId);
    const action = stringValue(input.action).toUpperCase();
    const note = stringValue(input.note);
    if (note.length > 300) throw new FoodError(400, "处理说明不能超过 300 个字符");
    const transition = {
      ACCEPT: { from: [FoodOrderStatus.PAID], to: FoodOrderStatus.MERCHANT_ACCEPTED, note: "商家已接单" },
      PREPARE: { from: [FoodOrderStatus.MERCHANT_ACCEPTED], to: FoodOrderStatus.PREPARING, note: "商家正在备餐" },
      READY: { from: [FoodOrderStatus.MERCHANT_ACCEPTED, FoodOrderStatus.PREPARING], to: FoodOrderStatus.READY_FOR_PICKUP, note: "餐品已备好，等待跑腿员取餐" },
    }[action];
    if (!transition) throw new FoodError(400, "action 必须为 accept、prepare 或 ready");
    const current = await prisma.foodOrder.findFirst({ where: { id: input.orderId, merchant_id: input.merchantId, status: { in: transition.from } } });
    if (!current) throw new FoodError(409, "订单状态已变化，无法处理");
    const order = await prisma.foodOrder.update({ where: { id: current.id }, data: { status: transition.to, timelines: { create: { from_status: current.status, to_status: transition.to, actor_id: input.ownerId, actor_role: "MERCHANT", note: note || transition.note } } }, include: orderInclude });
    void notificationService.notifyFoodOrderStatusChanged({ orderId: order.id, fromStatus: current.status, toStatus: transition.to });
    return mapFoodOrder(order);
  }

  async rejectMerchantOrder(input: { ownerId: number; merchantId: number; orderId: number; reason: unknown }) {
    await getOwnedMerchant(input.merchantId, input.ownerId);
    const reason = stringValue(input.reason);
    if (!reason || reason.length > 300) throw new FoodError(400, "请填写 1-300 个字符的拒单原因");
    const refunded = await prisma.$transaction(async (tx) => {
      const order = await tx.foodOrder.findFirst({ where: { id: input.orderId, merchant_id: input.merchantId, status: FoodOrderStatus.PAID }, include: { items: true } });
      if (!order) throw new FoodError(409, "仅可拒绝待接单的已支付订单");
      const wallet = await tx.userWallet.upsert({ where: { user_id: order.user_id }, update: {}, create: { user_id: order.user_id } });
      const amount = order.payable_amount.gt(0) ? order.payable_amount : order.total_amount;
      const beforeBalance = wallet.balance, afterBalance = beforeBalance.plus(amount);
      await tx.userWallet.update({ where: { id: wallet.id }, data: { balance: afterBalance } });
      await tx.walletLog.create({ data: { wallet_id: wallet.id, food_order_id: order.id, type: "FOOD_MERCHANT_REJECT_REFUND", amount, before_balance: beforeBalance, after_balance: afterBalance } });
      for (const item of order.items) if (item.menu_item_id) await tx.menuItem.updateMany({ where: { id: item.menu_item_id, stock: { gte: 0 } }, data: { stock: { increment: item.quantity } } });
      return tx.foodOrder.update({ where: { id: order.id }, data: { status: FoodOrderStatus.REFUNDED, cancelled_at: new Date(), cancel_reason: reason, timelines: { create: { from_status: FoodOrderStatus.PAID, to_status: FoodOrderStatus.REFUNDED, actor_id: input.ownerId, actor_role: "MERCHANT", note: reason } } }, include: orderInclude });
    });
    void notificationService.notifyFoodOrderStatusChanged({ orderId: refunded.id, fromStatus: FoodOrderStatus.PAID, toStatus: FoodOrderStatus.REFUNDED });
    return mapFoodOrder(refunded);
  }

  async listRunnerOrders(input: { runnerId: number; available?: unknown; page?: unknown; pageSize?: unknown }) {
    const { page, pageSize, skip } = parsePage(input.page, input.pageSize);
    const available = input.available === true || String(input.available).toLowerCase() === "true" || String(input.available) === "1";
    const where: Prisma.FoodOrderWhereInput = available ? { status: FoodOrderStatus.READY_FOR_PICKUP, runner_id: null } : { runner_id: input.runnerId };
    const [total, orders] = await Promise.all([
      prisma.foodOrder.count({ where }),
      prisma.foodOrder.findMany({ where, orderBy: { created_at: "desc" }, skip, take: pageSize, include: orderInclude }),
    ]);
    return { page, page_size: pageSize, total, list: orders.map(mapFoodOrder) };
  }

  async acceptOrder(input: { orderId: number; runnerId: number }) {
    const order = await prisma.$transaction(async (tx) => {
      const updated = await tx.foodOrder.updateMany({
        where: { id: input.orderId, status: FoodOrderStatus.READY_FOR_PICKUP, runner_id: null },
        data: { status: FoodOrderStatus.ACCEPTED, runner_id: input.runnerId, accept_time: new Date() },
      });
      if (!updated.count) throw new FoodError(409, "该配送单已被其他跑腿员接取");
      await tx.foodOrderTimeline.create({ data: { food_order_id: input.orderId, from_status: FoodOrderStatus.READY_FOR_PICKUP, to_status: FoodOrderStatus.ACCEPTED, actor_id: input.runnerId, actor_role: "RUNNER", note: "跑腿员已接单" } });
      return tx.foodOrder.findUnique({ where: { id: input.orderId }, include: orderInclude });
    });
    void notificationService.notifyFoodOrderStatusChanged({ orderId: input.orderId, fromStatus: FoodOrderStatus.READY_FOR_PICKUP, toStatus: FoodOrderStatus.ACCEPTED });
    return mapFoodOrder(order);
  }

  async updateDeliveryStatus(input: { orderId: number; runnerId: number; action: unknown }) {
    const action = stringValue(input.action).toUpperCase();
    const transitions: Record<string, { from: FoodOrderStatus; to: FoodOrderStatus; time: "pickup_time" | "delivery_start_time" | "delivered_at" }> = {
      PICKUP: { from: FoodOrderStatus.ACCEPTED, to: FoodOrderStatus.PICKED, time: "pickup_time" },
      DELIVER: { from: FoodOrderStatus.PICKED, to: FoodOrderStatus.DELIVERING, time: "delivery_start_time" },
      COMPLETE: { from: FoodOrderStatus.DELIVERING, to: FoodOrderStatus.DELIVERED, time: "delivered_at" },
    };
    const transition = transitions[action];
    if (!transition) throw new FoodError(400, "action 必须为 pickup、deliver 或 complete");
    const now = new Date();
    const order = await prisma.$transaction(async (tx) => {
      const current = await tx.foodOrder.findFirst({ where: { id: input.orderId, runner_id: input.runnerId, status: transition.from }, include: { items: true } });
      if (!current) throw new FoodError(409, "订单状态已变化，无法执行该操作");
      return tx.foodOrder.update({ where: { id: current.id }, data: { status: transition.to, [transition.time]: now, timelines: { create: { from_status: current.status, to_status: transition.to, actor_id: input.runnerId, actor_role: "RUNNER", note: transition.to === FoodOrderStatus.DELIVERED ? "已送达，等待用户确认" : undefined } } }, include: orderInclude });
    });
    void notificationService.notifyFoodOrderStatusChanged({ orderId: order.id, fromStatus: transition.from, toStatus: transition.to });
    return mapFoodOrder(order);
  }

  async confirmOrder(input: { orderId: number; userId: number }) {
    const completed = await prisma.$transaction(async (tx) => {
      const order = await tx.foodOrder.findUnique({ where: { id: input.orderId }, include: { merchant: true } });
      if (!order) throw new FoodError(404, "外卖订单不存在");
      if (order.user_id !== input.userId) throw new FoodError(403, "无权确认该订单");
      if (order.status !== FoodOrderStatus.DELIVERED || !order.runner_id) throw new FoodError(409, "当前订单暂不能确认收餐");
      const now = new Date();
      const merchantWallet = await tx.userWallet.upsert({ where: { user_id: order.merchant.owner_id }, update: {}, create: { user_id: order.merchant.owner_id } });
      const runnerWallet = await tx.userWallet.upsert({ where: { user_id: order.runner_id }, update: {}, create: { user_id: order.runner_id } });
      const merchantAfter = merchantWallet.balance.plus(order.merchant_income);
      const runnerAfter = runnerWallet.balance.plus(order.runner_income);
      await tx.userWallet.update({ where: { id: merchantWallet.id }, data: { balance: merchantAfter } });
      await tx.userWallet.update({ where: { id: runnerWallet.id }, data: { balance: runnerAfter } });
      if (order.merchant_income.gt(0)) await tx.walletLog.create({ data: { wallet_id: merchantWallet.id, food_order_id: order.id, type: "FOOD_MERCHANT_SETTLEMENT", amount: order.merchant_income, before_balance: merchantWallet.balance, after_balance: merchantAfter } });
      if (order.runner_income.gt(0)) {
        await tx.walletLog.create({ data: { wallet_id: runnerWallet.id, food_order_id: order.id, type: "FOOD_DELIVERY_EARNING", amount: order.runner_income, before_balance: runnerWallet.balance, after_balance: runnerAfter } });
        await tx.earning.create({ data: { user_id: order.runner_id, food_order_id: order.id, amount: order.runner_income, type: "FOOD_DELIVERY", status: "SETTLED", settled_at: now } });
      }
      return tx.foodOrder.update({ where: { id: order.id }, data: { status: FoodOrderStatus.COMPLETED, complete_time: now, timelines: { create: { from_status: FoodOrderStatus.DELIVERED, to_status: FoodOrderStatus.COMPLETED, actor_id: input.userId, actor_role: "USER", note: "用户确认收餐，订单已结算" } } }, include: orderInclude });
    });
    void notificationService.notifyFoodOrderStatusChanged({ orderId: completed.id, fromStatus: FoodOrderStatus.DELIVERED, toStatus: FoodOrderStatus.COMPLETED });
    return mapFoodOrder(completed);
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
