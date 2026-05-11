import { Prisma, PrismaClient, Role } from "@prisma/client";

export class UserError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const prisma = new PrismaClient();

const toAdminLogDetail = (value: unknown): Prisma.InputJsonValue | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value as Prisma.InputJsonValue;
};

type UpdateProfileInput = {
  userId: number;
  nickname?: string | null;
  avatar?: string | null;
  phone?: string | null;
};

export const updateProfile = async (input: UpdateProfileInput) => {
  if (!Number.isFinite(input.userId) || input.userId <= 0) {
    throw new UserError(400, "userId 不合法");
  }

  const hasAnyField = input.nickname !== undefined || input.avatar !== undefined || input.phone !== undefined;
  if (!hasAnyField) {
    throw new UserError(400, "至少需要修改一个字段");
  }

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      const user = await tx.user.findUnique({
        where: { id: input.userId },
        select: { id: true, status: true, nickname: true, phone: true, avatar: true, student_id: true, role: true, credit_score: true },
      });

      if (!user || user.status === -1) {
        throw new UserError(404, "用户不存在");
      }

      const nextData: { nickname?: string | null; phone?: string | null; avatar?: string | null } = {};
      const changes: Record<string, { from: unknown; to: unknown }> = {};

      if (input.nickname !== undefined && input.nickname !== user.nickname) {
        nextData.nickname = input.nickname;
        changes.nickname = { from: user.nickname ?? null, to: input.nickname ?? null };
      }
      if (input.avatar !== undefined && input.avatar !== user.avatar) {
        nextData.avatar = input.avatar;
        changes.avatar = { from: user.avatar ?? null, to: input.avatar ?? null };
      }
      if (input.phone !== undefined && input.phone !== user.phone) {
        if (input.phone) {
          const existing = await tx.user.findFirst({
            where: { phone: input.phone, NOT: { id: input.userId } },
            select: { id: true },
          });
          if (existing) {
            throw new UserError(400, "手机号已存在");
          }
        }
        nextData.phone = input.phone;
        changes.phone = { from: user.phone ?? null, to: input.phone ?? null };
      }

      if (!Object.keys(nextData).length) {
        return user;
      }

      const updated = await tx.user.update({
        where: { id: input.userId },
        data: nextData,
        select: { id: true, student_id: true, phone: true, nickname: true, avatar: true, role: true, credit_score: true },
      });

      await tx.adminLog.create({
        data: {
          admin_id: input.userId,
          action: "USER_PROFILE_UPDATE",
          target_type: "USER",
          target_id: input.userId,
          detail_json: toAdminLogDetail({
            changes,
            at: new Date().toISOString(),
          }),
        },
      });

      return updated;
    });

    return result;
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") {
        throw new UserError(400, "手机号已存在");
      }
    }
    throw err;
  }
};

type SwitchRoleInput = {
  userId: number;
};

export const switchRole = async (input: SwitchRoleInput) => {
  if (!Number.isFinite(input.userId) || input.userId <= 0) {
    throw new UserError(400, "userId 不合法");
  }

  const result = await prisma.$transaction(async (tx: any) => {
    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { id: true, status: true, role: true, student_id: true, phone: true, nickname: true, avatar: true, credit_score: true },
    });

    if (!user || user.status === -1) {
      throw new UserError(404, "用户不存在");
    }

    if (user.role === Role.ADMIN) {
      throw new UserError(403, "管理员不允许切换身份");
    }

    const nextRole =
      user.role === Role.USER ? Role.RUNNER : user.role === Role.RUNNER ? Role.USER : null;

    if (!nextRole) {
      throw new UserError(400, "当前角色不支持切换");
    }

    const updated = await tx.user.update({
      where: { id: input.userId },
      data: { role: nextRole },
      select: { id: true, student_id: true, phone: true, nickname: true, avatar: true, role: true, credit_score: true },
    });

    await tx.adminLog.create({
      data: {
        admin_id: input.userId,
        action: "USER_ROLE_SWITCH",
        target_type: "USER",
        target_id: input.userId,
        detail_json: toAdminLogDetail({
          from: user.role,
          to: nextRole,
          at: new Date().toISOString(),
        }),
      },
    });

    return updated;
  });

  return result;
};
