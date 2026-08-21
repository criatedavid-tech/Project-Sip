import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { loadEnv } from "@omni/config";
import { AuthService } from "./auth.service";
import { Public } from "./auth.guard";
import { CurrentUser, type AuthenticatedUser } from "./current-user";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  organizationId: z.string().uuid().optional(),
});

const REFRESH_COOKIE = "omni_refresh";

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  // Autenticar não cria recurso: 200, não o 201 que o Nest usa por padrão.
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post("login")
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("email e senha são obrigatórios");
    }

    const result = await this.authService.login(parsed.data);
    this.setRefreshCookie(response, result.refreshToken);

    return {
      accessToken: result.accessToken,
      organizationId: result.organizationId,
      user: result.user,
    };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post("refresh")
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = (request.cookies as Record<string, string> | undefined)?.[
      REFRESH_COOKIE
    ];
    if (!token) {
      throw new UnauthorizedException("refresh token ausente");
    }

    const result = await this.authService.refresh(token);
    this.setRefreshCookie(response, result.refreshToken);

    return {
      accessToken: result.accessToken,
      organizationId: result.organizationId,
      user: result.user,
    };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post("logout")
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie(REFRESH_COOKIE, { path: "/auth" });
    return { ok: true };
  }

  @Get("me")
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  /**
   * O refresh token vive só em cookie httpOnly: fora do alcance de JavaScript,
   * ele não é exfiltrável por XSS como seria em localStorage.
   */
  private setRefreshCookie(response: Response, token: string): void {
    const env = loadEnv();
    response.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/auth",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }
}
