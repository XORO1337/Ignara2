import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { validateCorsOrigin } from "./common/cors-origin";
import { LocationsGateway } from "./locations/locations.gateway";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(cookieParser());
  app.enableCors({
    origin: (origin, callback) => validateCorsOrigin(origin, callback),
    credentials: true,
  });

  const locationsGateway = app.get(LocationsGateway);
  locationsGateway.initialize(app.getHttpServer());

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
}

bootstrap();
