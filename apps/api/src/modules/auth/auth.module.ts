import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";

@Module({
  imports: [ConfigModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
