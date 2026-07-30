import { SignJWT, jwtVerify, type JWTPayload } from "jose";

export type TokenKind = "access" | "refresh";

export interface AccessTokenClaims {
  sub: string;
  organizationId: string;
  roleKey: string;
  permissions: string[];
}

export interface RefreshTokenClaims {
  sub: string;
  organizationId: string;
  /** Identifica a sessão para permitir revogação individual. */
  sessionId: string;
}

export interface TokenIssuerOptions {
  accessSecret: string;
  refreshSecret: string;
  accessTtl: string;
  refreshTtl: string;
  issuer?: string;
  audience?: string;
}

const DEFAULT_ISSUER = "omni-platform";
const DEFAULT_AUDIENCE = "omni-platform-api";

export class TokenIssuer {
  private readonly accessKey: Uint8Array;
  private readonly refreshKey: Uint8Array;
  private readonly issuer: string;
  private readonly audience: string;

  constructor(private readonly options: TokenIssuerOptions) {
    if (!options.accessSecret || !options.refreshSecret) {
      throw new Error("JWT_ACCESS_SECRET e JWT_REFRESH_SECRET são obrigatórios");
    }
    if (options.accessSecret === options.refreshSecret) {
      // Segredos iguais permitiriam usar um refresh token como access token.
      throw new Error("JWT_ACCESS_SECRET e JWT_REFRESH_SECRET precisam ser diferentes");
    }
    this.accessKey = new TextEncoder().encode(options.accessSecret);
    this.refreshKey = new TextEncoder().encode(options.refreshSecret);
    this.issuer = options.issuer ?? DEFAULT_ISSUER;
    this.audience = options.audience ?? DEFAULT_AUDIENCE;
  }

  issueAccessToken(claims: AccessTokenClaims): Promise<string> {
    return this.sign({ ...claims, kind: "access" }, this.accessKey, this.options.accessTtl);
  }

  issueRefreshToken(claims: RefreshTokenClaims): Promise<string> {
    return this.sign(
      { ...claims, kind: "refresh" },
      this.refreshKey,
      this.options.refreshTtl,
    );
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    const payload = await this.verify(token, this.accessKey, "access");
    return {
      sub: payload.sub as string,
      organizationId: payload.organizationId as string,
      roleKey: payload.roleKey as string,
      permissions: (payload.permissions as string[]) ?? [],
    };
  }

  async verifyRefreshToken(token: string): Promise<RefreshTokenClaims> {
    const payload = await this.verify(token, this.refreshKey, "refresh");
    return {
      sub: payload.sub as string,
      organizationId: payload.organizationId as string,
      sessionId: payload.sessionId as string,
    };
  }

  private sign(
    payload: JWTPayload & { kind: TokenKind },
    key: Uint8Array,
    ttl: string,
  ): Promise<string> {
    const { sub, ...rest } = payload;
    return new SignJWT(rest)
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(sub as string)
      .setIssuedAt()
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setExpirationTime(ttl)
      .sign(key);
  }

  private async verify(
    token: string,
    key: Uint8Array,
    expectedKind: TokenKind,
  ): Promise<JWTPayload> {
    const { payload } = await jwtVerify(token, key, {
      issuer: this.issuer,
      audience: this.audience,
      algorithms: ["HS256"],
    });

    // Impede que um token válido de um tipo seja aceito no lugar do outro.
    if (payload.kind !== expectedKind) {
      throw new Error(`token do tipo ${String(payload.kind)} usado como ${expectedKind}`);
    }

    return payload;
  }
}
