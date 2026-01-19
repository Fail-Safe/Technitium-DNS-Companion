import { Logger } from "@nestjs/common";
import { createHash, randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { generate } from "selfsigned";

const logger = new Logger("SelfSignedCert");

interface CertificateResult {
  key: Buffer;
  cert: Buffer;
}

/**
 * Generates or loads a self-signed certificate for HTTPS.
 *
 * If certificates already exist at the specified paths, they are loaded.
 * Otherwise, new certificates are generated using the selfsigned library.
 *
 * Follows the Traefik default certificate pattern:
 * - CN: TDC DEFAULT CERT
 * - SAN: <hash>.<hash>.tdc.default
 *
 * @param certDir - Directory to store/load certificates
 * @returns Object containing key and cert buffers
 */
export async function getOrCreateSelfSignedCert(
  certDir?: string,
): Promise<CertificateResult> {
  const defaultCertDir =
    process.env.HTTPS_SELF_SIGNED_CERT_DIR ||
    (existsSync("/data") ? "/data/certs/self-signed" : "./certs");
  const dir = certDir || defaultCertDir;
  const keyPath = join(dir, "server.key");
  const certPath = join(dir, "server.crt");

  // Check if certs already exist
  if (existsSync(keyPath) && existsSync(certPath)) {
    logger.log(`Loading existing self-signed certificates from ${dir}`);
    return {
      key: readFileSync(keyPath),
      cert: readFileSync(certPath),
    };
  }

  // Create cert directory if needed
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  logger.log(`Generating new self-signed certificate in ${dir}`);

  const validDays = parseInt(process.env.HTTPS_SELF_SIGNED_DAYS || "365", 10);

  // Calculate notAfterDate from days
  const notAfterDate = new Date();
  notAfterDate.setDate(notAfterDate.getDate() + validDays);

  // Generate hash-based SAN following Traefik's default cert pattern
  const hash1 = createHash("md5").update(randomBytes(32)).digest("hex");
  const hash2 = createHash("md5").update(randomBytes(32)).digest("hex");
  const defaultSan = `${hash1}.${hash2}.tdc.default`;

  // Generate self-signed certificate (Traefik default cert pattern)
  const attrs = [{ name: "commonName", value: "TDC DEFAULT CERT" }];
  const pems = await generate(attrs, {
    keySize: 2048,
    notAfterDate,
    extensions: [
      {
        name: "subjectAltName",
        altNames: [{ type: 2, value: defaultSan }],
      },
    ],
  });

  // Save to files for persistence across restarts
  writeFileSync(keyPath, pems.private, { mode: 0o600 });
  writeFileSync(certPath, pems.cert, { mode: 0o644 });

  logger.log(`Self-signed certificate generated successfully`);
  logger.log(`  Subject: CN=TDC DEFAULT CERT`);
  logger.log(`  SAN: ${defaultSan}`);
  logger.log(`  Valid for: ${validDays} days`);
  logger.log(`  Key: ${keyPath}`);
  logger.log(`  Cert: ${certPath}`);

  return {
    key: Buffer.from(pems.private),
    cert: Buffer.from(pems.cert),
  };
}
