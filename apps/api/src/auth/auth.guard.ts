import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { TokenIssuer } from "@omni/auth";
import type { RequestWithUser } from "./current-user";

export const IS_PUBLIC = "auth:public";
export const Public = () => SetMetadata(IS_PUBLIC, true);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(TokenIssuer) private readonly tokens: TokenIssuer,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const header = request.headers.authorization;

    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException("token ausente");
    }

    try {
      const claims = await this.tokens.verifyAccessToken(header.slice("Bearer ".length));
      request.user = {
        userId: claims.sub,
        organizationId: claims.organizationId,
        roleKey: claims.roleKey,
        permissions: claims.permissions,
      };
      return true;
    } catch {
      // O motivo exato (expirado, assinatura inválida, tipo errado) não volta ao
      // cliente para não virar oráculo sobre tokens.
      throw new UnauthorizedException("token inválido");
    }
  }
}
