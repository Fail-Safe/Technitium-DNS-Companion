import type { Logger } from "@nestjs/common";
import type { TechnitiumNodeConfig } from "./technitium.types";

export const INTERNAL_DEFAULT_GROUP_ID = "__default__";
export const TECHNITIUM_GROUP_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,62}$/;

export function hasImplicitNodeGrouping(
  nodes: readonly TechnitiumNodeConfig[],
): boolean {
  return (
    nodes.length > 0 &&
    nodes.every((node) => nodeGroupId(node) === INTERNAL_DEFAULT_GROUP_ID)
  );
}

export function nodeGroupId(
  node: Pick<TechnitiumNodeConfig, "groupId">,
): string {
  return node.groupId ?? INTERNAL_DEFAULT_GROUP_ID;
}

export function configuredGroupIds(
  nodes: readonly TechnitiumNodeConfig[],
): string[] {
  return [...new Set(nodes.map((node) => nodeGroupId(node)))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export function loadTechnitiumNodeConfigs(
  env: NodeJS.ProcessEnv,
  logger: Pick<Logger, "warn">,
): TechnitiumNodeConfig[] {
  const rawNodes = env.TECHNITIUM_NODES;
  if (!rawNodes) {
    logger.warn("No Technitium DNS nodes configured via TECHNITIUM_NODES");
    return [];
  }

  const ids = rawNodes
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const entries = ids.map((id) => {
    const sanitizedKey = id.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    return {
      id,
      sanitizedKey,
      groupId: env[`TECHNITIUM_${sanitizedKey}_GROUP`]?.trim(),
    };
  });
  const hasExplicitGroup = entries.some((entry) => entry.groupId !== undefined);

  if (
    hasExplicitGroup &&
    entries.some((entry) => entry.groupId === undefined)
  ) {
    throw new Error(
      "Technitium node grouping is mixed: when any TECHNITIUM_<NODE>_GROUP is set, every configured node must declare a group.",
    );
  }

  if (hasExplicitGroup) {
    for (const entry of entries) {
      const groupId = entry.groupId ?? "";
      if (
        groupId.startsWith("__") ||
        !TECHNITIUM_GROUP_ID_PATTERN.test(groupId)
      ) {
        throw new Error(
          "Technitium node group IDs must be lowercase slugs of 1-63 characters and may not begin with a reserved double underscore.",
        );
      }
    }
  }

  const configs: TechnitiumNodeConfig[] = [];
  for (const entry of entries) {
    const { id, sanitizedKey } = entry;
    const name = env[`TECHNITIUM_${sanitizedKey}_NAME`];
    const baseUrl = env[`TECHNITIUM_${sanitizedKey}_BASE_URL`];
    const token = env[`TECHNITIUM_${sanitizedKey}_TOKEN`];
    const queryLoggerAppName =
      env[`TECHNITIUM_${sanitizedKey}_QUERY_LOGGER_APP_NAME`];
    const queryLoggerClassPath =
      env[`TECHNITIUM_${sanitizedKey}_QUERY_LOGGER_CLASS_PATH`];

    if (!baseUrl) {
      logger.warn(
        `Skipping node "${id}" because TECHNITIUM_${sanitizedKey}_BASE_URL is not set.`,
      );
      continue;
    }
    if (!token) {
      logger.warn(
        `Node "${id}" has no env token configured; it will require user login sessions for interactive access (v1.4+).`,
      );
    }

    configs.push({
      id,
      name: name || id,
      baseUrl,
      token: token ?? "",
      groupId: entry.groupId ?? INTERNAL_DEFAULT_GROUP_ID,
      queryLoggerAppName,
      queryLoggerClassPath,
    });
  }

  if (configs.length === 0) {
    logger.warn(
      "Technitium DNS configuration contained node ids but none were fully configured.",
    );
  }
  return configs;
}
