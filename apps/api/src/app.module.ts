import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { DatabaseModule } from "./database/database.module";
import { AuthModule } from "./auth/auth.module";
import { WhatsappModule } from "./whatsapp/whatsapp.module";

@Module({
  imports: [DatabaseModule, AuthModule, WhatsappModule],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
