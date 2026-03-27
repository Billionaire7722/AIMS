import { Injectable, UnauthorizedException, ConflictException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getAppEnv } from "../../runtime/app-env.js";

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async register(email: string, password: string, displayName?: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException("A user with that email already exists.");
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.prisma.user.create({
      data: { email, passwordHash, displayName },
    });
    return this.issueToken(user.id, user.email);
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new UnauthorizedException("Invalid email or password.");
    }
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException("Invalid email or password.");
    }
    return this.issueToken(user.id, user.email);
  }

  async me(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        createdAt: true,
      },
    });
  }

  issueToken(userId: string, email: string) {
    const env = getAppEnv();
    const token = jwt.sign({ sub: userId, email }, env.JWT_SECRET, { expiresIn: "7d" });
    return { token };
  }

  verifyToken(token: string) {
    const env = getAppEnv();
    return jwt.verify(token, env.JWT_SECRET) as { sub: string; email: string };
  }
}
