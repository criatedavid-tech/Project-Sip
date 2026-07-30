import { ExecutionContext, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMISSIONS, ROLES, TokenIssuer } from "@omni/auth";
import { beforeEach, describe, expect, it } from "vitest";
import { AuthGuard, IS_PUBLIC } from "./auth.guard";
import { PermissionsGuard, REQUIRED_PERMISSIONS } from "./permissions.guard";
import type { RequestWithUser } from "./current-user";

const issuer = new TokenIssuer({
  accessSecret: "a".repeat(32),
  refreshSecret: "b".repeat(32),
  accessTtl: "15m",
  refreshTtl: "7d",
});

function contextFor(request: Partial<RequestWithUser>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request as RequestWithUser }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function reflectorReturning(value: unknown): Reflector {
  return { getAllAndOverride: () => value } as unknown as Reflector;
}

describe("AuthGuard", () => {
  let guard: AuthGuard;

  beforeEach(() => {
    guard = new AuthGuard(issuer, reflectorReturning(undefined));
  });

  it("recusa requisição sem cabeçalho Authorization", async () => {
    await expect(guard.canActivate(contextFor({ headers: {} }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("recusa esquema diferente de Bearer", async () => {
    const context = contextFor({ headers: { authorization: "Basic YWJjOjEyMw==" } });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("recusa token assinado por outro emissor", async () => {
    const outro = new TokenIssuer({
      accessSecret: "z".repeat(32),
      refreshSecret: "y".repeat(32),
      accessTtl: "15m",
      refreshTtl: "7d",
    });
    const token = await outro.issueAccessToken({
      sub: "invasor",
      organizationId: "org-2",
      roleKey: ROLES.admin,
      permissions: [],
    });

    const context = contextFor({ headers: { authorization: `Bearer ${token}` } });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("recusa refresh token apresentado como access token", async () => {
    const refresh = await issuer.issueRefreshToken({
      sub: "user-1",
      organizationId: "org-1",
      sessionId: "sess-1",
    });

    const context = contextFor({ headers: { authorization: `Bearer ${refresh}` } });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("aceita token válido e fixa o tenant a partir dele", async () => {
    const token = await issuer.issueAccessToken({
      sub: "user-1",
      organizationId: "org-1",
      roleKey: ROLES.agent,
      permissions: [PERMISSIONS.contactsRead],
    });

    const request: Partial<RequestWithUser> = {
      headers: { authorization: `Bearer ${token}` },
    };
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

    expect(request.user).toEqual({
      userId: "user-1",
      organizationId: "org-1",
      roleKey: ROLES.agent,
      permissions: [PERMISSIONS.contactsRead],
    });
  });

  it("ignora o organizationId que o cliente tentar informar no corpo", async () => {
    const token = await issuer.issueAccessToken({
      sub: "user-1",
      organizationId: "org-1",
      roleKey: ROLES.agent,
      permissions: [],
    });

    const request: Partial<RequestWithUser> = {
      headers: { authorization: `Bearer ${token}` },
      body: { organizationId: "org-da-vitima" },
    };
    await guard.canActivate(contextFor(request));

    expect(request.user?.organizationId).toBe("org-1");
  });

  it("libera rota marcada como pública", async () => {
    const publicGuard = new AuthGuard(issuer, reflectorReturning(true));
    const context = contextFor({ headers: {} });

    await expect(publicGuard.canActivate(context)).resolves.toBe(true);
    expect(IS_PUBLIC).toBe("auth:public");
  });
});

describe("PermissionsGuard", () => {
  const user = {
    userId: "user-1",
    organizationId: "org-1",
    roleKey: ROLES.agent,
    permissions: [PERMISSIONS.recordingsListen],
  };

  it("libera rota sem exigência de permissão", () => {
    const guard = new PermissionsGuard(reflectorReturning(undefined));
    expect(guard.canActivate(contextFor({ user }))).toBe(true);
  });

  it("libera quando o usuário tem a permissão exigida", () => {
    const guard = new PermissionsGuard(
      reflectorReturning([PERMISSIONS.recordingsListen]),
    );
    expect(guard.canActivate(contextFor({ user }))).toBe(true);
  });

  it("bloqueia atendente tentando baixar gravação", () => {
    const guard = new PermissionsGuard(
      reflectorReturning([PERMISSIONS.recordingsDownload]),
    );
    expect(() => guard.canActivate(contextFor({ user }))).toThrow(ForbiddenException);
  });

  it("exige todas as permissões, não apenas uma", () => {
    const guard = new PermissionsGuard(
      reflectorReturning([PERMISSIONS.recordingsListen, PERMISSIONS.usersManage]),
    );
    expect(() => guard.canActivate(contextFor({ user }))).toThrow(ForbiddenException);
  });

  it("bloqueia requisição sem usuário autenticado", () => {
    const guard = new PermissionsGuard(reflectorReturning([PERMISSIONS.contactsRead]));
    expect(() => guard.canActivate(contextFor({}))).toThrow(ForbiddenException);
    expect(REQUIRED_PERMISSIONS).toBe("auth:permissions");
  });
});
