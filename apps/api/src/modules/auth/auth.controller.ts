import { Body, Controller, Get, Headers, Post, UnauthorizedException } from "@nestjs/common";
import { AuthService } from "./auth.service.js";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  async register(@Body() body: { email: string; password: string; displayName?: string }) {
    return this.authService.register(body.email, body.password, body.displayName);
  }

  @Post("login")
  async login(@Body() body: { email: string; password: string }) {
    return this.authService.login(body.email, body.password);
  }

  @Get("me")
  async me(@Headers("authorization") authorization?: string) {
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
    if (!token) {
      throw new UnauthorizedException("Missing bearer token.");
    }
    const payload = this.authService.verifyToken(token);
    return this.authService.me(payload.sub);
  }
}
