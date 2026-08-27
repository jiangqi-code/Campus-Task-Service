import { CouponAction, CouponStatus, MemberLevel, Prisma, PrismaClient, UserCouponStatus } from "@prisma/client";

const prisma = new PrismaClient();

const levelRules = {
  BRONZE: { name: "青铜", minOrders: 0, minCredit: 0, benefit: "基础服务权益", serviceFeeRate: 1 },
  SILVER: { name: "白银", minOrders: 3, minCredit: 60, benefit: "优先查看任务与专属客服入口", serviceFeeRate: 0.98 },
  GOLD: { name: "黄金", minOrders: 10, minCredit: 75, benefit: "优先派单与更低服务费", serviceFeeRate: 0.95 },
  DIAMOND: { name: "钻石", minOrders: 30, minCredit: 90, benefit: "最高优先级、专属客服与服务费折扣", serviceFeeRate: 0.9 },
} as const;

export class MembershipError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

const makeCode = () => `CE${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

async function ensureInviteCode(userId: number) {
  const existing = await prisma.user.findUnique({ where: { id: userId }, select: { invite_code: true } });
  if (!existing) throw new MembershipError(404, "用户不存在");
  if (existing.invite_code) return existing.invite_code;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = makeCode();
    const updated = await prisma.user.updateMany({ where: { id: userId, invite_code: null }, data: { invite_code: code } });
    if (updated.count) return code;
    const current = await prisma.user.findUnique({ where: { id: userId }, select: { invite_code: true } });
    if (current?.invite_code) return current.invite_code;
  }
  throw new MembershipError(500, "邀请码生成失败，请稍后重试");
}

async function getCompletionStats(userId: number) {
  const [taskOrders, foodOrders] = await Promise.all([
    prisma.order.count({ where: { status: "COMPLETED", task: { publisher_id: userId } } }),
    prisma.foodOrder.count({ where: { status: "COMPLETED", user_id: userId } }),
  ]);
  return { taskOrders, foodOrders, completedOrders: taskOrders + foodOrders };
}

function resolveLevel(completedOrders: number, creditScore: number): MemberLevel {
  if (completedOrders >= levelRules.DIAMOND.minOrders && creditScore >= levelRules.DIAMOND.minCredit) return MemberLevel.DIAMOND;
  if (completedOrders >= levelRules.GOLD.minOrders && creditScore >= levelRules.GOLD.minCredit) return MemberLevel.GOLD;
  if (completedOrders >= levelRules.SILVER.minOrders && creditScore >= levelRules.SILVER.minCredit) return MemberLevel.SILVER;
  return MemberLevel.BRONZE;
}

async function issueInviteCoupon(tx: Prisma.TransactionClient, userId: number, couponId: string) {
  const coupon = await tx.coupon.findUnique({ where: { id: couponId } });
  const now = new Date();
  if (!coupon || coupon.status !== CouponStatus.ACTIVE || coupon.start_date > now || coupon.end_date <= now) return false;
  const owned = await tx.userCoupon.count({ where: { user_id: userId, coupon_id: coupon.id } });
  if (owned >= coupon.usage_limit) return false;
  if (coupon.total_limit > 0) {
    const reserved = await tx.coupon.updateMany({ where: { id: coupon.id, received_count: { lt: coupon.total_limit } }, data: { received_count: { increment: 1 } } });
    if (!reserved.count) return false;
  } else {
    await tx.coupon.update({ where: { id: coupon.id }, data: { received_count: { increment: 1 } } });
  }
  const userCoupon = await tx.userCoupon.create({ data: { user_id: userId, coupon_id: coupon.id, status: UserCouponStatus.UNUSED, claimed_at: now, expired_at: coupon.end_date } });
  await tx.couponLog.create({ data: { user_id: userId, coupon_id: coupon.id, action: CouponAction.ADMIN_GIVE, detail: { userCouponId: userCoupon.id, source: "INVITE_REWARD" } } });
  return true;
}

export class MembershipService {
  async getProfile(userId: number) {
    const [user, stats, inviteCode, inviteCount] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { id: true, member_level: true, credit_score: true, invited_by: true } }),
      getCompletionStats(userId),
      ensureInviteCode(userId),
      prisma.user.count({ where: { invited_by: userId } }),
    ]);
    if (!user) throw new MembershipError(404, "用户不存在");
    const level = resolveLevel(stats.completedOrders, user.credit_score);
    if (level !== user.member_level) await prisma.user.update({ where: { id: userId }, data: { member_level: level } });
    const rule = levelRules[level];
    const next = level === MemberLevel.DIAMOND ? null : (level === MemberLevel.BRONZE ? MemberLevel.SILVER : level === MemberLevel.SILVER ? MemberLevel.GOLD : MemberLevel.DIAMOND);
    const nextRule = next ? levelRules[next] : null;
    return {
      level,
      level_name: rule.name,
      benefit: rule.benefit,
      service_fee_rate: rule.serviceFeeRate,
      credit_score: user.credit_score,
      invite_code: inviteCode,
      invite_count: inviteCount,
      invited_by: user.invited_by,
      completed_orders: stats.completedOrders,
      task_orders: stats.taskOrders,
      food_orders: stats.foodOrders,
      next_level: next,
      next_level_name: nextRule?.name ?? null,
      required_orders: nextRule?.minOrders ?? null,
      required_credit: nextRule?.minCredit ?? null,
    };
  }

  async acceptInvite(input: { userId: number; code: unknown }) {
    const code = String(input.code ?? "").trim().toUpperCase();
    if (!/^CE[A-Z0-9]{6}$/.test(code)) throw new MembershipError(400, "邀请码格式不正确");
    const rewardCoupon = await prisma.systemConfig.findUnique({ where: { key: "invite_reward_coupon_id" }, select: { value: true } });
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true, invited_by: true } });
      const inviter = await tx.user.findUnique({ where: { invite_code: code }, select: { id: true } });
      if (!user || !inviter) throw new MembershipError(404, "邀请码不存在");
      if (user.id === inviter.id) throw new MembershipError(400, "不能填写自己的邀请码");
      if (user.invited_by) throw new MembershipError(409, "你已绑定邀请码，不能重复绑定");
      const updated = await tx.user.updateMany({ where: { id: user.id, invited_by: null }, data: { invited_by: inviter.id } });
      if (!updated.count) throw new MembershipError(409, "邀请码已绑定，请勿重复操作");
      const couponId = rewardCoupon?.value?.trim();
      const inviterCoupon = couponId ? await issueInviteCoupon(tx, inviter.id, couponId) : false;
      const inviteeCoupon = couponId ? await issueInviteCoupon(tx, user.id, couponId) : false;
      return { inviter_id: inviter.id, coupon_rewarded: inviterCoupon || inviteeCoupon };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return result;
  }

  async ranking() {
    const users = await prisma.user.findMany({
      where: { invite_code: { not: null } },
      orderBy: [{ invitees: { _count: "desc" } }, { created_at: "asc" }],
      take: 20,
      select: { id: true, nickname: true, avatar: true, member_level: true, _count: { select: { invitees: true } } },
    });
    return users.map((user, index) => ({ rank: index + 1, user_id: user.id, nickname: user.nickname || "校园同学", avatar: user.avatar, member_level: user.member_level, invite_count: user._count.invitees }));
  }
}

export const membershipService = new MembershipService();
