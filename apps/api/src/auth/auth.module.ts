import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { TokenIssuer } from "@omni/auth";
import { loadEnv } from "@omni/config";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AuthGuard } from "./auth.guard";
import { PermissionsGuard } from "./permissions.guard";

const tokenIssuerProvider = {
  provide: TokenIssuer,
  useFactory: (): TokenIssuer => {
    const env = loadEnv();
    return new TokenIssuer({
      accessSecret: env.JWT_ACCESS_SECRET,
      refreshSecret: env.JWT_REFRESH_SECRET,
      accessTtl: env.JWT_ACCESS_TTL,
      refreshTtl: env.JWT_REFRESH_TTL,
    });
  },
};

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    tokenIssuerProvider,
    // Autenticação é o padrão: rota nova nasce protegida e só abre com @Public().
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [tokenIssuerProvider],
})
export class AuthModule {}
