import { CouponAction, CouponStatus, CouponType, Prisma, PrismaClient, UserCouponStatus } from '@prisma/client'
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
  await prisma.userCoupon.updateMany({
    where: { ...(userId ? { user_id: userId } : {}), status: UserCouponStatus.UNUSED, expired_at: { lt: new Date() } },
    data: { status: UserCouponStatus.EXPIRED },
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
  const where: Prisma.UserCouponWhereInput = { user_id: userId, ...(Object.values(UserCouponStatus).includes(status as UserCouponStatus) ? { status: status as UserCouponStatus } : {}) }
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
      const userCoupon = await tx.userCoupon.create({ data: { user_id: userId, coupon_id: couponId, expired_at: coupon.end_date } })
      await tx.couponLog.create({ data: { user_id: userId, coupon_id: couponId, action, detail: { userCouponId: userCoupon.id } } })
      return userCoupon
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (error) { await limiter.client.decr(limiter.key).catch(() => undefined); throw error }
}

export async function quoteUserCoupon(tx: Prisma.TransactionClient, userId: number, userCouponId: string, orderAmount: Prisma.Decimal.Value) {
  const row = await tx.userCoupon.findFirst({ where: { id: userCouponId, user_id: userId }, include: { coupon: true } })
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
  return { name: String(input.name).trim(), code: String(input.code || code()).trim().toUpperCase(), type, value, min_order_amount: money(String(input.min_order_amount ?? input.minOrderAmount ?? 0)), max_discount: money(String(input.max_discount ?? input.maxDiscount ?? 0)), usage_limit: Math.max(1, Number(input.usage_limit ?? input.usageLimit) || 1), total_limit: Math.max(0, Number(input.total_limit ?? input.totalLimit) || 0), start_date: start, end_date: end, status: (String(input.status || CouponStatus.ACTIVE).toUpperCase() as CouponStatus), created_by: adminId || Number(input.created_by) }
}

export const createCoupon = (adminId: number, input: Record<string, unknown>) => prisma.coupon.create({ data: couponData(input, adminId) })
export const updateCoupon = (id: string, input: Record<string, unknown>) => { const data = couponData(input); delete (data as Partial<typeof data>).created_by; delete (data as Partial<typeof data>).code; return prisma.coupon.update({ where: { id }, data }) }
export async function deleteCoupon(id: string) { const count = await prisma.userCoupon.count({ where: { coupon_id: id } }); if (count) throw new CouponError(409, '已发放的优惠券不能删除，可改为停用'); return prisma.coupon.delete({ where: { id } }) }
export async function usage(id: string) { const coupon = await prisma.coupon.findUnique({ where: { id } }); if (!coupon) throw new CouponError(404, '优惠券不存在'); const grouped = await prisma.userCoupon.groupBy({ by: ['status'], where: { coupon_id: id }, _count: { _all: true } }); return { coupon, received: coupon.received_count, used: coupon.used_count, remaining: coupon.total_limit === 0 ? null : Math.max(0, coupon.total_limit - coupon.received_count), statuses: grouped } }
export const giveCoupon = (userId: number, couponId: string) => receiveCoupon(userId, couponId, CouponAction.ADMIN_GIVE)
