import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import express from "express";
import { AppModule } from "./app.module";
import { ChatGateway } from "./chat/chat.gateway";
import { validateCorsOrigin } from "./common/cors-origin";
import { LocationsGateway } from "./locations/locations.gateway";
import { VoiceGateway } from "./voice/voice.gateway";

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  if (!("code" in error)) {
    return undefined;
  }

  const maybeCode = (error as { code?: unknown }).code;
  return typeof maybeCode === "string" ? maybeCode : undefined;
}

async function listenWithPortFallback(
  app: INestApplication,
  preferredPort: number,
  maxAttempts = 50,
): Promise<number> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidatePort = preferredPort + attempt;

    try {
      await app.listen(candidatePort);
      return candidatePort;
    } catch (error) {
      if (getErrorCode(error) !== "EADDRINUSE") {
        throw error;
      }

      console.warn(`[bootstrap] Port ${candidatePort} is busy, trying ${candidatePort + 1}`);
    }
  }

  throw new Error(`Could not bind API after ${maxAttempts} attempts from port ${preferredPort}`);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(cookieParser());
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ limit: "5mb", extended: true }));
  app.enableCors({
    origin: (origin, callback) => validateCorsOrigin(origin, callback),
    credentials: true,
  });

  const locationsGateway = app.get(LocationsGateway);
  locationsGateway.initialize(app.getHttpServer());

  const chatGateway = app.get(ChatGateway);
  chatGateway.initialize(app.getHttpServer());

  const voiceGateway = app.get(VoiceGateway);
  voiceGateway.initialize(app.getHttpServer());

  const preferredPort = Number(process.env.PORT ?? 3001);
  const boundPort = await listenWithPortFallback(app, preferredPort);

  process.env.PORT = String(boundPort);
  if (boundPort !== preferredPort) {
    console.info(`[bootstrap] API bound to fallback port ${boundPort}`);
  }
}

bootstrap();
