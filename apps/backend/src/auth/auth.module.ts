import { Module } from "@nestjs/common";
import { TechnitiumModule } from "../technitium/technitium.module";
import { AuthSessionService } from "./auth-session.service";
import { AuthController } from "./auth.controller";
import { AuthRequestContextMiddleware } from "./auth.middleware";
import { AuthService } from "./auth.service";

@Module({
  imports: [TechnitiumModule],
  controllers: [AuthController],
  providers: [AuthService, AuthSessionService, AuthRequestContextMiddleware],
  exports: [AuthSessionService, AuthRequestContextMiddleware],
})
export class AuthModule {}
