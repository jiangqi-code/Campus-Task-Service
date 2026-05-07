import { Prisma, PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

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
};

type LoginInput = {
  account: string;
  password: string;
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

export class AuthService {
  async register(input: RegisterInput) {
    const student_id = input.student_id?.trim();
    const phone = input.phone?.trim();
    const password = input.password ?? "";
    const nickname = input.nickname?.trim();

    if (!student_id || !phone || !password || !nickname) {
      throw new AuthError(400, "student_id、phone、password、nickname 为必填");
    }
    if (password.length < 6) {
      throw new AuthError(400, "password 至少 6 位");
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
      const user = await prisma.user.create({
        data: {
          student_id,
          phone,
          nickname,
          password_hash: passwordHash,
        },
        select: { id: true, role: true },
      });

      const token = signToken({ userId: user.id, role: user.role });
      return { token };
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
      select: { id: true, role: true, password_hash: true },
    });

    if (!user?.password_hash) {
      throw new AuthError(401, "账号或密码错误");
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      throw new AuthError(401, "账号或密码错误");
    }

    const token = signToken({ userId: user.id, role: user.role });
    return { token };
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
}
