import { Injectable, UnauthorizedException, ConflictException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Model } from "mongoose";
import { UserEntity, type UserDocument } from "../../database/mongo.schemas.js";
import { getAppEnv } from "../../runtime/app-env.js";

@Injectable()
export class AuthService {
  constructor(@InjectModel(UserEntity.name) private readonly users: Model<UserDocument>) {}

  async register(email: string, password: string, displayName?: string) {
    const existing = await this.users.findOne({ email }).lean();
    if (existing) {
      throw new ConflictException("A user with that email already exists.");
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.users.create({ email, passwordHash, displayName: displayName ?? null });
    return this.issueToken(user._id, user.email);
  }

  async login(email: string, password: string) {
    const user = await this.users.findOne({ email }).lean();
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
    const user = await this.users.findById(userId).lean();
    if (!user) {
      return null;
    }
    return {
      id: user._id,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt,
    };
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
