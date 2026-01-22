import { Logger } from "@nestjs/common";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import selfsigned from "selfsigned";

const logger = new Logger("SelfSignedCert");

export interface SelfSignedCertResult {
  key: Buffer;
  cert: Buffer;
}

function parseCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

/**
 * Generates or loads a persisted self-signed certificate for HTTPS.
 *
 * Default SANs:
 * - DNS: localhost
 * - IP: 127.0.0.1, ::1
 *
 * Additional SANs can be provided via HTTPS_SELF_SIGNED_SANS as a comma-separated list.
 *
 * Files are persisted as:
 * - <dir>/server.key
 * - <dir>/server.crt
 */
export function getOrCreateSelfSignedCert(
  certDir: string,
): SelfSignedCertResult {
  const keyPath = join(certDir, "server.key");
  const certPath = join(certDir, "server.crt");

  if (existsSync(keyPath) && existsSync(certPath)) {
    logger.log(`Loading existing self-signed cert from ${certDir}`);
    return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
  }

  if (!existsSync(certDir)) {
    mkdirSync(certDir, { recursive: true });
  }

  const validDays = Number.parseInt(
    process.env.HTTPS_SELF_SIGNED_DAYS ?? "365",
    10,
  );
  const safeValidDays =
    Number.isFinite(validDays) && validDays > 0 ? validDays : 365;

  const extraSans = parseCsv(process.env.HTTPS_SELF_SIGNED_SANS);

  const dnsSans = unique([
    "localhost",
    ...extraSans.filter((s) => !isIpLike(s)),
  ]);
  const ipSans = unique(["127.0.0.1", "::1", ...extraSans.filter(isIpLike)]);

  const altNames: Array<Record<string, unknown>> = [
    ...dnsSans.map((value) => ({ type: 2, value })),
    ...ipSans.map((ip) => ({ type: 7, ip })),
  ];

  logger.warn(
    "Self-signed HTTPS is enabled. Browsers will show a security warning unless you trust the cert.",
  );
  logger.log(
    `Generating new self-signed cert in ${certDir} (valid ${safeValidDays} days)`,
  );

  const attrs = [{ name: "commonName", value: "Technitium DNS Companion" }];
  const pems = selfsigned.generate(attrs, {
    algorithm: "sha256",
    days: safeValidDays,
    keySize: 2048,
    extensions: [{ name: "subjectAltName", altNames }],
  });

  writeFileSync(keyPath, pems.private, { mode: 0o600 });
  writeFileSync(certPath, pems.cert, { mode: 0o644 });

  logger.log(`Wrote self-signed key: ${keyPath}`);
  logger.log(`Wrote self-signed cert: ${certPath}`);
  logger.log(`SAN DNS: ${dnsSans.join(", ")}`);
  logger.log(`SAN IP: ${ipSans.join(", ")}`);

  return { key: Buffer.from(pems.private), cert: Buffer.from(pems.cert) };
}

function isIpLike(value: string): boolean {
  // Very small heuristic; user-provided values can include IPv4/IPv6.
  // (We avoid adding heavy deps for IP parsing.)
  return value.includes(":") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value);
}
