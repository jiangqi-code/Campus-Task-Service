import { FoodOrderStatus, MerchantStatus, Prisma, PrismaClient } from "@prisma/client";
import { sensitiveWordService } from "./sensitiveWord.service";
import { notificationService } from "./notification.service";
import { CouponError, consumeUserCoupon, quoteUserCoupon } from "./coupon.service";

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

type BusinessHour = { day: number; enabled: boolean; start: string; end: string };
type FoodOptionChoice = { name: string; price_delta: number };
type FoodOptionGroup = { name: string; required: boolean; choices: FoodOptionChoice[] };
type SelectedFoodOption = { group_name: string; choice_name: string; price_delta: number };

const businessHourEnabled = (value: unknown) => value === undefined || value === true || value === 1 || String(value).toLowerCase() === "true" || String(value) === "1";

const businessMinutes = (value: unknown, label: string) => {
  const time = stringValue(value);
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(time);
  if (!match) throw new FoodError(400, `${label}应为 HH:mm 格式`);
  return Number.parseInt(time.slice(0, 2), 10) * 60 + Number.parseInt(time.slice(3), 10);
};

const parseBusinessHours = (value: unknown): BusinessHour[] | null => {
  if (value === undefined || value === null || value === "") return null;
  let raw = value;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { throw new FoodError(400, "营业时段格式不合法"); }
  }
  if (!Array.isArray(raw)) throw new FoodError(400, "营业时段格式不合法");
  if (raw.length === 0) return null;
  if (raw.length > 7) throw new FoodError(400, "营业时段最多设置 7 天");
  const days = new Set<number>();
  const result = raw.map((item) => {
    if (!item || typeof item !== "object") throw new FoodError(400, "营业时段格式不合法");
    const day = intOr((item as any).day, -1);
    if (day < 0 || day > 6 || days.has(day)) throw new FoodError(400, "营业日期不合法或重复");
    days.add(day);
    const start = stringValue((item as any).start);
    const end = stringValue((item as any).end);
    if (businessMinutes(start, "营业开始时间") >= businessMinutes(end, "营业结束时间")) throw new FoodError(400, "营业结束时间应晚于开始时间");
    return { day, enabled: businessHourEnabled((item as any).enabled), start, end };
  });
  return result.sort((a, b) => a.day - b.day);
};

const savedBusinessHours = (value: unknown): BusinessHour[] | null => {
  try { return parseBusinessHours(value); } catch { return null; }
};

const parseFoodOptionGroups = (value: unknown): FoodOptionGroup[] => {
  if (value === undefined || value === null || value === "") return [];
  let raw = value;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { throw new FoodError(400, "菜品规格格式不合法"); }
  }
  if (!Array.isArray(raw)) throw new FoodError(400, "菜品规格格式不合法");
  if (raw.length > 5) throw new FoodError(400, "每个菜品最多设置 5 组规格");
  const groupNames = new Set<string>();
  return raw.map((group) => {
    if (!group || typeof group !== "object") throw new FoodError(400, "菜品规格格式不合法");
    const name = stringValue((group as any).name);
    const choicesRaw = (group as any).choices;
    if (!name || name.length > 30 || groupNames.has(name) || !Array.isArray(choicesRaw) || choicesRaw.length < 1 || choicesRaw.length > 12) throw new FoodError(400, "规格组名称或选项数量不合法");
    groupNames.add(name);
    const choiceNames = new Set<string>();
    const choices = choicesRaw.map((choice: any) => {
      const choiceName = stringValue(choice?.name);
      if (!choiceName || choiceName.length > 40 || choiceNames.has(choiceName)) throw new FoodError(400, "规格选项名称不合法或重复");
      choiceNames.add(choiceName);
      const priceDelta = decimal(choice?.price_delta ?? choice?.priceDelta ?? 0, "规格加价", -100).toDecimalPlaces(2);
      return { name: choiceName, price_delta: Number(priceDelta) };
    });
    return { name, required: businessHourEnabled((group as any).required), choices };
  });
};

const savedFoodOptionGroups = (value: unknown): FoodOptionGroup[] => {
  try { return parseFoodOptionGroups(value); } catch { return []; }
};

const parseSelectedFoodOptions = (value: unknown, optionGroups: FoodOptionGroup[]): SelectedFoodOption[] => {
  if (value === undefined || value === null || value === "") {
    if (optionGroups.some((group) => group.required)) throw new FoodError(400, "请选择必选规格");
    return [];
  }
  let raw = value;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { throw new FoodError(400, "所选规格格式不合法"); }
  }
  if (!Array.isArray(raw) || raw.length > optionGroups.length) throw new FoodError(400, "所选规格格式不合法");
  const selections = new Map<string, string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") throw new FoodError(400, "所选规格格式不合法");
    const groupName = stringValue((item as any).group_name ?? (item as any).groupName ?? (item as any).group);
    const choiceName = stringValue((item as any).choice_name ?? (item as any).choiceName ?? (item as any).choice);
    if (!groupName || !choiceName || selections.has(groupName)) throw new FoodError(400, "所选规格不合法或重复");
    selections.set(groupName, choiceName);
  }
  const result: SelectedFoodOption[] = [];
  for (const group of optionGroups) {
    const choiceName = selections.get(group.name);
    if (!choiceName) {
      if (group.required) throw new FoodError(400, `请选择${group.name}`);
      continue;
    }
    const choice = group.choices.find((item) => item.name === choiceName);
    if (!choice) throw new FoodError(400, `${group.name}选项不可用`);
    result.push({ group_name: group.name, choice_name: choice.name, price_delta: choice.price_delta });
  }
  if (selections.size !== result.length) throw new FoodError(400, "所选规格不属于当前菜品");
  return result;
};

const currentShanghaiTime = () => {
  const parts = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const weekday = values.get("weekday") ?? "";
  const day = ["日", "一", "二", "三", "四", "五", "六"].findIndex((name) => weekday.includes(name));
  return { day, minutes: Number.parseInt(values.get("hour") ?? "0", 10) * 60 + Number.parseInt(values.get("minute") ?? "0", 10) };
};

const merchantAvailability = (merchant: any) => {
  const businessHours = savedBusinessHours(merchant.business_hours);
  const manualOpen = Boolean(merchant.is_open);
  if (!manualOpen || merchant.status !== MerchantStatus.APPROVED) return { businessHours, isOrderable: false };
  if (!businessHours?.length) return { businessHours, isOrderable: true };
  const now = currentShanghaiTime();
  const slot = businessHours.find((item) => item.day === now.day);
  const isOrderable = Boolean(slot?.enabled) && now.minutes >= businessMinutes(slot!.start, "营业开始时间") && now.minutes < businessMinutes(slot!.end, "营业结束时间");
  return { businessHours, isOrderable };
};

const mapMerchant = (merchant: any, includeQualifications = false) => {
  const availability = merchantAvailability(merchant);
  return {
  id: merchant.id,
  owner_id: merchant.owner_id,
  name: merchant.name,
  description: merchant.description,
  logo: merchant.logo,
  address: merchant.address,
  phone: merchant.phone,
  cover_image: merchant.cover_image,
  ...(includeQualifications ? { business_license_image: merchant.business_license_image } : {}),
  announcement: merchant.announcement,
  min_order_amount: toNumber(merchant.min_order_amount),
  prepare_minutes: merchant.prepare_minutes,
  status: merchant.status,
  audit_note: merchant.audit_note,
  commission_rate: toNumber(merchant.commission_rate),
  is_open: merchant.is_open,
  business_hours: availability.businessHours,
  is_orderable: availability.isOrderable,
  business_status: availability.isOrderable ? "OPEN" : "CLOSED",
  created_at: merchant.created_at,
  updated_at: merchant.updated_at,
  owner: merchant.owner,
  menu_item_count: merchant._count?.menu_items,
  };
};

const mapMenuItem = (item: any) => ({
  id: item.id,
  merchant_id: item.merchant_id,
  category_id: item.category_id,
  name: item.name,
  description: item.description,
  image: item.image,
  price: toNumber(item.price),
  original_price: item.original_price === null || item.original_price === undefined ? null : toNumber(item.original_price),
  option_groups: savedFoodOptionGroups(item.option_groups),
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
    ? order.items.map((item: any) => ({ id: item.id, menu_item_id: item.menu_item_id, item_name: item.item_name, unit_price: toNumber(item.unit_price), selected_options: item.selected_options, quantity: item.quantity }))
    : [],
  timeline: Array.isArray(order.timelines)
    ? order.timelines.map((row: any) => ({ id: row.id, from_status: row.from_status, to_status: row.to_status, actor_role: row.actor_role, note: row.note, created_at: row.created_at, actor: row.actor }))
    : [],
});

const orderInclude = {
  merchant: { select: { id: true, name: true, logo: true, cover_image: true, address: true, phone: true, is_open: true, business_hours: true, status: true, commission_rate: true, prepare_minutes: true } },
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
    const merchants = await prisma.merchant.findMany({
      where,
      orderBy: { created_at: "desc" },
      include: { _count: { select: { menu_items: { where: { is_active: true } } } } },
    });
    const orderableMerchants = merchants.map((merchant) => mapMerchant(merchant)).filter((merchant) => merchant.is_orderable);
    return { page, page_size: pageSize, total: orderableMerchants.length, list: orderableMerchants.slice(skip, skip + pageSize) };
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
    return { merchant: mapMerchant(merchant, merchant.owner_id === input.viewerId || Boolean(input.isAdmin)), categories: merchant.categories.map(mapFoodCategory), menu_items: merchant.menu_items.map(mapMenuItem) };
  }

  async applyMerchant(input: { ownerId: number; name: unknown; description?: unknown; logo?: unknown; coverImage?: unknown; businessLicenseImage?: unknown; announcement?: unknown; minOrderAmount?: unknown; prepareMinutes?: unknown; businessHours?: unknown; address: unknown; phone?: unknown }) {
    const name = stringValue(input.name);
    const description = stringValue(input.description);
    const address = stringValue(input.address);
    const phone = stringValue(input.phone);
    const logo = normalizeImage(input.logo);
    const coverImage = input.coverImage === undefined ? null : normalizeImage(input.coverImage);
    const businessLicenseImage = input.businessLicenseImage === undefined ? null : normalizeImage(input.businessLicenseImage);
    const announcement = stringValue(input.announcement);
    const minOrderAmount = input.minOrderAmount === undefined ? new Prisma.Decimal(0) : decimal(input.minOrderAmount, "起送金额").toDecimalPlaces(2);
    const prepareMinutes = input.prepareMinutes === undefined ? 15 : intOr(input.prepareMinutes, 0);
    const businessHours = parseBusinessHours(input.businessHours);
    if (name.length < 2 || name.length > 80) throw new FoodError(400, "商家名称应为 2-80 个字符");
    if (!address || address.length > 160) throw new FoodError(400, "请填写 1-160 个字符的商家地址");
    if (description.length > 2000 || announcement.length > 500 || phone.length > 30 || prepareMinutes < 1 || prepareMinutes > 180) throw new FoodError(400, "商家资料长度不合法");
    await Promise.all([ensureSafeText(name, "商家名称"), ensureSafeText(description, "商家介绍"), ensureSafeText(announcement, "商家公告")]);
    const existing = await prisma.merchant.findFirst({
      where: { owner_id: input.ownerId, status: { in: [MerchantStatus.PENDING, MerchantStatus.APPROVED] } },
      select: { id: true },
    });
    if (existing) throw new FoodError(409, "当前账号已有待审核或已通过的商家");
    if (!coverImage) throw new FoodError(400, "Storefront photo is required");
    if (!businessLicenseImage) throw new FoodError(400, "Business license image is required");
    const settings = await getSettings();
    const merchant = await prisma.merchant.create({
      data: { owner_id: input.ownerId, name, description: description || null, logo, cover_image: coverImage, business_license_image: businessLicenseImage, announcement: announcement || null, min_order_amount: minOrderAmount, prepare_minutes: prepareMinutes, business_hours: businessHours ?? Prisma.JsonNull, address, phone: phone || null, commission_rate: settings.commissionRate },
      include: { _count: { select: { menu_items: true } } },
    });
    return mapMerchant(merchant, true);
  }

  async getMyMerchant(ownerId: number) {
    const merchant = await prisma.merchant.findFirst({
      where: { owner_id: ownerId },
      orderBy: { updated_at: "desc" },
      include: { _count: { select: { menu_items: true } }, categories: { orderBy: [{ sort_order: "asc" }, { id: "asc" }] }, menu_items: { orderBy: [{ sort_order: "asc" }, { id: "asc" }] } },
    });
    if (!merchant) return null;
    return { merchant: mapMerchant(merchant, true), categories: merchant.categories.map(mapFoodCategory), menu_items: merchant.menu_items.map(mapMenuItem) };
  }

  async updateMyMerchant(input: { ownerId: number; merchantId: number; name?: unknown; description?: unknown; logo?: unknown; coverImage?: unknown; businessLicenseImage?: unknown; announcement?: unknown; minOrderAmount?: unknown; prepareMinutes?: unknown; businessHours?: unknown; address?: unknown; phone?: unknown; isOpen?: unknown }) {
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
    if (input.businessLicenseImage !== undefined) data.business_license_image = normalizeImage(input.businessLicenseImage);
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
    if (input.businessHours !== undefined) data.business_hours = parseBusinessHours(input.businessHours) ?? Prisma.JsonNull;
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
    return mapMerchant(updated, true);
  }

  async createMenuItem(input: { ownerId: number; merchantId: number; categoryId?: unknown; name: unknown; description?: unknown; image?: unknown; price: unknown; originalPrice?: unknown; optionGroups?: unknown; stock?: unknown; sortOrder?: unknown }) {
    const merchant = await getOwnedMerchant(input.merchantId, input.ownerId);
    if (merchant.status === MerchantStatus.DISABLED) throw new FoodError(409, "商家已被停用");
    const name = stringValue(input.name);
    const description = stringValue(input.description);
    const itemPrice = decimal(input.price, "菜品价格", 0.01).toDecimalPlaces(2);
    const stock = input.stock === undefined || input.stock === "" ? -1 : intOr(input.stock, -2);
    const categoryId = input.categoryId === undefined || input.categoryId === null || input.categoryId === "" ? null : positiveId(input.categoryId, "分类 ID");
    const optionGroups = parseFoodOptionGroups(input.optionGroups);
    const image = normalizeImage(input.image);
    if (categoryId && !(await prisma.foodCategory.findFirst({ where: { id: categoryId, merchant_id: merchant.id } }))) throw new FoodError(400, "菜品分类不属于当前商家");
    if (name.length < 1 || name.length > 100 || description.length > 500 || stock < -1) throw new FoodError(400, "菜品信息不合法");
    if (!image) throw new FoodError(400, "Menu item image is required");
    await Promise.all([ensureSafeText(name, "菜品名称"), ensureSafeText(description, "菜品介绍")]);
    const item = await prisma.menuItem.create({
      data: { merchant_id: merchant.id, category_id: categoryId, name, description: description || null, image, price: itemPrice, original_price: input.originalPrice === undefined || input.originalPrice === "" ? null : decimal(input.originalPrice, "菜品原价", 0.01).toDecimalPlaces(2), option_groups: optionGroups.length ? optionGroups : Prisma.JsonNull, stock, sort_order: intOr(input.sortOrder, 0) },
    });
    return mapMenuItem(item);
  }

  async updateMenuItem(input: { ownerId: number; merchantId: number; itemId: number; categoryId?: unknown; name?: unknown; description?: unknown; image?: unknown; price?: unknown; originalPrice?: unknown; optionGroups?: unknown; stock?: unknown; sortOrder?: unknown; isActive?: unknown }) {
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
    if (input.optionGroups !== undefined) {
      const optionGroups = parseFoodOptionGroups(input.optionGroups);
      data.option_groups = optionGroups.length ? optionGroups : Prisma.JsonNull;
    }
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

  async quoteOrder(input: { merchantId: unknown; items: unknown; userId?: number; userCouponId?: unknown }) {
    const merchantId = positiveId(input.merchantId, "商家 ID");
    if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 30) throw new FoodError(400, "请选择 1-30 个菜品");
    const quantities = new Map<number, number>();
    const requestedLines = input.items.map((raw) => {
      const itemId = positiveId((raw as any)?.menu_item_id ?? (raw as any)?.menuItemId ?? (raw as any)?.id, "菜品 ID");
      const quantity = intOr((raw as any)?.quantity, 0);
      if (quantity < 1 || quantity > 99) throw new FoodError(400, "菜品数量应为 1-99");
      const totalQuantity = (quantities.get(itemId) ?? 0) + quantity;
      if (totalQuantity > 99) throw new FoodError(400, "单个菜品最多购买 99 份");
      quantities.set(itemId, totalQuantity);
      return { menuItemId: itemId, quantity, selectedOptions: (raw as any)?.selected_options ?? (raw as any)?.selectedOptions ?? (raw as any)?.options };
    });
    const merchant = await prisma.merchant.findFirst({ where: { id: merchantId, status: MerchantStatus.APPROVED, is_open: true } });
    if (!merchant || !merchantAvailability(merchant).isOrderable) throw new FoodError(409, "商家当前不在营业时段");
    const menuItems = await prisma.menuItem.findMany({ where: { merchant_id: merchant.id, id: { in: Array.from(quantities.keys()) }, is_active: true } });
    if (menuItems.length !== quantities.size) throw new FoodError(409, "购物车中存在已下架菜品");
    for (const item of menuItems) {
      const quantity = quantities.get(item.id) ?? 0;
      if (item.stock >= 0 && item.stock < quantity) throw new FoodError(409, `${item.name} 库存不足`);
    }
    const menuItemMap = new Map(menuItems.map((item) => [item.id, item]));
    const lines = requestedLines.map((request) => {
      const item = menuItemMap.get(request.menuItemId)!;
      const selectedOptions = parseSelectedFoodOptions(request.selectedOptions, savedFoodOptionGroups(item.option_groups));
      const unitPrice = item.price.plus(selectedOptions.reduce((sum, option) => sum.plus(option.price_delta), new Prisma.Decimal(0))).toDecimalPlaces(2);
      if (unitPrice.lte(0)) throw new FoodError(400, `${item.name}规格价格不合法`);
      return { menuItem: item, quantity: request.quantity, selectedOptions, unitPrice };
    });
    const settings = await getSettings();
    const itemAmount = lines.reduce((sum, line) => sum.plus(line.unitPrice.mul(line.quantity)), new Prisma.Decimal(0)).toDecimalPlaces(2);
    if (itemAmount.lt(merchant.min_order_amount)) throw new FoodError(409, `该商家起送金额为 ¥${merchant.min_order_amount.toFixed(2)}`);
    const deliveryFee = settings.deliveryFee.toDecimalPlaces(2);
    const commissionRate = merchant.commission_rate.toDecimalPlaces(4);
    const commissionAmount = itemAmount.mul(commissionRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const totalAmount = itemAmount.plus(deliveryFee).toDecimalPlaces(2);
    const userCouponId = stringValue(input.userCouponId) || null;
    let discountAmount = new Prisma.Decimal(0);
    if (userCouponId) {
      if (!input.userId) throw new FoodError(401, "请先登录后使用优惠券");
      try { discountAmount = (await prisma.$transaction((tx) => quoteUserCoupon(tx, input.userId!, userCouponId, totalAmount))).discountAmount; }
      catch (error) { if (error instanceof CouponError) throw new FoodError(error.status, error.message); throw error; }
    }
    return { merchant, menuItems, quantities, lines, settings, itemAmount, deliveryFee, commissionRate, commissionAmount, totalAmount, userCouponId, discountAmount, payableAmount: totalAmount.minus(discountAmount).toDecimalPlaces(2) };
  }

  async createOrder(input: { userId: number; merchantId: unknown; userCouponId?: unknown; items: unknown; deliveryAddress: unknown; deliveryLat?: unknown; deliveryLng?: unknown; contactPhone?: unknown; remark?: unknown }) {
    const address = stringValue(input.deliveryAddress);
    const contactPhone = stringValue(input.contactPhone);
    const remark = stringValue(input.remark);
    const deliveryLat = coordinate(input.deliveryLat, -90, 90, "送达纬度");
    const deliveryLng = coordinate(input.deliveryLng, -180, 180, "送达经度");
    if (!address || address.length > 180 || contactPhone.length > 30 || remark.length > 500 || (deliveryLat === null) !== (deliveryLng === null)) throw new FoodError(400, "配送信息不合法");
    await Promise.all([ensureSafeText(address, "配送地址"), ensureSafeText(remark, "订单备注")]);
    const quote = await this.quoteOrder({ merchantId: input.merchantId, items: input.items, userId: input.userId, userCouponId: input.userCouponId });
    const now = new Date();
    const paymentExpireAt = new Date(now.getTime() + quote.settings.paymentTimeoutMinutes * 60 * 1000);
    const orderNo = `FO${now.getTime().toString(36).toUpperCase()}${Math.floor(1000 + Math.random() * 9000)}`;
    const order = await prisma.foodOrder.create({
      data: {
        order_no: orderNo, user_id: input.userId, merchant_id: quote.merchant.id, user_coupon_id: quote.userCouponId,
        delivery_address: address, delivery_lat: deliveryLat, delivery_lng: deliveryLng, contact_phone: contactPhone || null, remark: remark || null,
        item_amount: quote.itemAmount, delivery_fee: quote.deliveryFee, discount_amount: quote.discountAmount, commission_rate: quote.commissionRate, commission_amount: quote.commissionAmount,
        total_amount: quote.totalAmount, payable_amount: quote.payableAmount, merchant_income: quote.itemAmount.minus(quote.commissionAmount), runner_income: quote.deliveryFee.plus(quote.settings.runnerCompletionReward), platform_income: quote.commissionAmount,
        payment_expire_at: paymentExpireAt,
        items: { create: quote.lines.map((line) => ({ menu_item_id: line.menuItem.id, item_name: line.menuItem.name, unit_price: line.unitPrice, selected_options: line.selectedOptions.length ? line.selectedOptions : Prisma.JsonNull, quantity: line.quantity })) },
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
      if (order.user_coupon_id) {
        try { await consumeUserCoupon(tx, input.userId, order.user_coupon_id, order.total_amount, undefined, order.id); }
        catch (error) { if (error instanceof CouponError) throw new FoodError(error.status, error.message); throw error; }
      }
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
    return { page, page_size: pageSize, total, list: merchants.map((merchant) => mapMerchant(merchant, true)) };
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
    if (status === MerchantStatus.APPROVED && (!merchant.cover_image || !merchant.business_license_image)) {
      throw new FoodError(409, "Storefront photo and business license are required before approval");
    }
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
