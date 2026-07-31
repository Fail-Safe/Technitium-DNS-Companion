import { createHash } from "node:crypto";
import {
  applyEdits,
  findNodeAtLocation,
  modify,
  parse,
  parseTree,
  printParseErrorCode,
  visit,
  type FormattingOptions,
  type JSONPath,
  type Node,
  type ParseError,
} from "jsonc-parser";
import type {
  AdvancedBlockingCommentMutation,
  AdvancedBlockingCommentMutationRequest,
  AdvancedBlockingConfig,
  AdvancedBlockingDomainComment,
  AdvancedBlockingDomainListField,
  AdvancedBlockingGroup,
  AdvancedBlockingUrlEntry,
  AdvancedBlockingUrlOverride,
} from "./advanced-blocking.types";

const PARSE_OPTIONS = {
  allowTrailingComma: true,
  disallowComments: false,
} as const;

const GROUP_ARRAY_FIELDS = [
  "blockingAddresses",
  "allowed",
  "blocked",
  "allowListUrls",
  "blockListUrls",
  "allowedRegex",
  "blockedRegex",
  "regexAllowListUrls",
  "regexBlockListUrls",
  "adblockListUrls",
] as const satisfies ReadonlyArray<keyof AdvancedBlockingGroup>;

const MISSING = Symbol("missing");
const DOMAIN_LIST_FIELDS = [
  "allowed",
  "blocked",
  "allowedRegex",
  "blockedRegex",
] as const satisfies readonly AdvancedBlockingDomainListField[];

interface CommentToken {
  content: string;
  offset: number;
  length: number;
}

interface DomainCommentToken extends AdvancedBlockingDomainComment {
  offset: number;
  length: number;
}

export class AdvancedBlockingCommentPreservationError extends Error {
  constructor(path: JSONPath) {
    super(
      `Unable to safely update Advanced Blocking JSONC at ${formatPath(path)} because the edit would modify or remove existing comments.`,
    );
    this.name = "AdvancedBlockingCommentPreservationError";
  }
}

export function parseAdvancedBlockingJsonc(rawConfig: string): unknown {
  const errors: ParseError[] = [];
  const parsed = parse(rawConfig, errors, PARSE_OPTIONS) as unknown;

  if (errors.length > 0) {
    const first = errors[0];
    const { line, column } = offsetToPosition(rawConfig, first.offset);
    throw new Error(
      `${printParseErrorCode(first.error)} at position ${first.offset} (line ${line} column ${column})`,
    );
  }

  return parsed;
}

export function calculateAdvancedBlockingConfigRevision(
  rawConfig: string,
): string {
  return createHash("sha256").update(rawConfig).digest("hex");
}

export function patchAdvancedBlockingJsonc(
  rawConfig: string,
  desiredConfig: AdvancedBlockingConfig,
): string {
  const parsed = parseAdvancedBlockingJsonc(rawConfig);
  if (!isRecord(parsed)) {
    throw new Error("Advanced Blocking config payload was not an object.");
  }

  let text = rawConfig;

  text = reconcileOptionalProperty(
    text,
    ["enableBlocking"],
    desiredConfig.enableBlocking,
  );
  text = reconcileOptionalProperty(
    text,
    ["blockingAnswerTtl"],
    desiredConfig.blockingAnswerTtl,
  );
  text = reconcileOptionalProperty(
    text,
    ["blockListUrlUpdateIntervalHours"],
    desiredConfig.blockListUrlUpdateIntervalHours,
  );
  text = reconcileOptionalProperty(
    text,
    ["blockListUrlUpdateIntervalMinutes"],
    desiredConfig.blockListUrlUpdateIntervalMinutes,
  );
  text = reconcileStringRecord(
    text,
    ["localEndPointGroupMap"],
    desiredConfig.localEndPointGroupMap,
  );
  text = reconcileStringRecord(
    text,
    ["networkGroupMap"],
    desiredConfig.networkGroupMap,
  );
  text = reconcileIdentityArray(
    text,
    ["groups"],
    desiredConfig.groups,
    groupIdentity,
    reconcileGroup,
  );

  parseAdvancedBlockingJsonc(text);
  assertCommentsPreserved(rawConfig, text, []);
  return text;
}

export function listAdvancedBlockingDomainComments(
  rawConfig: string,
): AdvancedBlockingDomainComment[] {
  return collectDomainCommentTokens(rawConfig).map((comment) => ({
    id: comment.id,
    groupName: comment.groupName,
    field: comment.field,
    value: comment.value,
    occurrence: comment.occurrence,
    placement: comment.placement,
    style: comment.style,
    text: comment.text,
    raw: comment.raw,
  }));
}

export function applyAdvancedBlockingJsoncChanges(
  rawConfig: string,
  desiredConfig: AdvancedBlockingConfig,
  commentMutations: AdvancedBlockingCommentMutation[],
): string {
  parseAdvancedBlockingJsonc(rawConfig);
  const existingComments = collectDomainCommentTokens(rawConfig);
  const targetedIds = new Set<string>();
  const replacements: Array<{
    offset: number;
    length: number;
    content: string;
  }> = [];

  for (const mutation of commentMutations) {
    if (mutation.action === "add") {
      continue;
    }
    if (targetedIds.has(mutation.commentId)) {
      throw new Error("A comment can only be changed once in a save.");
    }
    targetedIds.add(mutation.commentId);

    const target = existingComments.find(
      (comment) => comment.id === mutation.commentId,
    );
    if (!target) {
      throw new Error(
        "An Advanced Blocking comment changed after it was staged. Reload the configuration and try again.",
      );
    }
    if (mutation.action === "edit" && !mutation.text.trim()) {
      throw new Error("Comment text is required.");
    }
    replacements.push({
      offset: target.offset,
      length: target.length,
      content:
        mutation.action === "remove"
          ? ""
          : formatComment(mutation.text.trim(), target.style),
    });
  }

  let next = rawConfig;
  for (const replacement of replacements.sort(
    (left, right) => right.offset - left.offset,
  )) {
    next =
      next.slice(0, replacement.offset) +
      replacement.content +
      next.slice(replacement.offset + replacement.length);
  }
  parseAdvancedBlockingJsonc(next);
  next = patchAdvancedBlockingJsonc(next, desiredConfig);

  for (const mutation of commentMutations) {
    if (mutation.action === "add") {
      next = mutateAdvancedBlockingDomainComment(next, mutation);
    }
  }

  return next;
}

export function mutateAdvancedBlockingDomainComment(
  rawConfig: string,
  mutation:
    | AdvancedBlockingCommentMutation
    | AdvancedBlockingCommentMutationRequest,
): string {
  parseAdvancedBlockingJsonc(rawConfig);

  if (mutation.action === "add") {
    const text = mutation.text.trim();
    if (!text) {
      throw new Error("Comment text is required.");
    }
    const target = findDomainEntryNode(
      rawConfig,
      mutation.groupName,
      mutation.field,
      mutation.value,
      mutation.occurrence,
    );
    if (!target) {
      throw new Error("The Advanced Blocking domain entry was not found.");
    }

    const eol = rawConfig.includes("\r\n") ? "\r\n" : "\n";
    const lineStart = Math.max(
      rawConfig.lastIndexOf("\n", target.offset - 1) + 1,
      0,
    );
    const linePrefix = rawConfig.slice(lineStart, target.offset);
    const formatting = detectFormatting(rawConfig);
    const indentationUnit = formatting.insertSpaces
      ? " ".repeat(formatting.tabSize ?? 2)
      : "\t";
    const indentation = /^[ \t]*$/.test(linePrefix)
      ? linePrefix
      : `${linePrefix.match(/^[ \t]*/)?.[0] ?? ""}${indentationUnit}`;
    const comment = formatComment(text, mutation.style ?? "line");
    const commentPrefix = /^[ \t]*$/.test(linePrefix) ? "" : eol + indentation;
    const next =
      rawConfig.slice(0, target.offset) +
      commentPrefix +
      comment +
      eol +
      indentation +
      rawConfig.slice(target.offset);
    parseAdvancedBlockingJsonc(next);
    return next;
  }

  const comments = collectDomainCommentTokens(rawConfig);
  const target = comments.find((comment) => comment.id === mutation.commentId);
  if (!target) {
    throw new Error(
      "The Advanced Blocking comment was not found. Reload the configuration and try again.",
    );
  }

  const replacement =
    mutation.action === "remove"
      ? ""
      : formatComment(mutation.text.trim(), target.style);
  if (mutation.action === "edit" && !mutation.text.trim()) {
    throw new Error("Comment text is required.");
  }

  const next =
    rawConfig.slice(0, target.offset) +
    replacement +
    rawConfig.slice(target.offset + target.length);
  parseAdvancedBlockingJsonc(next);
  return next;
}

function reconcileGroup(
  text: string,
  path: JSONPath,
  current: unknown,
  desired: AdvancedBlockingGroup,
): string {
  if (!isRecord(current)) {
    return applyValueEdit(text, path, desired);
  }

  let next = text;
  next = reconcileOptionalProperty(
    next,
    [...path, "enableBlocking"],
    desired.enableBlocking,
  );
  next = reconcileOptionalProperty(
    next,
    [...path, "allowTxtBlockingReport"],
    desired.allowTxtBlockingReport,
  );
  next = reconcileOptionalProperty(
    next,
    [...path, "blockAsNxDomain"],
    desired.blockAsNxDomain,
  );

  for (const field of GROUP_ARRAY_FIELDS) {
    const desiredValue = desired[field];
    if (field === "allowListUrls" || field === "blockListUrls") {
      next = reconcileUrlArray(next, [...path, field], desiredValue);
    } else if (
      field === "regexAllowListUrls" ||
      field === "regexBlockListUrls"
    ) {
      next = reconcileUrlArray(next, [...path, field], desiredValue);
    } else {
      next = reconcileIdentityArray(
        next,
        [...path, field],
        desiredValue,
        scalarIdentity,
      );
    }
  }

  return next;
}

function reconcileUrlArray(
  text: string,
  path: JSONPath,
  desired: AdvancedBlockingUrlEntry[],
): string {
  return reconcileIdentityArray(
    text,
    path,
    desired,
    urlEntryIdentity,
    (currentText, itemPath, current, desiredEntry) => {
      if (isUrlOverride(current) && isUrlOverride(desiredEntry)) {
        let next = currentText;
        next = reconcileOptionalProperty(
          next,
          [...itemPath, "url"],
          desiredEntry.url,
        );
        next = reconcileOptionalProperty(
          next,
          [...itemPath, "blockAsNxDomain"],
          desiredEntry.blockAsNxDomain,
        );

        const blockingAddresses = desiredEntry.blockingAddresses;
        if (blockingAddresses === undefined) {
          next = reconcileOptionalProperty(
            next,
            [...itemPath, "blockingAddresses"],
            undefined,
          );
        } else {
          next = reconcileIdentityArray(
            next,
            [...itemPath, "blockingAddresses"],
            blockingAddresses,
            scalarIdentity,
          );
        }
        return next;
      }

      return deepEqual(current, desiredEntry)
        ? currentText
        : applyValueEdit(currentText, itemPath, desiredEntry);
    },
  );
}

function reconcileStringRecord(
  text: string,
  path: JSONPath,
  desired: Record<string, string>,
): string {
  const current = valueAtPath(text, path);
  if (current === MISSING) {
    return applyValueEdit(text, path, desired);
  }
  if (!isRecord(current)) {
    return deepEqual(current, desired)
      ? text
      : applyValueEdit(text, path, desired);
  }

  let next = text;
  for (const key of Object.keys(current)) {
    if (!Object.prototype.hasOwnProperty.call(desired, key)) {
      next = applyValueEdit(next, [...path, key], undefined);
    }
  }
  for (const [key, value] of Object.entries(desired)) {
    next = reconcileOptionalProperty(next, [...path, key], value);
  }
  return next;
}

function reconcileOptionalProperty(
  text: string,
  path: JSONPath,
  desired: unknown,
): string {
  const current = valueAtPath(text, path);
  if (desired === undefined) {
    return current === MISSING ? text : applyValueEdit(text, path, undefined);
  }
  if (current !== MISSING && deepEqual(current, desired)) {
    return text;
  }
  return applyValueEdit(text, path, desired);
}

function reconcileIdentityArray<T>(
  text: string,
  path: JSONPath,
  desired: T[],
  identity: (value: unknown) => string | undefined,
  updateMatched?: (
    text: string,
    path: JSONPath,
    current: unknown,
    desired: T,
  ) => string,
): string {
  const initial = valueAtPath(text, path);
  if (initial === MISSING) {
    return applyValueEdit(text, path, desired);
  }
  if (!Array.isArray(initial)) {
    return deepEqual(initial, desired)
      ? text
      : applyValueEdit(text, path, desired);
  }

  const desiredByIdentity = new Map<string, T[]>();
  for (const item of desired) {
    const key = identity(item);
    if (key === undefined) {
      continue;
    }
    const bucket = desiredByIdentity.get(key) ?? [];
    bucket.push(item);
    desiredByIdentity.set(key, bucket);
  }

  const retainedCounts = new Map<string, number>();
  const removeIndexes: number[] = [];
  initial.forEach((item, index) => {
    const key = identity(item);
    if (key === undefined) {
      return;
    }
    const retained = retainedCounts.get(key) ?? 0;
    const wanted = desiredByIdentity.get(key)?.length ?? 0;
    if (retained < wanted) {
      retainedCounts.set(key, retained + 1);
    } else {
      removeIndexes.push(index);
    }
  });

  let next = text;
  for (const index of removeIndexes.sort((a, b) => b - a)) {
    next = applyValueEdit(next, [...path, index], undefined);
  }

  const retained = valueAtPath(next, path);
  if (!Array.isArray(retained)) {
    throw new Error(`Expected an array at ${formatPath(path)}.`);
  }

  const consumed = new Map<string, number>();
  retained.forEach((currentItem, index) => {
    const key = identity(currentItem);
    if (key === undefined) {
      return;
    }
    const used = consumed.get(key) ?? 0;
    const desiredItem = desiredByIdentity.get(key)?.[used];
    if (desiredItem === undefined) {
      return;
    }
    consumed.set(key, used + 1);
    if (updateMatched) {
      next = updateMatched(next, [...path, index], currentItem, desiredItem);
    }
  });

  const retainedAfterUpdates = valueAtPath(next, path);
  if (!Array.isArray(retainedAfterUpdates)) {
    throw new Error(`Expected an array at ${formatPath(path)}.`);
  }

  const availableCounts = new Map<string, number>();
  for (const item of retainedAfterUpdates) {
    const key = identity(item);
    if (key !== undefined) {
      availableCounts.set(key, (availableCounts.get(key) ?? 0) + 1);
    }
  }

  const appendedCounts = new Map<string, number>();
  for (const item of desired) {
    const key = identity(item);
    if (key === undefined) {
      continue;
    }
    const alreadyAppended = appendedCounts.get(key) ?? 0;
    const available = availableCounts.get(key) ?? 0;
    if (alreadyAppended < available) {
      appendedCounts.set(key, alreadyAppended + 1);
      continue;
    }

    const currentArray = valueAtPath(next, path);
    if (!Array.isArray(currentArray)) {
      throw new Error(`Expected an array at ${formatPath(path)}.`);
    }
    next = applyValueEdit(next, [...path, currentArray.length], item, true);
    appendedCounts.set(key, alreadyAppended + 1);
  }

  return next;
}

function applyValueEdit(
  text: string,
  path: JSONPath,
  value: unknown,
  isArrayInsertion = false,
): string {
  if (value === undefined) {
    assertDeletionDoesNotRetargetComments(text, path);
    const arrayDeletion = deleteArrayItemPreservingComments(text, path);
    if (arrayDeletion !== undefined) {
      return arrayDeletion;
    }
  }
  const comments = collectComments(text);
  const edits = modify(text, path, value, {
    formattingOptions: detectFormatting(text),
    isArrayInsertion,
  });
  if (edits.length === 0) {
    return text;
  }

  const next = applyEdits(text, edits);
  parseAdvancedBlockingJsonc(next);
  const nextComments = collectComments(next);
  if (!arraysEqual(comments, nextComments)) {
    throw new AdvancedBlockingCommentPreservationError(path);
  }
  return next;
}

function deleteArrayItemPreservingComments(
  text: string,
  path: JSONPath,
): string | undefined {
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, PARSE_OPTIONS);
  if (!root || errors.length > 0) {
    return undefined;
  }
  const target = findNodeAtLocation(root, path);
  const siblings = target?.parent?.children;
  if (!target || target.parent?.type !== "array" || !siblings) {
    return undefined;
  }

  const index = siblings.indexOf(target);
  const previous = siblings[index - 1];
  const next = siblings[index + 1];
  let deleteStart = target.offset;
  let deleteEnd = target.offset + target.length;

  if (next) {
    const comma = text.indexOf(",", deleteEnd);
    if (comma < 0 || comma >= next.offset) {
      return undefined;
    }
    deleteEnd = comma + 1;
  } else if (previous) {
    const previousEnd = previous.offset + previous.length;
    const comma = text.lastIndexOf(",", target.offset);
    if (comma < previousEnd) {
      return undefined;
    }
    deleteStart = comma;
  }

  const comments = collectComments(text);
  const updated = text.slice(0, deleteStart) + text.slice(deleteEnd);
  parseAdvancedBlockingJsonc(updated);
  if (!arraysEqual(comments, collectComments(updated))) {
    throw new AdvancedBlockingCommentPreservationError(path);
  }
  return updated;
}

function assertDeletionDoesNotRetargetComments(
  text: string,
  path: JSONPath,
): void {
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, PARSE_OPTIONS);
  if (!root || errors.length > 0) {
    parseAdvancedBlockingJsonc(text);
    return;
  }

  const target = findNodeAtLocation(root, path);
  if (!target) {
    return;
  }

  const structuralNode =
    target.parent?.type === "property" ? target.parent : target;
  const container = structuralNode.parent;
  const siblings = container?.children;
  if (!container || !siblings) {
    return;
  }

  const index = siblings.indexOf(structuralNode);
  if (index < 0) {
    return;
  }

  const previous = siblings[index - 1];
  const next = siblings[index + 1];
  const associationStart = previous
    ? previous.offset + previous.length
    : container.offset + 1;
  const associationEnd = next
    ? next.offset
    : container.offset + container.length - 1;

  const targetLine = offsetToPosition(text, target.offset).line;
  const previousEndLine = previous
    ? offsetToPosition(text, previous.offset + previous.length).line
    : undefined;
  const hasAssociatedComment = collectCommentTokens(text).some((comment) => {
    const commentLine = offsetToPosition(text, comment.offset).line;
    const isLeading =
      comment.offset >= associationStart &&
      comment.offset < target.offset &&
      commentLine !== previousEndLine;
    const isTrailing =
      comment.offset >= target.offset + target.length &&
      comment.offset < associationEnd &&
      commentLine === targetLine;
    return isLeading || isTrailing;
  });
  if (hasAssociatedComment) {
    throw new AdvancedBlockingCommentPreservationError(path);
  }
}

function valueAtPath(text: string, path: JSONPath): unknown {
  let current = parseAdvancedBlockingJsonc(text);
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(current) || segment >= current.length) {
        return MISSING;
      }
      current = current[segment];
      continue;
    }

    if (
      !isRecord(current) ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return MISSING;
    }
    current = current[segment];
  }
  return current;
}

function collectComments(text: string): string[] {
  return collectCommentTokens(text).map((comment) => comment.content);
}

function collectCommentTokens(text: string): CommentToken[] {
  const comments: CommentToken[] = [];
  visit(
    text,
    {
      onComment: (offset, length) => {
        comments.push({
          content: text.slice(offset, offset + length),
          offset,
          length,
        });
      },
    },
    PARSE_OPTIONS,
  );
  return comments;
}

function collectDomainCommentTokens(text: string): DomainCommentToken[] {
  const parsed = parseAdvancedBlockingJsonc(text);
  if (!isRecord(parsed) || !Array.isArray(parsed.groups)) {
    return [];
  }

  const errors: ParseError[] = [];
  const root = parseTree(text, errors, PARSE_OPTIONS);
  if (!root || errors.length > 0) {
    return [];
  }

  const commentTokens = collectCommentTokens(text);
  const domainComments: DomainCommentToken[] = [];
  const occurrenceCounts = new Map<string, number>();

  const groups = parsed.groups as unknown[];
  groups.forEach((groupValue, groupIndex) => {
    if (!isRecord(groupValue) || typeof groupValue.name !== "string") {
      return;
    }
    const groupName = groupValue.name;

    for (const field of DOMAIN_LIST_FIELDS) {
      const values = groupValue[field];
      const arrayNode = findNodeAtLocation(root, ["groups", groupIndex, field]);
      if (!Array.isArray(values) || arrayNode?.type !== "array") {
        continue;
      }

      const children = arrayNode.children ?? [];
      children.forEach((entryNode, entryIndex) => {
        const value = (values as unknown[])[entryIndex];
        if (typeof value !== "string") {
          return;
        }

        const occurrenceKey = `${groupName}\u0000${field}\u0000${value}`;
        const occurrence = occurrenceCounts.get(occurrenceKey) ?? 0;
        occurrenceCounts.set(occurrenceKey, occurrence + 1);

        const previous = children[entryIndex - 1];
        const next = children[entryIndex + 1];
        const gapStart = previous
          ? previous.offset + previous.length
          : arrayNode.offset + 1;
        const gapEnd = next
          ? next.offset
          : arrayNode.offset + arrayNode.length - 1;
        const entryLine = offsetToPosition(text, entryNode.offset).line;
        const previousEndLine = previous
          ? offsetToPosition(text, previous.offset + previous.length).line
          : undefined;

        for (const comment of commentTokens) {
          const commentLine = offsetToPosition(text, comment.offset).line;
          let placement: "leading" | "trailing" | undefined;

          if (
            comment.offset >= gapStart &&
            comment.offset < entryNode.offset &&
            commentLine !== previousEndLine
          ) {
            placement = "leading";
          } else if (
            comment.offset >= entryNode.offset + entryNode.length &&
            comment.offset < gapEnd &&
            commentLine === entryLine
          ) {
            placement = "trailing";
          }

          if (!placement) {
            continue;
          }

          const style = comment.content.startsWith("//") ? "line" : "block";
          domainComments.push({
            id: createCommentId(
              groupName,
              field,
              value,
              occurrence,
              comment.offset,
              comment.content,
            ),
            groupName,
            field,
            value,
            occurrence,
            placement,
            style,
            text: parseCommentText(comment.content),
            raw: comment.content,
            offset: comment.offset,
            length: comment.length,
          });
        }
      });
    }
  });

  return domainComments;
}

function findDomainEntryNode(
  text: string,
  groupName: string,
  field: AdvancedBlockingDomainListField,
  value: string,
  occurrence: number,
): Node | undefined {
  const parsed = parseAdvancedBlockingJsonc(text);
  if (!isRecord(parsed) || !Array.isArray(parsed.groups)) {
    return undefined;
  }

  const groups = parsed.groups as unknown[];
  const groupIndex = groups.findIndex(
    (group) => isRecord(group) && group.name === groupName,
  );
  if (groupIndex < 0) {
    return undefined;
  }
  const group = groups[groupIndex];
  if (!isRecord(group) || !Array.isArray(group[field])) {
    return undefined;
  }

  let seen = 0;
  const entries = group[field] as unknown[];
  const entryIndex = entries.findIndex((entry) => {
    if (entry !== value) {
      return false;
    }
    if (seen === occurrence) {
      return true;
    }
    seen += 1;
    return false;
  });
  if (entryIndex < 0) {
    return undefined;
  }

  const errors: ParseError[] = [];
  const root = parseTree(text, errors, PARSE_OPTIONS);
  return root && errors.length === 0
    ? findNodeAtLocation(root, ["groups", groupIndex, field, entryIndex])
    : undefined;
}

function createCommentId(
  groupName: string,
  field: AdvancedBlockingDomainListField,
  value: string,
  occurrence: number,
  offset: number,
  raw: string,
): string {
  return createHash("sha256")
    .update(
      `${groupName}\u0000${field}\u0000${value}\u0000${occurrence}\u0000${offset}\u0000${raw}`,
    )
    .digest("hex")
    .slice(0, 24);
}

function parseCommentText(raw: string): string {
  if (raw.startsWith("//")) {
    return raw.slice(2).replace(/^ /, "");
  }
  return raw.slice(2, -2).trim();
}

function formatComment(text: string, style: "line" | "block"): string {
  const useBlockStyle = style === "block" || /[\r\n]/.test(text);
  if (useBlockStyle && text.includes("*/")) {
    throw new Error('Comment text cannot contain "*/".');
  }
  if (useBlockStyle) {
    return `/* ${text} */`;
  }
  return `// ${text}`;
}

function assertCommentsPreserved(
  before: string,
  after: string,
  path: JSONPath,
): void {
  if (!arraysEqual(collectComments(before), collectComments(after))) {
    throw new AdvancedBlockingCommentPreservationError(path);
  }
}

function detectFormatting(text: string): FormattingOptions {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const indentation = text.match(/(?:^|\r?\n)([ \t]+)"/)?.[1] ?? "  ";
  const insertSpaces = !indentation.includes("\t");
  return {
    eol,
    insertSpaces,
    tabSize: insertSpaces ? Math.max(1, indentation.length) : 1,
    keepLines: true,
  };
}

function groupIdentity(value: unknown): string | undefined {
  return isRecord(value) && typeof value.name === "string"
    ? `group:${value.name}`
    : undefined;
}

function urlEntryIdentity(value: unknown): string | undefined {
  if (typeof value === "string") {
    return `url:${value}`;
  }
  return isUrlOverride(value) ? `url:${value.url}` : undefined;
}

function scalarIdentity(value: unknown): string | undefined {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return `${typeof value}:${JSON.stringify(value)}`;
  }
  return undefined;
}

function isUrlOverride(value: unknown): value is AdvancedBlockingUrlOverride {
  return isRecord(value) && typeof value.url === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => deepEqual(value, right[index]))
    );
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(right, key) &&
          deepEqual(left[key], right[key]),
      )
    );
  }
  return false;
}

function arraysEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function offsetToPosition(
  text: string,
  offset: number,
): { line: number; column: number } {
  const prefix = text.slice(0, offset);
  const lines = prefix.split(/\r?\n/);
  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
}

function formatPath(path: JSONPath): string {
  if (path.length === 0) {
    return "<root>";
  }
  return path.reduce<string>((formatted, segment) => {
    if (typeof segment === "number") {
      return `${formatted}[${segment}]`;
    }
    return formatted ? `${formatted}.${segment}` : segment;
  }, "");
}
