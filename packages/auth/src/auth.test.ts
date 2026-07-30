import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";
import { TokenIssuer } from "./tokens";
import { PERMISSIONS, ROLES, ROLE_PERMISSIONS, hasPermission } from "./permissions";

const issuerOptions = {
  accessSecret: "segredo-de-acesso-para-teste",
  refreshSecret: "segredo-de-refresh-para-teste",
  accessTtl: "15m",
  refreshTtl: "7d",
};

describe("senha", () => {
  it("nunca armazena a senha em claro e valida a correta", async () => {
    const hash = await hashPassword("senha-do-usuario");

    expect(hash).not.toContain("senha-do-usuario");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    await expect(verifyPassword(hash, "senha-do-usuario")).resolves.toBe(true);
  });

  it("recusa senha errada", async () => {
    const hash = await hashPassword("certa");
    await expect(verifyPassword(hash, "errada")).resolves.toBe(false);
  });

  it("gera hashes diferentes para a mesma senha (salt por hash)", async () => {
    const [a, b] = await Promise.all([hashPassword("igual"), hashPassword("igual")]);
    expect(a).not.toBe(b);
  });

  it("trata hash malformado como senha inválida, sem lançar", async () => {
    await expect(verifyPassword("nao-e-um-hash", "qualquer")).resolves.toBe(false);
  });
});

describe("TokenIssuer", () => {
  it("emite e valida access token preservando tenant e permissões", async () => {
    const issuer = new TokenIssuer(issuerOptions);
    const token = await issuer.issueAccessToken({
      sub: "user-1",
      organizationId: "org-1",
      roleKey: ROLES.agent,
      permissions: [PERMISSIONS.contactsRead],
    });

    const claims = await issuer.verifyAccessToken(token);

    expect(claims.sub).toBe("user-1");
    expect(claims.organizationId).toBe("org-1");
    expect(claims.permissions).toEqual([PERMISSIONS.contactsRead]);
  });

  it("recusa refresh token apresentado como access token", async () => {
    const issuer = new TokenIssuer(issuerOptions);
    const refresh = await issuer.issueRefreshToken({
      sub: "user-1",
      organizationId: "org-1",
      sessionId: "sess-1",
    });

    await expect(issuer.verifyAccessToken(refresh)).rejects.toThrow();
  });

  it("recusa token assinado com outro segredo", async () => {
    const issuer = new TokenIssuer(issuerOptions);
    const outro = new TokenIssuer({
      ...issuerOptions,
      accessSecret: "segredo-de-um-atacante",
    });

    const token = await outro.issueAccessToken({
      sub: "invasor",
      organizationId: "org-2",
      roleKey: ROLES.admin,
      permissions: [],
    });

    await expect(issuer.verifyAccessToken(token)).rejects.toThrow();
  });

  it("recusa token expirado", async () => {
    const issuer = new TokenIssuer({ ...issuerOptions, accessTtl: "0s" });
    const token = await issuer.issueAccessToken({
      sub: "user-1",
      organizationId: "org-1",
      roleKey: ROLES.agent,
      permissions: [],
    });

    await expect(issuer.verifyAccessToken(token)).rejects.toThrow();
  });

  it("não deixa configurar o mesmo segredo para access e refresh", () => {
    expect(
      () =>
        new TokenIssuer({ ...issuerOptions, refreshSecret: issuerOptions.accessSecret }),
    ).toThrow();
  });

  it("exige que os segredos estejam definidos", () => {
    expect(() => new TokenIssuer({ ...issuerOptions, accessSecret: "" })).toThrow();
  });
});

describe("permissões por perfil", () => {
  it("dá ao administrador todas as permissões", () => {
    expect(ROLE_PERMISSIONS[ROLES.admin]).toHaveLength(Object.values(PERMISSIONS).length);
  });

  it("permite ao atendente ouvir gravação, mas não baixar", () => {
    const agent = ROLE_PERMISSIONS[ROLES.agent];
    expect(hasPermission(agent, PERMISSIONS.recordingsListen)).toBe(true);
    expect(hasPermission(agent, PERMISSIONS.recordingsDownload)).toBe(false);
  });

  it("não deixa atendente nem auditor gerenciar usuários", () => {
    expect(hasPermission(ROLE_PERMISSIONS[ROLES.agent], PERMISSIONS.usersManage)).toBe(false);
    expect(hasPermission(ROLE_PERMISSIONS[ROLES.auditor], PERMISSIONS.usersManage)).toBe(
      false,
    );
  });

  it("mantém o auditor somente leitura", () => {
    const auditor = ROLE_PERMISSIONS[ROLES.auditor];
    expect(auditor.some((permission) => permission.endsWith(":write"))).toBe(false);
  });
});
