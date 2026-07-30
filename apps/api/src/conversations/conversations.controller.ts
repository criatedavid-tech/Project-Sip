import { BadRequestException, Body, Controller, Get, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { PERMISSIONS } from "@omni/auth";
import { CurrentUser, type AuthenticatedUser } from "../auth/current-user";
import { RequirePermissions } from "../auth/permissions.guard";
import { ConversationsService } from "./conversations.service";

const sendTextSchema = z.object({ body: z.string().min(1).max(4096) });
const uuidSchema = z.string().uuid();

@Controller("conversations")
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @RequirePermissions(PERMISSIONS.conversationsRead)
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    // A organização vem do token, nunca da requisição.
    return this.conversations.list(user.organizationId);
  }

  @RequirePermissions(PERMISSIONS.conversationsRead)
  @Get(":id/messages")
  messages(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.conversations.messages(user.organizationId, this.parseId(id));
  }

  @RequirePermissions(PERMISSIONS.conversationsWrite)
  @Post(":id/messages")
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const parsed = sendTextSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("mensagem inválida");
    }

    return this.conversations.sendText({
      organizationId: user.organizationId,
      userId: user.userId,
      conversationId: this.parseId(id),
      body: parsed.data.body,
    });
  }

  @RequirePermissions(PERMISSIONS.conversationsWrite)
  @Post(":id/read")
  async markRead(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    await this.conversations.markRead(user.organizationId, this.parseId(id));
    return { ok: true };
  }

  private parseId(id: string): string {
    const parsed = uuidSchema.safeParse(id);
    if (!parsed.success) {
      throw new BadRequestException("identificador inválido");
    }
    return parsed.data;
  }
}
