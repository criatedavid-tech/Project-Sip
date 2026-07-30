import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

export interface AuthenticatedUser {
  userId: string;
  organizationId: string;
  roleKey: string;
  permissions: string[];
}

/**
 * O tenant vem sempre do token, nunca de parâmetro da requisição: aceitar
 * organizationId do cliente permitiria trocar de tenant só mudando a URL.
 */
export interface RequestWithUser extends Request {
  user?: AuthenticatedUser;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (!request.user) {
      throw new Error("CurrentUser usado em rota sem AuthGuard");
    }
    return request.user;
  },
);
