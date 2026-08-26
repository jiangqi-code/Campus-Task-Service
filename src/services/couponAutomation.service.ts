import { CouponAction, CouponStatus, CouponTriggerType, Prisma, PrismaClient, UserCouponStatus } from '@prisma/client'

const prisma = new PrismaClient()
const pad = (n: number) => String(n).padStart(2, '0')
const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const fixedHolidays = new Set(['01-01', '05-01', '10-01', '10-02', '10-03'])
const welcomeWindowMs = Math.max(60_000, Number(process.env.WELCOME_COUPON_WINDOW_MS) || 24 * 60 * 60 * 1000)
type EventWithCoupon = Prisma.CouponEventGetPayload<{ include: { coupon: true } }>

function isHoliday(date: Date) {
  const configured = String(process.env.HOLIDAY_DATES || '').split(',').map(v => v.trim()).filter(Boolean)
  return configured.includes(dayKey(date)) || fixedHolidays.has(`${pad(date.getMonth() + 1)}-${pad(date.getDate())}`)
}

function dayBounds(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start, end }
}

function distributionKey(event: EventWithCoupon, userId: number, date: Date) {
  return event.trigger_type === CouponTriggerType.NEW_USER
    ? `${event.id}:${userId}:NEW_USER`
    : `${event.id}:${userId}:${dayKey(date)}`
}

function couponExpiry(event: EventWithCoupon, date: Date) {
  const expires = new Date(date)
  expires.setDate(expires.getDate() + Math.max(1, event.coupon.validity_days))
  return expires < event.coupon.end_date ? expires : event.coupon.end_date
}

async function issueEventCoupon(
  tx: Prisma.TransactionClient,
  event: EventWithCoupon,
  userId: number,
  date: Date,
) {
  const key = distributionKey(event, userId, date)
  const existing = event.trigger_type === CouponTriggerType.NEW_USER
    ? await tx.userCoupon.findFirst({
        where: { user_id: userId, source_event_id: event.id },
        include: { coupon: true },
      })
    : await tx.userCoupon.findUnique({
        where: { distribution_key: key },
        include: { coupon: true },
      })
  if (existing) return { row: existing, created: false }

  if (event.coupon.total_limit > 0) {
    const reserved = await tx.coupon.updateMany({
      where: { id: event.coupon_id, received_count: { lt: event.coupon.total_limit } },
      data: { received_count: { increment: 1 } },
    })
    if (!reserved.count) return null
  } else {
    await tx.coupon.update({
      where: { id: event.coupon_id },
      data: { received_count: { increment: 1 } },
    })
  }

  const row = await tx.userCoupon.create({
    data: {
      user_id: userId,
      coupon_id: event.coupon_id,
      status: UserCouponStatus.UNUSED,
      expired_at: couponExpiry(event, date),
      source_event_id: event.id,
      distribution_key: key,
    },
    include: { coupon: true },
  })
  await tx.couponLog.create({
    data: {
      user_id: userId,
      coupon_id: event.coupon_id,
      action: CouponAction.ADMIN_GIVE,
      detail: { eventId: event.id, triggerType: event.trigger_type, pendingClaim: true },
    },
  })
  return { row, created: true }
}

export async function issueWelcomeCouponsForUser(tx: Prisma.TransactionClient, userId: number, date = new Date()) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { created_at: true, status: true } })
  if (!user || user.status !== 1 || date.getTime() - user.created_at.getTime() > welcomeWindowMs) return []

  const { start, end } = dayBounds(date)
  const events = await tx.couponEvent.findMany({
    where: {
      trigger_type: CouponTriggerType.NEW_USER,
      is_active: true,
      AND: [{ OR: [{ start_date: null }, { start_date: { lte: end } }] }, { OR: [{ end_date: null }, { end_date: { gte: start } }] }],
      coupon: { status: CouponStatus.ACTIVE, start_date: { lte: date }, end_date: { gt: date } },
    },
    include: { coupon: true },
  })
  const issued: any[] = []
  for (const event of events) {
    const result = await issueEventCoupon(tx, event, userId, date)
    if (result) issued.push(result.row)
  }
  return issued
}

async function targetUserIds(trigger: CouponTriggerType, date: Date) {
  const { start, end } = dayBounds(date)
  if (trigger === CouponTriggerType.NEW_USER) {
    return (await prisma.user.findMany({ where: { created_at: { gte: start, lt: end }, status: 1 }, select: { id: true } })).map(v => v.id)
  }
  if (trigger === CouponTriggerType.BIRTHDAY) {
    const rows = await prisma.$queryRaw<Array<{ id: number }>>`SELECT id FROM users WHERE status = 1 AND birth_date IS NOT NULL AND MONTH(birth_date) = ${date.getMonth() + 1} AND DAY(birth_date) = ${date.getDate()}`
    return rows.map(v => v.id)
  }
  if (trigger === CouponTriggerType.HOLIDAY && isHoliday(date)) {
    return (await prisma.user.findMany({ where: { status: 1 }, select: { id: true } })).map(v => v.id)
  }
  return []
}

export async function triggerCouponDistribution(date = new Date()) {
  const { start, end } = dayBounds(date)
  const events = await prisma.couponEvent.findMany({
    where: {
      is_active: true,
      AND: [{ OR: [{ start_date: null }, { start_date: { lte: end } }] }, { OR: [{ end_date: null }, { end_date: { gte: start } }] }],
      coupon: { status: CouponStatus.ACTIVE, start_date: { lte: date }, end_date: { gt: date } },
    },
    include: { coupon: true },
  })
  let created = 0
  const details: Array<{ eventId: string; triggerType: CouponTriggerType; issued: number }> = []
  for (const event of events) {
    const users = await targetUserIds(event.trigger_type, date)
    let issued = 0
    for (const userId of users) {
      try {
        const result = await prisma.$transaction(
          (tx) => issueEventCoupon(tx, event, userId, date),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        )
        if (result?.created) issued += 1
      } catch (error: any) {
        if (error?.code !== 'P2002') throw error
      }
    }
    created += issued
    details.push({ eventId: event.id, triggerType: event.trigger_type, issued })
  }
  return { date: dayKey(date), created, events: details }
}
