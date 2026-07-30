import "reflect-metadata";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { NestFactory } from "@nestjs/core";
import { loadEnv, assertProductionSecrets } from "@omni/config";
import { createLogger } from "@omni/observability";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  assertProductionSecrets(env);

  const logger = createLogger({ service: "api", level: env.LOG_LEVEL });
  // rawBody é indispensável para validar a assinatura HMAC da Meta: ela assina
  // os bytes exatos do corpo, e reserializar o JSON invalida a comparação.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });

  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: env.WEB_BASE_URL, credentials: true });
  app.enableShutdownHooks();

  await app.listen(env.API_PORT);
  logger.info({ port: env.API_PORT }, "api iniciada");
}

bootstrap().catch((error: unknown) => {
  createLogger({ service: "api" }).fatal({ err: error }, "falha ao iniciar a api");
  process.exit(1);
});
