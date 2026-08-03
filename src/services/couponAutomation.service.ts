import { CouponAction, CouponStatus, CouponTriggerType, Prisma, PrismaClient, UserCouponStatus } from '@prisma/client'

const prisma = new PrismaClient()
const pad = (n: number) => String(n).padStart(2, '0')
const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const fixedHolidays = new Set(['01-01', '05-01', '10-01', '10-02', '10-03'])

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

export async function issueWelcomeCouponsForUser(tx: Prisma.TransactionClient, userId: number, date = new Date()) {
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
    const key = `${event.id}:${userId}:${dayKey(date)}`
    const existing = await tx.userCoupon.findUnique({ where: { distribution_key: key }, include: { coupon: true } })
    if (existing) { issued.push(existing); continue }
    if (event.coupon.total_limit > 0) {
      const reserved = await tx.coupon.updateMany({ where: { id: event.coupon_id, received_count: { lt: event.coupon.total_limit } }, data: { received_count: { increment: 1 } } })
      if (!reserved.count) continue
    } else {
      await tx.coupon.update({ where: { id: event.coupon_id }, data: { received_count: { increment: 1 } } })
    }
    const expires = new Date(date)
    expires.setDate(expires.getDate() + Math.max(1, event.coupon.validity_days))
    const row = await tx.userCoupon.create({
      data: { user_id: userId, coupon_id: event.coupon_id, status: UserCouponStatus.UNUSED, expired_at: expires, source_event_id: event.id, distribution_key: key },
      include: { coupon: true },
    })
    await tx.couponLog.create({ data: { user_id: userId, coupon_id: event.coupon_id, action: CouponAction.ADMIN_GIVE, detail: { eventId: event.id, triggerType: CouponTriggerType.NEW_USER, pendingClaim: true } } })
    issued.push(row)
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
      coupon: { status: CouponStatus.ACTIVE },
    },
    include: { coupon: true },
  })
  let created = 0
  const details: Array<{ eventId: string; triggerType: CouponTriggerType; issued: number }> = []
  for (const event of events) {
    const users = await targetUserIds(event.trigger_type, date)
    let issued = 0
    for (const userId of users) {
      const key = `${event.id}:${userId}:${dayKey(date)}`
      const expires = new Date(date)
      expires.setDate(expires.getDate() + Math.max(1, event.coupon.validity_days))
      try {
        await prisma.$transaction(async tx => {
          await tx.userCoupon.create({
            data: {
              user_id: userId, coupon_id: event.coupon_id, status: UserCouponStatus.UNUSED,
              expired_at: expires, source_event_id: event.id, distribution_key: key,
            },
          })
          await tx.coupon.update({ where: { id: event.coupon_id }, data: { received_count: { increment: 1 } } })
          await tx.couponLog.create({ data: { user_id: userId, coupon_id: event.coupon_id, action: CouponAction.ADMIN_GIVE, detail: { eventId: event.id, triggerType: event.trigger_type, pendingClaim: true } } })
        })
        issued += 1
      } catch (error: any) {
        if (error?.code !== 'P2002') throw error
      }
    }
    created += issued
    details.push({ eventId: event.id, triggerType: event.trigger_type, issued })
  }
  return { date: dayKey(date), created, events: details }
}
