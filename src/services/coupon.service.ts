import { CouponAction, CouponStatus, CouponTriggerType, CouponType, Prisma, PrismaClient, UserCouponStatus } from '@prisma/client'
import { issueWelcomeCouponsForUser, triggerCouponDistribution } from './couponAutomation.service'
import { createClient } from 'redis'

const prisma = new PrismaClient()
type CouponRedisClient = ReturnType<typeof createClient>
let redisClient: CouponRedisClient | null = null
let redisConnecting: Promise<CouponRedisClient> | null = null

export class CouponError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

const money = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value).toDecimalPlaces(2)
const code = () => `CP${Date.now()}${Math.floor(1000 + Math.random() * 9000)}`

async function redis() {
  if (redisClient?.isOpen) return redisClient
  if (redisConnecting) return redisConnecting
  const client = createClient(process.env.REDIS_URL ? { url: process.env.REDIS_URL } : undefined)
  client.on('error', (error) => console.error('[coupon.redis]', error))
  redisConnecting = client.connect().then(() => { redisClient = client; return client }).finally(() => { redisConnecting = null })
  return redisConnecting
}

function calculateDiscount(coupon: { type: CouponType; value: Prisma.Decimal; min_order_amount: Prisma.Decimal; max_discount: Prisma.Decimal }, amountInput: Prisma.Decimal.Value) {
  const amount = money(amountInput)
  if (amount.lt(coupon.min_order_amount)) throw new CouponError(400, `订单金额需满${coupon.min_order_amount.toFixed(2)}元`)
  let discount = coupon.type === CouponType.CASH ? coupon.value : amount.mul(coupon.value).div(100)
  if (coupon.type === CouponType.DISCOUNT && coupon.max_discount.gt(0)) discount = Prisma.Decimal.min(discount, coupon.max_discount)
  discount = Prisma.Decimal.min(amount, discount).toDecimalPlaces(2)
  return { orderAmount: amount, discountAmount: discount, payableAmount: amount.minus(discount).toDecimalPlaces(2) }
}

async function expireUserCoupons(userId?: number) {
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    const rows = await tx.userCoupon.findMany({
      where: {
        ...(userId ? { user_id: userId } : {}),
        status: UserCouponStatus.UNUSED,
        OR: [
          { expired_at: { lte: now } },
          { coupon: { is: { status: { not: CouponStatus.ACTIVE } } } },
          { coupon: { is: { start_date: { gt: now } } } },
          { coupon: { is: { end_date: { lte: now } } } },
        ],
      },
      select: { id: true, user_id: true, coupon_id: true },
    })
    if (!rows.length) return
    await tx.userCoupon.updateMany({
      where: { id: { in: rows.map((row) => row.id) }, status: UserCouponStatus.UNUSED },
      data: { status: UserCouponStatus.EXPIRED },
    })
    await tx.couponLog.createMany({
      data: rows.map((row) => ({
        user_id: row.user_id,
        coupon_id: row.coupon_id,
        action: CouponAction.EXPIRE,
        detail: { userCouponId: row.id },
      })),
    })
  })
}

export async function listAvailable(userId: number) {
  await expireUserCoupons(userId)
  const now = new Date()
  const rows = await prisma.coupon.findMany({
    where: { status: CouponStatus.ACTIVE, start_date: { lte: now }, end_date: { gt: now }, OR: [{ total_limit: 0 }, { received_count: { lt: prisma.coupon.fields.total_limit } }] },
    orderBy: [{ end_date: 'asc' }, { created_at: 'desc' }],
  })
  const counts = await prisma.userCoupon.groupBy({ by: ['coupon_id'], where: { user_id: userId }, _count: { _all: true } })
  const map = new Map(counts.map((item) => [item.coupon_id, item._count._all]))
  return rows.map((item) => ({ ...item, received_by_user: map.get(item.id) || 0, can_receive: (map.get(item.id) || 0) < item.usage_limit }))
}

export async function listMine(userId: number, query: Record<string, unknown>) {
  await expireUserCoupons(userId)
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? query.page_size) || 10))
  const status = String(query.status || '').toUpperCase()
  const where: Prisma.UserCouponWhereInput = { user_id: userId, claimed_at: { not: null }, ...(Object.values(UserCouponStatus).includes(status as UserCouponStatus) ? { status: status as UserCouponStatus } : {}) }
  const [list, total] = await prisma.$transaction([
    prisma.userCoupon.findMany({ where, include: { coupon: true }, orderBy: { received_at: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.userCoupon.count({ where }),
  ])
  return { list, total, page, pageSize }
}

async function reserveDailyLimit(userId: number) {
  const dailyLimit = Math.max(1, Number(process.env.COUPON_DAILY_RECEIVE_LIMIT) || 5)
  const day = new Date().toISOString().slice(0, 10)
  const key = `coupon:receive:${userId}:${day}`
  const client = await redis()
  const count = await client.incr(key)
  if (count === 1) await client.expire(key, 26 * 60 * 60)
  if (count > dailyLimit) { await client.decr(key); throw new CouponError(429, `每天最多领取${dailyLimit}张优惠券`) }
  return { client, key }
}

export async function receiveCoupon(userId: number, couponId: string, action: CouponAction = CouponAction.RECEIVE) {
  const limiter = await reserveDailyLimit(userId)
  try {
    return await prisma.$transaction(async (tx) => {
      const coupon = await tx.coupon.findUnique({ where: { id: couponId } })
      const now = new Date()
      if (!coupon || coupon.status !== CouponStatus.ACTIVE || coupon.start_date > now || coupon.end_date <= now) throw new CouponError(400, '优惠券不可领取或已过期')
      const owned = await tx.userCoupon.count({ where: { user_id: userId, coupon_id: couponId } })
      if (owned >= coupon.usage_limit) throw new CouponError(409, '已达到该优惠券领取上限')
      if (coupon.total_limit > 0) {
        const reserved = await tx.coupon.updateMany({ where: { id: couponId, received_count: { lt: coupon.total_limit } }, data: { received_count: { increment: 1 } } })
        if (!reserved.count) throw new CouponError(409, '优惠券已领完')
      } else await tx.coupon.update({ where: { id: couponId }, data: { received_count: { increment: 1 } } })
      const userCoupon = await tx.userCoupon.create({ data: { user_id: userId, coupon_id: couponId, expired_at: coupon.end_date, claimed_at: new Date() } })
      await tx.couponLog.create({ data: { user_id: userId, coupon_id: couponId, action, detail: { userCouponId: userCoupon.id } } })
      return userCoupon
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (error) { await limiter.client.decr(limiter.key).catch(() => undefined); throw error }
}

export async function quoteUserCoupon(tx: Prisma.TransactionClient, userId: number, userCouponId: string, orderAmount: Prisma.Decimal.Value) {
  const row = await tx.userCoupon.findFirst({ where: { id: userCouponId, user_id: userId, claimed_at: { not: null } }, include: { coupon: true } })
  const now = new Date()
  if (!row || row.status !== UserCouponStatus.UNUSED) throw new CouponError(400, '优惠券不存在或已使用')
  if (row.expired_at <= now || row.coupon.end_date <= now || row.coupon.start_date > now || row.coupon.status !== CouponStatus.ACTIVE) throw new CouponError(400, '优惠券已过期或不可用')
  return { row, ...calculateDiscount(row.coupon, orderAmount) }
}

export async function consumeUserCoupon(tx: Prisma.TransactionClient, userId: number, userCouponId: string, orderAmount: Prisma.Decimal.Value, taskId?: number) {
  const quote = await quoteUserCoupon(tx, userId, userCouponId, orderAmount)
  const updated = await tx.userCoupon.updateMany({ where: { id: userCouponId, user_id: userId, status: UserCouponStatus.UNUSED }, data: { status: UserCouponStatus.USED, used_at: new Date() } })
  if (!updated.count) throw new CouponError(409, '优惠券已被使用')
  await tx.coupon.update({ where: { id: quote.row.coupon_id }, data: { used_count: { increment: 1 } } })
  await tx.couponLog.create({ data: { user_id: userId, coupon_id: quote.row.coupon_id, action: CouponAction.USE, detail: { userCouponId, taskId, orderAmount: quote.orderAmount.toFixed(2), discountAmount: quote.discountAmount.toFixed(2) } } })
  return quote
}

export async function applyCoupon(userId: number, input: Record<string, unknown>) {
  const amount = money(String(input.orderAmount ?? input.order_amount ?? 0))
  if (amount.lte(0)) throw new CouponError(400, '订单金额必须大于0')
  let userCouponId = String(input.userCouponId ?? input.user_coupon_id ?? '')
  if (!userCouponId && input.code) {
    const row = await prisma.userCoupon.findFirst({ where: { user_id: userId, status: UserCouponStatus.UNUSED, coupon: { code: String(input.code).toUpperCase() } }, orderBy: { received_at: 'asc' } })
    userCouponId = row?.id || ''
  }
  if (!userCouponId) throw new CouponError(400, '请选择已领取的优惠券')
  const quote = await prisma.$transaction((tx) => quoteUserCoupon(tx, userId, userCouponId, amount))
  return { userCouponId, orderAmount: quote.orderAmount, discountAmount: quote.discountAmount, payableAmount: quote.payableAmount, coupon: quote.row.coupon }
}

export async function checkCode(codeValue: string) {
  const now = new Date()
  const coupon = await prisma.coupon.findUnique({ where: { code: codeValue.trim().toUpperCase() } })
  const valid = Boolean(coupon && coupon.status === CouponStatus.ACTIVE && coupon.start_date <= now && coupon.end_date > now && (coupon.total_limit === 0 || coupon.received_count < coupon.total_limit))
  return { valid, coupon: valid ? coupon : null }
}

export async function adminList(query: Record<string, unknown>) {
  const page = Math.max(1, Number(query.page) || 1), pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? query.page_size) || 10))
  const keyword = String(query.keyword || '').trim(), status = String(query.status || '').toUpperCase(), type = String(query.type || '').toUpperCase()
  const where: Prisma.CouponWhereInput = { ...(keyword ? { OR: [{ name: { contains: keyword } }, { code: { contains: keyword } }] } : {}), ...(Object.values(CouponStatus).includes(status as CouponStatus) ? { status: status as CouponStatus } : {}), ...(Object.values(CouponType).includes(type as CouponType) ? { type: type as CouponType } : {}) }
  const [list, total] = await prisma.$transaction([prisma.coupon.findMany({ where, orderBy: { created_at: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }), prisma.coupon.count({ where })])
  return { list, total, page, pageSize }
}

function couponData(input: Record<string, unknown>, adminId?: number): Prisma.CouponUncheckedCreateInput {
  const type = String(input.type || '').toUpperCase() as CouponType
  const start = new Date(String(input.start_date ?? input.startDate)), end = new Date(String(input.end_date ?? input.endDate))
  if (!Object.values(CouponType).includes(type) || !String(input.name || '').trim()) throw new CouponError(400, '名称和优惠券类型必填')
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new CouponError(400, '有效期不合法')
  const value = money(String(input.value ?? 0)); if (value.lte(0) || (type === CouponType.DISCOUNT && value.gt(100))) throw new CouponError(400, '优惠券面值不合法')
  const minAmount=money(String(input.min_amount ?? input.min_order_amount ?? input.minOrderAmount ?? 0))
  return { name: String(input.name).trim(), code: String(input.code || code()).trim().toUpperCase(), type, value, min_order_amount: minAmount, max_discount: money(String(input.max_discount ?? input.maxDiscount ?? 0)), usage_limit: Math.max(1, Number(input.usage_limit ?? input.usageLimit) || 1), total_limit: Math.max(0, Number(input.total_limit ?? input.totalLimit) || 0), start_date: start, end_date: end, status: (String(input.status || CouponStatus.ACTIVE).toUpperCase() as CouponStatus), created_by: adminId || Number(input.created_by), discount_type:String(input.discount_type??type), discount_value:money(String(input.discount_value??value)), min_amount:minAmount, validity_days:Math.max(1,Number(input.validity_days??input.validityDays)||30) }
}

export const createCoupon = (adminId: number, input: Record<string, unknown>) => prisma.coupon.create({ data: couponData(input, adminId) })
export const updateCoupon = (id: string, input: Record<string, unknown>) => { const data = couponData(input); delete (data as Partial<typeof data>).created_by; delete (data as Partial<typeof data>).code; return prisma.coupon.update({ where: { id }, data }) }
export async function deleteCoupon(id: string) { const count = await prisma.userCoupon.count({ where: { coupon_id: id } }); if (count) throw new CouponError(409, '已发放的优惠券不能删除，可改为停用'); return prisma.coupon.delete({ where: { id } }) }
export async function usage(id: string) { const coupon = await prisma.coupon.findUnique({ where: { id } }); if (!coupon) throw new CouponError(404, '优惠券不存在'); const grouped = await prisma.userCoupon.groupBy({ by: ['status'], where: { coupon_id: id }, _count: { _all: true } }); return { coupon, received: coupon.received_count, used: coupon.used_count, remaining: coupon.total_limit === 0 ? null : Math.max(0, coupon.total_limit - coupon.received_count), statuses: grouped } }
export const giveCoupon = (userId: number, couponId: string) => receiveCoupon(userId, couponId, CouponAction.ADMIN_GIVE)

export async function checkNotification(userId: number) {
  await expireUserCoupons(userId)
  return prisma.userCoupon.findMany({
    where: { user_id: userId, claimed_at: null, status: UserCouponStatus.UNUSED, expired_at: { gt: new Date() } },
    include: { coupon: true },
    orderBy: { created_at: 'desc' },
  })
}

export async function claimCoupons(userId: number, input: Record<string, unknown>) {
  const ids = Array.isArray(input.ids) ? input.ids.map(String) : [String(input.userCouponId ?? input.user_coupon_id ?? input.id ?? '')].filter(Boolean)
  if (!ids.length) throw new CouponError(400, '请选择要领取的优惠券')
  return prisma.$transaction(async tx => {
    const rows = await tx.userCoupon.findMany({ where: { id: { in: ids }, user_id: userId, claimed_at: null, status: UserCouponStatus.UNUSED, expired_at: { gt: new Date() } }, include: { coupon: true } })
    if (!rows.length) throw new CouponError(409, '优惠券不存在、已领取或已过期')
    const claimedAt = new Date()
    await tx.userCoupon.updateMany({ where: { id: { in: rows.map(v => v.id) }, user_id: userId, claimed_at: null }, data: { claimed_at: claimedAt } })
    await tx.couponLog.createMany({
      data: rows.map((row) => ({
        user_id: userId,
        coupon_id: row.coupon_id,
        action: CouponAction.RECEIVE,
        detail: { userCouponId: row.id },
      })),
    })
    return rows.map(v => ({ ...v, claimed_at: claimedAt }))
  })
}

export async function listUsable(userId: number, query: Record<string, unknown>) {
  await expireUserCoupons(userId)
  const rawAmount = query.amount ?? query.orderAmount ?? query.order_amount
  const hasAmount = rawAmount !== undefined && rawAmount !== null && String(rawAmount).trim() !== ''
  const amount = hasAmount ? Number(rawAmount) : null
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) throw new CouponError(400, '订单金额不合法')
  const now = new Date()
  const rows = await prisma.userCoupon.findMany({
    where: {
      user_id: userId,
      claimed_at: { not: null },
      status: UserCouponStatus.UNUSED,
      expired_at: { gt: now },
      coupon: {
        is: {
          status: CouponStatus.ACTIVE,
          start_date: { lte: now },
          end_date: { gt: now },
        },
      },
    },
    include: { coupon: true },
    orderBy: { expired_at: 'asc' },
  })
  return amount === null ? rows : rows.filter(v => Number(v.coupon.min_order_amount) <= amount)
}

export async function welcomeCoupons(userId: number) {
  const issued = await prisma.$transaction(tx => issueWelcomeCouponsForUser(tx, userId), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  const pending = await checkNotification(userId)
  return { issued, coupons: pending }
}

export async function useCoupon(userId: number, input: Record<string, unknown>) {
  const id = String(input.userCouponId ?? input.user_coupon_id ?? '')
  const amount = money(String(input.orderAmount ?? input.order_amount ?? 0))
  const orderId = input.orderId ?? input.order_id
  if (!id || amount.lte(0)) throw new CouponError(400, '优惠券和订单金额不能为空')
  const quote = await prisma.$transaction(async tx => {
    const result = await consumeUserCoupon(tx, userId, id, amount)
    if (orderId) await tx.userCoupon.update({ where: { id }, data: { order_id: Number(orderId), used_order_id: Number(orderId) } })
    return result
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  return { orderAmount: quote.orderAmount, discountAmount: quote.discountAmount, payableAmount: quote.payableAmount }
}

export async function listEvents(query: Record<string, unknown>) {
  const page = Math.max(1, Number(query.page) || 1), pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? query.page_size) || 10))
  const where: Prisma.CouponEventWhereInput = {
    ...(query.trigger_type && Object.values(CouponTriggerType).includes(String(query.trigger_type) as CouponTriggerType) ? { trigger_type: String(query.trigger_type) as CouponTriggerType } : {}),
  }
  const [list, total] = await prisma.$transaction([
    prisma.couponEvent.findMany({ where, include: { coupon: true }, orderBy: { created_at: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.couponEvent.count({ where }),
  ])
  return { list, total, page, pageSize }
}

function eventData(input: Record<string, unknown>, adminId?: number): Prisma.CouponEventUncheckedCreateInput {
  const trigger = String(input.trigger_type ?? input.triggerType ?? '') as CouponTriggerType
  const couponId = String(input.coupon_id ?? input.couponId ?? '').trim()
  const startDate = eventDate(input.start_date ?? input.startDate)
  const endDate = eventDate(input.end_date ?? input.endDate, true)
  if (!Object.values(CouponTriggerType).includes(trigger)) throw new CouponError(400, '发放触发类型不合法')
  if (!couponId) throw new CouponError(400, '请选择优惠券')
  if ((input.start_date ?? input.startDate) && !startDate) throw new CouponError(400, '开始日期不合法')
  if ((input.end_date ?? input.endDate) && !endDate) throw new CouponError(400, '结束日期不合法')
  if (startDate && endDate && endDate < startDate) throw new CouponError(400, '结束日期不能早于开始日期')
  return {
    coupon_id: couponId,
    trigger_type: trigger,
    start_date: startDate,
    end_date: endDate,
    is_active: input.is_active === undefined && input.isActive === undefined ? true : Boolean(input.is_active ?? input.isActive),
    created_by: adminId || Number(input.created_by),
  }
}

function eventDate(input: unknown, endOfDay = false) {
  if (input === undefined || input === null || input === '') return null
  const raw = String(input).trim()
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (dateOnly) {
    const [, year, month, day] = dateOnly
    const date = new Date(Number(year), Number(month) - 1, Number(day), endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0)
    return Number.isFinite(date.getTime()) ? date : null
  }
  const date = new Date(raw)
  return Number.isFinite(date.getTime()) ? date : null
}

async function ensureEventCoupon(couponId: string) {
  const coupon = await prisma.coupon.findUnique({
    where: { id: couponId },
    select: { id: true, status: true },
  })
  if (!coupon) throw new CouponError(404, '优惠券不存在')
  if (coupon.status !== CouponStatus.ACTIVE) throw new CouponError(400, '仅可为启用中的优惠券配置发放规则')
}

export async function createEvent(adminId: number, input: Record<string, unknown>) {
  const data = eventData(input, adminId)
  await ensureEventCoupon(data.coupon_id)
  return prisma.couponEvent.create({ data, include: { coupon: true } })
}

export async function updateEvent(id: string, input: Record<string, unknown>) {
  const data = eventData(input)
  delete (data as any).created_by
  await ensureEventCoupon(data.coupon_id)
  return prisma.couponEvent.update({ where: { id }, data, include: { coupon: true } })
}
export const deleteEvent = (id: string) => prisma.couponEvent.delete({ where: { id } })

export async function distributionRecords(query: Record<string, unknown>) {
  const page = Math.max(1, Number(query.page) || 1), pageSize = Math.min(500, Math.max(1, Number(query.pageSize ?? query.page_size) || 20))
  const where: Prisma.UserCouponWhereInput = {
    source_event_id: { not: null },
    ...(query.user_id ? { user_id: Number(query.user_id) } : {}),
    ...(query.coupon_id ? { coupon_id: String(query.coupon_id) } : {}),
    ...(query.start_date || query.end_date ? { created_at: { ...(query.start_date ? { gte: new Date(String(query.start_date)) } : {}), ...(query.end_date ? { lte: new Date(String(query.end_date)) } : {}) } } : {}),
  }
  const [list, total] = await prisma.$transaction([
    prisma.userCoupon.findMany({ where, include: { coupon: true, user: { select: { id: true, nickname: true, phone: true } } }, orderBy: { created_at: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.userCoupon.count({ where }),
  ])
  return { list, total, page, pageSize }
}
export const manualTrigger = (input: Record<string, unknown>) => triggerCouponDistribution(eventDate(input.date) || new Date())
