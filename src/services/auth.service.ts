import { Prisma, PrismaClient, Role } from "@prisma/client";
import { parseIdCard } from "../utils/idCard";
import { issueWelcomeCouponsForUser } from "./couponAutomation.service";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { approveRunnerAuth } from "./admin.service";

export class AuthError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const prisma = new PrismaClient();

type RegisterInput = {
  student_id: string;
  phone: string;
  password: string;
  nickname: string;
  birth_date?: string;
  id_card?: string;
  birthDate?: string;
  idCard?: string;
};

type VerificationCodeRecord = { code: string; expiresAt: number; sentAt: number; verifiedAt?: number };
const verificationCodes = new Map<string, VerificationCodeRecord>();
const PHONE_RE = /^1[3-9]\d{9}$/;
const STUDENT_ID_RE = /^[A-Za-z0-9]{6,20}$/;
const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,32}$/;

type LoginInput = {
  account: string;
  password: string;
  ip?: string;
  userAgent?: string;
};

export const UserAuthStatus = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
} as const;

type SubmitAuthInput = {
  userId: number;
  real_name: string;
  student_id?: string;
  phone?: string;
  id_card?: string;
  dormitory?: string;
  reason?: string;
  card_image_url: string;
};

type GetAuthListInput = {
  adminId: number;
  page?: unknown;
  pageSize?: unknown;
  status?: unknown;
};

type AuditAuthInput = {
  adminId: number;
  authId: number;
  action: unknown;
  reason?: unknown;
};

type AuthTokenPayload = {
  userId: number;
  role: Role;
};

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new AuthError(500, "JWT_SECRET is not set. Please add it to .env");
  }
  return secret;
};

const signToken = (payload: AuthTokenPayload) =>
  jwt.sign(payload, getJwtSecret(), { expiresIn: "7d" });

const parseIntOr = (value: unknown, fallback: number) => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const n = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
};

const toUserAuthStatus = (value: unknown): (typeof UserAuthStatus)[keyof typeof UserAuthStatus] | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  const all = Object.values(UserAuthStatus) as string[];
  if (all.includes(normalized)) return normalized as (typeof UserAuthStatus)[keyof typeof UserAuthStatus];
  return null;
};

const toAuditAction = (value: unknown): "approve" | "reject" | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "approve" || normalized === "pass" || normalized === "approved") return "approve";
  if (normalized === "reject" || normalized === "refuse" || normalized === "rejected") return "reject";
  return null;
};

const toAdminLogDetail = (value: unknown): Prisma.InputJsonValue | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value as Prisma.InputJsonValue;
};

export class AuthService {
  sendVerificationCode(rawPhone: string) {
    const phone = rawPhone?.trim();
    if (!PHONE_RE.test(phone)) throw new AuthError(400, '请输入正确的11位手机号');
    const now = Date.now();
    const previous = verificationCodes.get(phone);
    if (previous && now - previous.sentAt < 60_000) {
      throw new AuthError(429, '验证码发送过于频繁，请稍后再试');
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    verificationCodes.set(phone, { code, sentAt: now, expiresAt: now + 5 * 60_000 });
    console.info(`[auth] mock verification code for ${phone}: ${code}`);
    return {
      message: '验证码已发送',
      expiresIn: 300,
      resendAfter: 60,
      ...(process.env.NODE_ENV === 'production' ? {} : { mockCode: code }),
    };
  }

  verifyVerificationCode(rawPhone: string, rawCode: string) {
    const phone = rawPhone?.trim();
    const code = rawCode?.trim();
    if (!PHONE_RE.test(phone)) throw new AuthError(400, '请输入正确的11位手机号');
    if (!/^\d{6}$/.test(code)) throw new AuthError(400, '验证码必须是6位数字');
    const record = verificationCodes.get(phone);
    if (!record || record.expiresAt < Date.now()) {
      verificationCodes.delete(phone);
      throw new AuthError(400, '验证码已失效，请重新获取');
    }
    if (record.code !== code) throw new AuthError(400, '验证码错误');
    record.verifiedAt = Date.now();
    verificationCodes.set(phone, record);
    return { verified: true };
  }

  async register(input: RegisterInput) {
    const student_id = input.student_id?.trim();
    const phone = input.phone?.trim();
    const password = input.password ?? "";
    const nickname = input.nickname?.trim();
    const idCard = (input.id_card ?? input.idCard)?.trim().toUpperCase() || undefined;
    const parsedIdCard = idCard ? parseIdCard(idCard) : null;
    if (idCard && !parsedIdCard?.isValid) throw new AuthError(400, "身份证号格式或校验位不正确");
    const rawBirthDate = input.birth_date ?? input.birthDate;
    const explicitBirthDate = rawBirthDate ? new Date(rawBirthDate) : null;
    if (explicitBirthDate && !Number.isFinite(explicitBirthDate.getTime())) throw new AuthError(400, "出生日期不合法");
    const birthDate = parsedIdCard?.birthDate || explicitBirthDate || undefined;

    if (!student_id || !phone || !password || !nickname) {
      throw new AuthError(400, "student_id、phone、password、nickname 为必填");
    }
    if (password.length < 6) {
      throw new AuthError(400, "password 至少 6 位");
    }

    if (!STUDENT_ID_RE.test(student_id)) throw new AuthError(400, '学号需为6-20位字母或数字');
    if (!PHONE_RE.test(phone)) throw new AuthError(400, '请输入正确的11位手机号');
    if (!PASSWORD_RE.test(password)) throw new AuthError(400, '密码需为8-32位，且包含字母和数字');
    const verification = verificationCodes.get(phone);
    if (!verification?.verifiedAt || verification.expiresAt < Date.now()) {
      throw new AuthError(400, '请先完成手机验证码校验');
    }

    const existing = await prisma.user.findFirst({
      where: { OR: [{ student_id }, { phone }] },
      select: { student_id: true, phone: true },
    });

    if (existing?.student_id === student_id) {
      throw new AuthError(400, "学号已存在");
    }
    if (existing?.phone === phone) {
      throw new AuthError(400, "手机号已存在");
    }

    try {
      const passwordHash = await bcrypt.hash(password, 10);
      const user = await prisma.$transaction(async (tx) => {
        const createdUser = await tx.user.create({
          data: {
            student_id,
            phone,
            nickname,
            password_hash: passwordHash,
            birth_date: birthDate,
            id_card: idCard,
          },
          select: { id: true, role: true, student_id: true, phone: true, nickname: true, birth_date: true, id_card: true },
        });

        await tx.userWallet.create({
          data: {
            user_id: createdUser.id,
            balance: new Prisma.Decimal(0),
            frozen: new Prisma.Decimal(0),
          },
          select: { id: true },
        });

        const welcomeCoupons = await issueWelcomeCouponsForUser(tx, createdUser.id);

        return { ...createdUser, welcomeCoupons };
      });

      const token = signToken({ userId: user.id, role: user.role });
      verificationCodes.delete(phone);
      const { welcomeCoupons, ...safeUser } = user;
      return { token, user: safeUser, welcomeCoupons };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === "P2002") {
          throw new AuthError(400, "学号或手机号已存在");
        }
      }
      throw err;
    }
  }

  async login(input: LoginInput) {
    const account = input.account?.trim();
    const password = input.password ?? "";

    if (!account || !password) {
      throw new AuthError(400, "account、password 为必填");
    }

    const user = await prisma.user.findFirst({
      where: { OR: [{ student_id: account }, { phone: account }] },
      select: {
        id: true,
        student_id: true,
        phone: true,
        nickname: true,
        avatar: true,
        role: true,
        status: true,
        credit_score: true,
        birth_date: true,
        id_card: true,
        password_hash: true,
      },
    });

    if (!user?.password_hash) {
      throw new AuthError(401, "账号或密码错误");
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      throw new AuthError(401, "账号或密码错误");
    }

    const loginTime = new Date();
    const ip = typeof input.ip === "string" ? input.ip.trim() : "";
    const userAgent = typeof input.userAgent === "string" ? input.userAgent.trim() : "";

    await prisma.loginLog
      .create({
        data: {
          user_id: user.id,
          login_time: loginTime,
          ip,
          user_agent: userAgent,
        },
      })
      .catch(() => null);

    const token = signToken({ userId: user.id, role: user.role });
    const { password_hash: _passwordHash, ...safeUser } = user;
    return { token, user: safeUser };
  }

  async me(userId: number) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        student_id: true,
        phone: true,
        nickname: true,
        role: true,
        credit_score: true,
      },
    });

    if (!user) {
      throw new AuthError(404, "User not found");
    }

    return user;
  }

  async getAuthStatus(userId: number) {
    if (!Number.isFinite(userId) || userId <= 0) {
      throw new AuthError(400, "userId 不合法");
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        status: true,
        role: true,
        auth: {
          select: {
            audit_status: true,
            real_name: true,
            card_image_url: true,
            student_id: true,
            phone: true,
            id_card: true,
            dormitory: true,
            reason: true,
            admin_id: true,
            processed_at: true,
            admin: { select: { id: true, student_id: true, phone: true, nickname: true, role: true } },
            created_at: true,
            updated_at: true,
          },
        },
      },
    });

    if (!user || user.status === -1) {
      throw new AuthError(404, "用户不存在");
    }

    const hasApplied = Boolean(user.auth);
    const authStatus = hasApplied ? toUserAuthStatus(user.auth?.audit_status) : null;
    const runnerApproved = user.role === Role.RUNNER;

    return { hasApplied, authStatus, status: authStatus, runnerApproved, auth: user.auth ?? null };
  }

  async submitAuth(input: SubmitAuthInput) {
    if (!Number.isFinite(input.userId) || input.userId <= 0) {
      throw new AuthError(400, "userId 不合法");
    }

    const real_name = input.real_name?.trim();
    const card_image_url = input.card_image_url?.trim();
    const student_id = typeof input.student_id === "string" ? input.student_id.trim() : "";
    const phone = typeof input.phone === "string" ? input.phone.trim() : "";
    const id_card = typeof input.id_card === "string" ? input.id_card.trim() : "";
    const dormitory = typeof input.dormitory === "string" ? input.dormitory.trim() : "";
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";

    if (!real_name || !card_image_url) {
      throw new AuthError(400, "real_name、card_image_url 为必填");
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: input.userId },
          select: { id: true, status: true },
        });
        if (!user || user.status === -1) {
          throw new AuthError(404, "用户不存在");
        }

        const existing = await tx.userAuth.findUnique({
          where: { user_id: input.userId },
          select: { id: true, audit_status: true },
        });

        const existingStatus = toUserAuthStatus(existing?.audit_status) ?? null;
        if (existing && existingStatus === UserAuthStatus.PENDING) {
          throw new AuthError(409, "已有待审核申请，请勿重复提交");
        }
        if (existing && existingStatus === UserAuthStatus.APPROVED) {
          throw new AuthError(409, "已通过认证");
        }

        const auth = existing
          ? await tx.userAuth.update({
              where: { id: existing.id },
              data: {
                real_name,
                card_image_url,
                audit_status: UserAuthStatus.PENDING,
                student_id: student_id || null,
                phone: phone || null,
                id_card: id_card || null,
                dormitory: dormitory || null,
                reason: reason || null,
                admin_id: null,
                processed_at: null,
              },
            })
          : await tx.userAuth.create({
              data: {
                user_id: input.userId,
                real_name,
                card_image_url,
                audit_status: UserAuthStatus.PENDING,
                student_id: student_id || null,
                phone: phone || null,
                id_card: id_card || null,
                dormitory: dormitory || null,
                reason: reason || null,
              },
            });

        return auth;
      });

      return { auth: result };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === "P2002") {
          throw new AuthError(409, "已有待审核申请，请勿重复提交");
        }
      }
      throw err;
    }

  }

  async getAuthList(input: GetAuthListInput) {
    if (!Number.isFinite(input.adminId) || input.adminId <= 0) {
      throw new AuthError(400, "adminId 不合法");
    }

    const admin = await prisma.user.findUnique({
      where: { id: input.adminId },
      select: { id: true, role: true, status: true },
    });
    if (!admin || admin.status === -1) {
      throw new AuthError(404, "管理员不存在");
    }
    if (admin.role !== Role.ADMIN) {
      throw new AuthError(403, "无权限");
    }

    const page = Math.max(1, parseIntOr(input.page, 1));
    const pageSize = Math.min(100, Math.max(1, parseIntOr(input.pageSize, 10)));
    const skip = (page - 1) * pageSize;

    const status = toUserAuthStatus(input.status);

    const where: Prisma.UserAuthWhereInput = {};
    if (status) {
      where.audit_status = status;
    }

    const [total, items] = await Promise.all([
      prisma.userAuth.count({ where }),
      prisma.userAuth.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take: pageSize,
        select: {
          id: true,
          user_id: true,
          real_name: true,
          card_image_url: true,
          student_id: true,
          phone: true,
          id_card: true,
          dormitory: true,
          reason: true,
          audit_status: true,
          admin_id: true,
          processed_at: true,
          created_at: true,
          updated_at: true,
          user: {
            select: { id: true, student_id: true, phone: true, nickname: true, role: true, status: true },
          },
          admin: {
            select: { id: true, student_id: true, phone: true, nickname: true, role: true, status: true },
          },
        },
      }),
    ]);

    return { page, pageSize, total, items };
  }

  async auditAuth(input: AuditAuthInput) {
    if (!Number.isFinite(input.adminId) || input.adminId <= 0) {
      throw new AuthError(400, "adminId 不合法");
    }
    if (!Number.isFinite(input.authId) || input.authId <= 0) {
      throw new AuthError(400, "authId 不合法");
    }

    const admin = await prisma.user.findUnique({
      where: { id: input.adminId },
      select: { id: true, role: true, status: true },
    });
    if (!admin || admin.status === -1) {
      throw new AuthError(404, "管理员不存在");
    }
    if (admin.role !== Role.ADMIN) {
      throw new AuthError(403, "无权限");
    }

    const action = toAuditAction(input.action);
    if (!action) {
      throw new AuthError(400, "action 不合法");
    }

    const reasonRaw = typeof input.reason === "string" ? input.reason.trim() : "";
    const reason = reasonRaw ? reasonRaw : null;
    if (action === "reject" && !reason) {
      throw new AuthError(400, "reason 为必填");
    }

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const auth = await tx.userAuth.findUnique({
        where: { id: input.authId },
        select: { id: true, user_id: true, audit_status: true },
      });
      if (!auth) {
        throw new AuthError(404, "认证申请不存在");
      }
      if (auth.audit_status !== UserAuthStatus.PENDING) {
        throw new AuthError(409, "认证申请状态不是 PENDING");
      }

      if (action === "approve") {
        const authUpdated = await tx.userAuth.update({
          where: { id: auth.id },
          data: { audit_status: UserAuthStatus.APPROVED, admin_id: input.adminId, processed_at: now },
        });

        await tx.user.update({
          where: { id: auth.user_id },
          data: { role: "RUNNER" },
        });

        await approveRunnerAuth(tx, auth.user_id);

        await tx.adminLog.create({
          data: {
            admin_id: input.adminId,
            action: "USER_AUTH_AUDIT",
            target_type: "USER_AUTH",
            target_id: auth.id,
            detail_json: toAdminLogDetail({
              decision: "APPROVE",
              user_id: auth.user_id,
              to_status: UserAuthStatus.APPROVED,
              at: now.toISOString(),
            }),
          },
        });

        return authUpdated;
      }

      const authUpdated = await tx.userAuth.update({
        where: { id: auth.id },
        data: { audit_status: UserAuthStatus.REJECTED, admin_id: input.adminId, processed_at: now },
      });

      await tx.adminLog.create({
        data: {
          admin_id: input.adminId,
          action: "USER_AUTH_AUDIT",
          target_type: "USER_AUTH",
          target_id: auth.id,
          detail_json: toAdminLogDetail({
            decision: "REJECT",
            reason,
            user_id: auth.user_id,
            to_status: UserAuthStatus.REJECTED,
            at: now.toISOString(),
          }),
        },
      });

      return authUpdated;
    });

    return { auth: updated };
  }
}
