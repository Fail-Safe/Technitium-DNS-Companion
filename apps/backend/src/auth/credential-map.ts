import { readFileSync } from "node:fs";
import { parseTree } from "jsonc-parser";
import type { Node as JsonNode, ParseError } from "jsonc-parser";
import type { GroupCredential } from "./group-credentials";

const IDENTITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@+-]{0,254}$/;

export function readStrictJsonFile(path: string, label: string): unknown {
  try {
    const source = readFileSync(path, "utf8");
    assertStrictJson(source);
    return JSON.parse(source) as unknown;
  } catch {
    throw new Error(`${label} must reference a readable, valid JSON file.`);
  }
}

export function requireObject(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

export function assertExactKeys(
  object: Record<string, unknown>,
  allowed: string[],
  label: string,
): void {
  const unexpected = Object.keys(object).filter(
    (key) => !allowed.includes(key),
  );
  const missing = allowed.filter((key) => !(key in object));
  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(`${label} has an invalid schema.`);
  }
}

export function parseGroupCredential(
  value: unknown,
  label: string,
): GroupCredential {
  const entry = requireObject(value, label);
  assertExactKeys(entry, ["username", "token"], label);
  if (
    typeof entry.username !== "string" ||
    !IDENTITY_PATTERN.test(entry.username)
  ) {
    throw new Error(`${label} has an invalid username.`);
  }
  if (typeof entry.token !== "string" || entry.token.length === 0) {
    throw new Error(`${label} contains an empty or invalid cluster API token.`);
  }
  return { username: entry.username, token: entry.token };
}

export function loadAutomationCredentialMap(
  path: string,
  knownGroupIds: ReadonlySet<string>,
  label: string,
): Map<string, GroupCredential> {
  const root = requireObject(readStrictJsonFile(path, label), label);
  assertExactKeys(root, ["version", "groups"], label);
  if (root.version !== 1) {
    throw new Error(`${label} version must be 1.`);
  }
  const groups = requireObject(root.groups, `${label} groups`);
  if (Object.keys(groups).length === 0) {
    throw new Error(`${label} must contain at least one group.`);
  }
  const result = new Map<string, GroupCredential>();
  for (const [groupId, value] of Object.entries(groups)) {
    if (!knownGroupIds.has(groupId)) {
      throw new Error(`${label} contains an unknown group.`);
    }
    result.set(groupId, parseGroupCredential(value, `${label} group mapping`));
  }
  return result;
}

export function isValidIdentity(value: string): boolean {
  return IDENTITY_PATTERN.test(value);
}

function assertStrictJson(source: string): void {
  const errors: ParseError[] = [];
  const root = parseTree(source, errors, {
    allowTrailingComma: false,
    disallowComments: true,
  });
  if (!root || errors.length > 0) {
    throw new Error("Invalid JSON");
  }
  const walk = (node: JsonNode): void => {
    if (node.type === "object") {
      const keys = new Set<string>();
      for (const property of node.children ?? []) {
        const key = property.children?.[0]?.value as unknown;
        if (typeof key !== "string" || keys.has(key)) {
          throw new Error("Duplicate JSON object key");
        }
        keys.add(key);
      }
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
}
