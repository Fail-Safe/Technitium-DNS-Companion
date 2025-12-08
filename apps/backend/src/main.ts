import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { Logger } from "@nestjs/common";
import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import { NestExpressApplication } from "@nestjs/platform-express";
import { Request, Response, NextFunction } from "express";

async function bootstrap() {
  const logger = new Logger("Bootstrap");
  const httpsEnabled = process.env.HTTPS_ENABLED === "true";

  let httpsOptions: { key: Buffer; cert: Buffer; ca?: Buffer } | undefined;

  if (httpsEnabled) {
    const certPath = process.env.HTTPS_CERT_PATH;
    const keyPath = process.env.HTTPS_KEY_PATH;
    const caPath = process.env.HTTPS_CA_PATH;

    if (!certPath || !keyPath) {
      logger.error(
        "HTTPS_ENABLED is true but HTTPS_CERT_PATH or HTTPS_KEY_PATH is missing",
      );
      logger.error(
        "Please provide both HTTPS_CERT_PATH and HTTPS_KEY_PATH in your .env file",
      );
      process.exit(1);
    }

    try {
      httpsOptions = {
        cert: readFileSync(resolve(certPath)),
        key: readFileSync(resolve(keyPath)),
      };

      // Optional CA certificate chain (for self-signed certs)
      if (caPath) {
        httpsOptions.ca = readFileSync(resolve(caPath));
      }

      logger.log("HTTPS certificates loaded successfully");
      logger.log(`Certificate: ${certPath}`);
      logger.log(`Private Key: ${keyPath}`);
      if (caPath) {
        logger.log(`CA Chain: ${caPath}`);
      }
    } catch (error) {
      logger.error("Failed to load HTTPS certificates:", error);
      logger.error(
        "Please check that the certificate paths are correct and files are readable",
      );
      process.exit(1);
    }
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    httpsOptions,
    logger: ["error", "warn", "log", "debug", "verbose"],
  });

  // Set global API prefix
  app.setGlobalPrefix("api");

  // Serve static frontend files (production mode)
  const frontendPath = resolve(__dirname, "../../frontend/dist");
  if (existsSync(frontendPath)) {
    app.useStaticAssets(frontendPath, {
      prefix: "/",
      index: "index.html",
    });
    logger.log(`Serving frontend from: ${frontendPath}`);

    // Handle SPA routing - serve index.html for all non-API routes
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (!req.url.startsWith("/api") && !req.url.match(/\.\w+$/)) {
        res.sendFile(join(frontendPath, "index.html"));
      } else {
        next();
      }
    });
  } else {
    logger.warn(`Frontend build not found at: ${frontendPath}`);
    logger.warn('Run "npm run build" in apps/frontend to build the frontend');
  }

  // Enable CORS if needed (can be configured via environment variables)
  const corsOrigins = process.env.CORS_ORIGINS?.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  if (corsOrigins && corsOrigins.length > 0) {
    app.enableCors({
      origin: corsOrigins,
      credentials: true,
    });
    logger.log(`CORS enabled for origins: ${corsOrigins.join(", ")}`);
  } else if (process.env.NODE_ENV === "development") {
    app.enableCors();
    logger.log("CORS enabled for all origins (development mode)");
  }

  const port = httpsEnabled
    ? process.env.HTTPS_PORT || 3443
    : process.env.PORT || 3000;

  await app.listen(port);

  const protocol = httpsEnabled ? "https" : "http";
  logger.log(`Application is running on: ${protocol}://localhost:${port}`);
  logger.log(`API available at: ${protocol}://localhost:${port}/api`);

  if (httpsEnabled) {
    logger.log("🔒 HTTPS is ENABLED");
  } else {
    logger.log("🔓 HTTPS is DISABLED (using HTTP)");
    logger.log(
      "   To enable HTTPS, set HTTPS_ENABLED=true in .env and provide certificate paths",
    );
  }
}

void bootstrap();
