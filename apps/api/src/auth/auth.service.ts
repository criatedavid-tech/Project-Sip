import { randomUUID } from "node:crypto";
import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { ROLE_PERMISSIONS, TokenIssuer, verifyPassword, type RoleKey } from "@omni/auth";
import { withUser, type Database } from "@omni/db";
import { schema } from "@omni/db";
import { DATABASE } from "../database/database.module";

export interface LoginRequest {
  email: string;
  password: string;
  /** Necessário apenas quando o usuário pertence a mais de uma organização. */
  organizationId?: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  organizationId: string;
  user: { id: string; name: string; email: string; roleKey: string };
}

interface Membership {
  organizationId: string;
  roleKey: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly tokens: TokenIssuer,
  ) {}

  async login(request: LoginRequest): Promise<LoginResult> {
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, request.email.toLowerCase().trim()))
      .limit(1);

    // A verificação roda mesmo sem usuário encontrado para que o tempo de
    // resposta não revele quais e-mails existem.
    const passwordOk = user
      ? await verifyPassword(user.passwordHash, request.password)
      : await this.wasteTime();

    if (!user || !passwordOk) {
      throw new UnauthorizedException("credenciais inválidas");
    }

    const memberships = await this.loadMemberships(user.id);
    if (memberships.length === 0) {
      throw new UnauthorizedException("usuário sem organização ativa");
    }

    const membership = this.selectMembership(memberships, request.organizationId);

    const permissions = ROLE_PERMISSIONS[membership.roleKey as RoleKey] ?? [];
    const [accessToken, refreshToken] = await Promise.all([
      this.tokens.issueAccessToken({
        sub: user.id,
        organizationId: membership.organizationId,
        roleKey: membership.roleKey,
        permissions,
      }),
      this.tokens.issueRefreshToken({
        sub: user.id,
        organizationId: membership.organizationId,
        sessionId: randomUUID(),
      }),
    ]);

    return {
      accessToken,
      refreshToken,
      organizationId: membership.organizationId,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        roleKey: membership.roleKey,
      },
    };
  }

  async refresh(refreshToken: string): Promise<LoginResult> {
    let claims;
    try {
      claims = await this.tokens.verifyRefreshToken(refreshToken);
    } catch {
      throw new UnauthorizedException("refresh token inválido");
    }

    const memberships = await this.loadMemberships(claims.sub);
    const membership = memberships.find(
      (item) => item.organizationId === claims.organizationId,
    );

    // Perder o vínculo (desligamento, troca de organização) invalida a sessão
    // na primeira renovação, sem esperar o access token expirar.
    if (!membership) {
      throw new UnauthorizedException("vínculo não é mais válido");
    }

    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, claims.sub))
      .limit(1);

    if (!user) {
      throw new UnauthorizedException("usuário não encontrado");
    }

    const permissions = ROLE_PERMISSIONS[membership.roleKey as RoleKey] ?? [];
    const [accessToken, nextRefreshToken] = await Promise.all([
      this.tokens.issueAccessToken({
        sub: user.id,
        organizationId: membership.organizationId,
        roleKey: membership.roleKey,
        permissions,
      }),
      this.tokens.issueRefreshToken({
        sub: user.id,
        organizationId: membership.organizationId,
        sessionId: randomUUID(),
      }),
    ]);

    return {
      accessToken,
      refreshToken: nextRefreshToken,
      organizationId: membership.organizationId,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        roleKey: membership.roleKey,
      },
    };
  }

  private async loadMemberships(userId: string): Promise<Membership[]> {
    return withUser(this.db, userId, async (tx) => {
      const rows = await tx
        .select({
          organizationId: schema.organizationUsers.organizationId,
          roleKey: schema.roles.key,
        })
        .from(schema.organizationUsers)
        .innerJoin(schema.roles, eq(schema.roles.id, schema.organizationUsers.roleId))
        .where(
          and(
            eq(schema.organizationUsers.userId, userId),
            isNull(schema.organizationUsers.deactivatedAt),
          ),
        );
      return rows;
    });
  }

  private selectMembership(
    memberships: Membership[],
    requestedOrganizationId?: string,
  ): Membership {
    if (!requestedOrganizationId) {
      return memberships[0]!;
    }

    const found = memberships.find(
      (item) => item.organizationId === requestedOrganizationId,
    );
    if (!found) {
      // Mesma resposta de credencial inválida: confirmar a existência da
      // organização entregaria informação a quem não é membro.
      throw new UnauthorizedException("credenciais inválidas");
    }
    return found;
  }

  private async wasteTime(): Promise<false> {
    await verifyPassword(
      "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$JmVQ1ePvZ1Vd0Wr8gGxN0Kk2Vm8dQ0lNQKzVYnZQ2Zg",
      "senha-que-nunca-confere",
    );
    return false;
  }
}
