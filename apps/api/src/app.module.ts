import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { DatabaseModule } from "./database/database.module";
import { AuthModule } from "./auth/auth.module";
import { WhatsappModule } from "./whatsapp/whatsapp.module";
import { ConversationsModule } from "./conversations/conversations.module";
import { TelephonyModule } from "./telephony/telephony.module";

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    WhatsappModule,
    ConversationsModule,
    TelephonyModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
