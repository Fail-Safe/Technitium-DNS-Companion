export type ParsedKeyValueLine = { indent: string; key: string; value: string };

export const parseKeyValueLine = (line: string): ParsedKeyValueLine | null => {
  const indentMatch = /^\s*/.exec(line);
  const indent = indentMatch ? indentMatch[0] : "";
  const rest = line.slice(indent.length);

  // Find the LAST ':' that is followed by whitespace. This correctly handles IPv6
  // keys like "fd7a:...::170: restrict.youtube.com" while still supporting
  // normal "key: value" lines.
  let delimiterIndex = -1;
  for (let i = rest.length - 2; i >= 0; i -= 1) {
    if (rest[i] === ":" && /\s/.test(rest[i + 1])) {
      delimiterIndex = i;
      break;
    }
  }

  if (delimiterIndex === -1) return null;

  const key = rest.slice(0, delimiterIndex).trimEnd();
  const value = rest.slice(delimiterIndex + 1).trimStart();

  if (!key || !value) return null;

  return { indent, key, value };
};
