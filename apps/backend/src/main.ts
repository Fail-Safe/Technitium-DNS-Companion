import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import "dotenv/config";
import { NextFunction, Request, Response } from "express";
import { existsSync, readFileSync, readdirSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { AppModule } from "./app.module";

const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365;

function resolveConfigFilePath(inputPath: string): string {
  const absolutePath = resolve(inputPath);

  if (!/[[*?]/.test(inputPath)) {
    return absolutePath;
  }

  const directory = dirname(absolutePath);
  const filePattern = basename(absolutePath);

  if (!existsSync(directory)) {
    throw new Error(`Directory does not exist: ${directory}`);
  }

  const regex = new RegExp(
    "^" +
      filePattern
        .replace(/[.+^${}()|\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".") +
      "$",
    "i",
  );

  const matches = readdirSync(directory)
    .filter((name) => regex.test(name))
    .sort((a, b) => a.localeCompare(b));

  if (matches.length === 0) {
    throw new Error(`No files matched pattern: ${inputPath}`);
  }

  return resolve(directory, matches[0]);
}

async function bootstrap() {
  const logger = new Logger("Bootstrap");
  const httpsEnabled = process.env.HTTPS_ENABLED === "true";
  const sessionAuthEnabled = process.env.AUTH_SESSION_ENABLED === "true";
  const trustProxyEnabled = process.env.TRUST_PROXY === "true";
  const clusterTokenConfigured =
    (process.env.TECHNITIUM_CLUSTER_TOKEN ?? "").trim().length > 0;
  const trustProxyHops = Number.parseInt(
    process.env.TRUST_PROXY_HOPS ?? "1",
    10,
  );
  const trustProxyValue =
    Number.isFinite(trustProxyHops) && trustProxyHops > 0 ? trustProxyHops : 1;

  if (sessionAuthEnabled && !httpsEnabled && !trustProxyEnabled) {
    logger.error(
      "AUTH_SESSION_ENABLED=true requires HTTPS to protect session cookies and login credentials.",
    );
    logger.error(
      "Option A (recommended): Enable built-in HTTPS by setting HTTPS_ENABLED=true and configuring certificate paths.",
    );
    logger.error(
      "Option B: Terminate TLS in a reverse proxy and set TRUST_PROXY=true so the backend can detect HTTPS via X-Forwarded-Proto.",
    );
    process.exit(1);
  }

  if (clusterTokenConfigured) {
    logger.warn(
      "TECHNITIUM_CLUSTER_TOKEN is deprecated as of v1.3.0 and is planned to be removed in v1.4. " +
        "Prefer Technitium-backed session auth (AUTH_SESSION_ENABLED=true) for interactive UI usage and TECHNITIUM_BACKGROUND_TOKEN for background jobs. " +
        "Per-node TECHNITIUM_<NODE>_TOKEN is legacy-only for Technitium DNS < v14.",
    );
  }

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
        cert: readFileSync(resolveConfigFilePath(certPath)),
        key: readFileSync(resolveConfigFilePath(keyPath)),
      };

      // Optional CA certificate chain (for self-signed certs)
      if (caPath) {
        httpsOptions.ca = readFileSync(resolveConfigFilePath(caPath));
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

  if (trustProxyEnabled) {
    app.set("trust proxy", trustProxyValue);
    logger.log(
      `Reverse proxy trust enabled (trust proxy = ${trustProxyValue}).`,
    );
  }

  // Set global API prefix
  app.setGlobalPrefix("api");

  // Serve static frontend files (production mode)
  const frontendPath = resolve(__dirname, "../../frontend/dist");
  if (existsSync(frontendPath)) {
    app.useStaticAssets(frontendPath, {
      prefix: "/",
      // We serve index.html via the SPA fallback below so we can control headers.
      index: false,
      setHeaders: (res: Response, filePath: string) => {
        const fileName = basename(filePath);

        // Critical: never cache the SPA shell, otherwise browsers can keep loading an
        // older bundle (missing newer UI sections) until a hard refresh.
        if (fileName === "index.html" || fileName.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
          return;
        }

        // Critical: avoid caching SW bootstrap/manifest files so update checks work reliably.
        if (
          fileName === "sw.js" ||
          fileName === "registerSW.js" ||
          fileName === "manifest.webmanifest" ||
          fileName.startsWith("workbox-")
        ) {
          res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
          return;
        }

        // Hashed build assets are safe to cache aggressively.
        if (filePath.includes(`${join("/", "assets", "")}`)) {
          res.setHeader(
            "Cache-Control",
            `public, max-age=${ONE_YEAR_IN_SECONDS}, immutable`,
          );
          return;
        }

        // Default: require revalidation.
        res.setHeader("Cache-Control", "no-cache");
      },
    });
    logger.log(`Serving frontend from: ${frontendPath}`);

    // Handle SPA routing - serve index.html for all non-API routes
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (!req.url.startsWith("/api") && !req.url.match(/\.\w+$/)) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
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
  const corsOrigins = (process.env.CORS_ORIGINS ?? process.env.CORS_ORIGIN)
    ?.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  if (corsOrigins && corsOrigins.length > 0) {
    app.enableCors({ origin: corsOrigins, credentials: true });
    logger.log(`CORS enabled for origins: ${corsOrigins.join(", ")}`);
  } else if (process.env.NODE_ENV === "development") {
    app.enableCors();
    logger.log("CORS enabled for all origins (development mode)");
  }

  const port = httpsEnabled
    ? process.env.HTTPS_PORT || 3443
    : process.env.PORT || 3000;

  const portNumber =
    typeof port === "string" ? Number.parseInt(port, 10) : port;
  if (!httpsEnabled && portNumber === 3443) {
    logger.warn(
      "HTTPS is disabled but the backend is listening on port 3443 (commonly used for HTTPS).",
    );
    logger.warn(
      "If your dev proxy (Vite/Nginx/Caddy) is targeting https://localhost:3443, you'll see TLS errors. Either enable HTTPS (HTTPS_ENABLED=true) or proxy to http://localhost:3443 / run HTTP on port 3000.",
    );
  }

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
