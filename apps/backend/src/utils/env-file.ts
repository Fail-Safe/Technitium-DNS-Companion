import { existsSync, readFileSync } from "fs";
import { Logger } from "@nestjs/common";

const logger = new Logger("EnvFile");

/**
 * Reads an environment variable with support for Docker secrets / file-based secrets.
 *
 * For any environment variable `VAR`, this function first checks if `VAR_FILE` is set.
 * If `VAR_FILE` is set and points to a readable file, the file contents are returned
 * (with trailing whitespace trimmed). Otherwise, the value of `VAR` is returned.
 *
 * This pattern is commonly used with Docker Swarm secrets and Kubernetes secret mounts
 * where sensitive values are stored in files (e.g., `/run/secrets/my_token`).
 *
 * @example
 * // With TECHNITIUM_TOKEN_FILE=/run/secrets/token
 * const token = getEnvOrFile("TECHNITIUM_TOKEN");
 * // Returns contents of /run/secrets/token
 *
 * @example
 * // With TECHNITIUM_TOKEN=my-api-token (no _FILE variant set)
 * const token = getEnvOrFile("TECHNITIUM_TOKEN");
 * // Returns "my-api-token"
 *
 * @param envVar - The base environment variable name (without _FILE suffix)
 * @param options - Optional configuration
 * @param options.required - If true, logs a warning when neither VAR nor VAR_FILE is set
 * @returns The value from the file (if VAR_FILE is set) or from the environment variable, or undefined
 */
export function getEnvOrFile(
  envVar: string,
  options?: { required?: boolean },
): string | undefined {
  const fileEnvVar = `${envVar}_FILE`;
  const filePath = process.env[fileEnvVar];

  // If _FILE variant is set, read from file
  if (filePath) {
    if (!existsSync(filePath)) {
      logger.error(
        `${fileEnvVar} is set to "${filePath}" but the file does not exist`,
      );
      return undefined;
    }

    try {
      const content = readFileSync(filePath, "utf-8").trim();
      logger.debug(
        `Loaded ${envVar} from file specified by ${fileEnvVar} (${filePath})`,
      );
      return content;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error(`Failed to read file for ${fileEnvVar}: ${message}`);
      return undefined;
    }
  }

  // Fall back to direct environment variable
  const directValue = process.env[envVar];

  if (directValue === undefined && options?.required) {
    logger.warn(
      `Neither ${envVar} nor ${fileEnvVar} is set (expected for this configuration)`,
    );
  }

  return directValue;
}

/**
 * Resolves all _FILE environment variables at startup and populates process.env.
 *
 * This should be called early in application bootstrap, before dotenv/config or
 * any module that reads environment variables.
 *
 * Supported variables:
 * - TECHNITIUM_CLUSTER_TOKEN
 * - TECHNITIUM_BACKGROUND_TOKEN
 * - TECHNITIUM_<NODE>_TOKEN (for each node in TECHNITIUM_NODES)
 *
 * @example
 * // In main.ts, call before other imports
 * resolveEnvFileVariables();
 */
export function resolveEnvFileVariables(): void {
  const sensitiveVars = [
    "TECHNITIUM_CLUSTER_TOKEN",
    "TECHNITIUM_BACKGROUND_TOKEN",
  ];

  // Resolve statically-known sensitive variables
  for (const envVar of sensitiveVars) {
    const value = getEnvOrFile(envVar);
    if (value !== undefined && process.env[envVar] === undefined) {
      process.env[envVar] = value;
      logger.log(`Loaded ${envVar} from ${envVar}_FILE`);
    }
  }

  // Resolve per-node tokens if TECHNITIUM_NODES is configured
  const nodes = process.env.TECHNITIUM_NODES;
  if (nodes) {
    const nodeIds = nodes
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    for (const nodeId of nodeIds) {
      const sanitizedKey = nodeId.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      const tokenVar = `TECHNITIUM_${sanitizedKey}_TOKEN`;
      const value = getEnvOrFile(tokenVar);
      if (value !== undefined && process.env[tokenVar] === undefined) {
        process.env[tokenVar] = value;
        logger.log(`Loaded ${tokenVar} from ${tokenVar}_FILE`);
      }
    }
  }
}
