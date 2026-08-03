import { createReadStream } from "node:fs";
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
} from "@nestjs/common";
import { PERMISSIONS } from "@omni/auth";
import { CurrentUser, type AuthenticatedUser } from "../auth/current-user";
import { RequirePermissions } from "../auth/permissions.guard";
import { TelephonyService } from "./telephony.service";

@Controller("telephony")
export class TelephonyController {
  constructor(
    @Inject(TelephonyService) private readonly telephony: TelephonyService,
  ) {}

  @RequirePermissions(PERMISSIONS.callsRead, PERMISSIONS.transcriptionsRead)
  @Get("overview")
  overview(@CurrentUser() user: AuthenticatedUser) {
    return this.telephony.overview(user);
  }

  @RequirePermissions(PERMISSIONS.callsRead)
  @Get("calls")
  calls(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, unknown>,
  ) {
    return this.telephony.calls(user, query);
  }

  @RequirePermissions(PERMISSIONS.recordingsListen)
  @Get("recordings")
  recordings(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, unknown>,
  ) {
    return this.telephony.recordings(user, query);
  }

  @RequirePermissions(PERMISSIONS.callsRead, PERMISSIONS.usersManage)
  @Get("admin/daily")
  dailyAdmin(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, unknown>,
  ) {
    return this.telephony.dailyAdmin(user, query);
  }

  @RequirePermissions(PERMISSIONS.usersManage)
  @Get("admin/collaborators")
  collaborators(@CurrentUser() user: AuthenticatedUser) {
    return this.telephony.collaborators(user);
  }

  @RequirePermissions(PERMISSIONS.usersManage)
  @Post("admin/collaborators")
  createCollaborator(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: Record<string, unknown>,
  ) {
    return this.telephony.createCollaborator(user, body);
  }

  @RequirePermissions(PERMISSIONS.usersManage)
  @Patch("admin/collaborators/:id/status")
  setCollaboratorStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) collaboratorUserId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.telephony.setCollaboratorStatus(user, collaboratorUserId, body);
  }

  @RequirePermissions(PERMISSIONS.callsWrite)
  @Get("webrtc-config")
  webRtcConfig(@CurrentUser() user: AuthenticatedUser) {
    return this.telephony.webRtcConfig(user.organizationId, user.userId);
  }

  @RequirePermissions(PERMISSIONS.recordingsListen)
  @Get("recordings/:id/audio")
  async recordingAudio(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) recordingId: string,
  ) {
    const recording = await this.telephony.recordingAudio(user, recordingId);
    return new StreamableFile(createReadStream(recording.filePath), {
      type: recording.mimeType,
      disposition: `inline; filename="${recording.fileName}"`,
      length: recording.sizeBytes ?? undefined,
    });
  }

  @RequirePermissions(PERMISSIONS.transcriptionsRead)
  @Post("recordings/:id/retry-transcription")
  retryTranscription(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) recordingId: string,
  ) {
    return this.telephony.retryTranscription(user, recordingId);
  }
}
