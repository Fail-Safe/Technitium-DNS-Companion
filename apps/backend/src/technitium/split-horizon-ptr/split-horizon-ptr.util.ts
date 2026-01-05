import { isIP } from "node:net";

const DEFAULT_IPV4_ZONE_PREFIX_LENGTH = 24;
const DEFAULT_IPV6_ZONE_PREFIX_LENGTH = 64;

export const getDefaultIpv4ZonePrefixLength = (): number =>
  DEFAULT_IPV4_ZONE_PREFIX_LENGTH;

export const getDefaultIpv6ZonePrefixLength = (): number =>
  DEFAULT_IPV6_ZONE_PREFIX_LENGTH;

export type ReverseNameResult =
  | { ipVersion: 4 | 6; zoneName: string; recordName: string }
  | { ipVersion: 4 | 6; error: string };

export type ReverseCidrResult =
  | { ipVersion: 4 | 6; cidr: string }
  | { ipVersion: 4 | 6; error: string };

export function computeReverseZoneAndRecordName(
  ip: string,
  options?: { ipv4ZonePrefixLength?: number; ipv6ZonePrefixLength?: number },
): ReverseNameResult {
  const version = isIP(ip);
  if (version !== 4 && version !== 6) {
    return { ipVersion: 4, error: `Not a valid IP address: ${ip}` };
  }

  if (version === 4) {
    const prefix =
      options?.ipv4ZonePrefixLength ?? DEFAULT_IPV4_ZONE_PREFIX_LENGTH;
    if (prefix <= 0 || prefix > 32 || prefix % 8 !== 0) {
      return {
        ipVersion: 4,
        error: `Invalid IPv4 PTR zone prefix length: ${prefix} (must be multiple of 8 between 8 and 32)`,
      };
    }

    const octets = ip.split(".");
    if (octets.length !== 4 || octets.some((value) => value.length === 0)) {
      return { ipVersion: 4, error: `Not a valid IPv4 address: ${ip}` };
    }

    const reversed = [...octets].reverse();
    const networkOctets = prefix / 8;
    const zoneLabels = reversed.slice(4 - networkOctets);
    const recordLabels = reversed.slice(0, 4 - networkOctets);

    const zoneName = `${zoneLabels.join(".")}.in-addr.arpa`;
    const recordName = recordLabels.length > 0 ? recordLabels.join(".") : "@";
    return { ipVersion: 4, zoneName, recordName };
  }

  const prefix =
    options?.ipv6ZonePrefixLength ?? DEFAULT_IPV6_ZONE_PREFIX_LENGTH;
  if (prefix <= 0 || prefix > 128 || prefix % 4 !== 0) {
    return {
      ipVersion: 6,
      error: `Invalid IPv6 PTR zone prefix length: ${prefix} (must be multiple of 4 between 4 and 128)`,
    };
  }

  const nibbles = expandIpv6ToNibbles(ip);
  if (!nibbles) {
    return { ipVersion: 6, error: `Not a valid IPv6 address: ${ip}` };
  }

  const reversed = [...nibbles].reverse();
  const zoneNibbles = prefix / 4;
  const zoneLabels = reversed.slice(32 - zoneNibbles);
  const recordLabels = reversed.slice(0, 32 - zoneNibbles);
  const zoneName = `${zoneLabels.join(".")}.ip6.arpa`;
  const recordName = recordLabels.length > 0 ? recordLabels.join(".") : "@";
  return { ipVersion: 6, zoneName, recordName };
}

/**
 * Computes a network address in CIDR notation that can be passed to Technitium's
 * `/api/zones/create?zone=<cidr>` to create the corresponding reverse zone.
 */
export function computeReverseZoneCidr(
  ip: string,
  options?: { ipv4ZonePrefixLength?: number; ipv6ZonePrefixLength?: number },
): ReverseCidrResult {
  const version = isIP(ip);
  if (version !== 4 && version !== 6) {
    return { ipVersion: 4, error: `Not a valid IP address: ${ip}` };
  }

  if (version === 4) {
    const prefix =
      options?.ipv4ZonePrefixLength ?? DEFAULT_IPV4_ZONE_PREFIX_LENGTH;
    if (prefix <= 0 || prefix > 32 || prefix % 8 !== 0) {
      return {
        ipVersion: 4,
        error: `Invalid IPv4 PTR zone prefix length: ${prefix} (must be multiple of 8 between 8 and 32)`,
      };
    }

    const octets = ip.split(".");
    if (octets.length !== 4 || octets.some((value) => value.length === 0)) {
      return { ipVersion: 4, error: `Not a valid IPv4 address: ${ip}` };
    }

    const networkOctets = prefix / 8;
    const network = [
      ...octets.slice(0, networkOctets),
      ...Array.from({ length: 4 - networkOctets }, () => "0"),
    ];
    return { ipVersion: 4, cidr: `${network.join(".")}/${prefix}` };
  }

  const prefix =
    options?.ipv6ZonePrefixLength ?? DEFAULT_IPV6_ZONE_PREFIX_LENGTH;
  if (prefix <= 0 || prefix > 128 || prefix % 4 !== 0) {
    return {
      ipVersion: 6,
      error: `Invalid IPv6 PTR zone prefix length: ${prefix} (must be multiple of 4 between 4 and 128)`,
    };
  }

  const nibbles = expandIpv6ToNibbles(ip);
  if (!nibbles) {
    return { ipVersion: 6, error: `Not a valid IPv6 address: ${ip}` };
  }

  const keepNibbles = prefix / 4;
  const masked = [...nibbles];
  for (let i = keepNibbles; i < masked.length; i += 1) {
    masked[i] = "0";
  }

  const hextets: string[] = [];
  for (let i = 0; i < 32; i += 4) {
    hextets.push(masked.slice(i, i + 4).join(""));
  }

  return { ipVersion: 6, cidr: `${hextets.join(":")}/${prefix}` };
}

export function expandIpv6ToNibbles(ip: string): string[] | null {
  // Normalize zone index if present.
  const withoutZone = ip.split("%")[0] ?? ip;

  if (!withoutZone.includes(":")) {
    return null;
  }

  const [head, tail] = withoutZone.split("::");
  const headParts = head ? head.split(":").filter(Boolean) : [];
  const tailParts = tail ? tail.split(":").filter(Boolean) : [];

  // Reject multiple '::'
  if (withoutZone.split("::").length > 2) {
    return null;
  }

  const isIpv4Mapped =
    tailParts.length > 0 && tailParts[tailParts.length - 1]?.includes(".");
  const ipv4Part = isIpv4Mapped ? tailParts.pop() : undefined;

  const parseHextet = (value: string): string[] | null => {
    if (!/^[0-9a-fA-F]{1,4}$/.test(value)) {
      return null;
    }
    const padded = value.toLowerCase().padStart(4, "0");
    return padded.split("");
  };

  const parsedHead = headParts.map(parseHextet);
  const parsedTail = tailParts.map(parseHextet);

  if (
    parsedHead.some((p) => p === null) ||
    parsedTail.some((p) => p === null)
  ) {
    return null;
  }

  let extraTailNibbles: string[] = [];
  if (ipv4Part) {
    const octets = ipv4Part.split(".");
    if (octets.length !== 4) {
      return null;
    }
    const bytes = octets.map((o) => Number.parseInt(o, 10));
    if (bytes.some((b) => Number.isNaN(b) || b < 0 || b > 255)) {
      return null;
    }
    const hextet1 = ((bytes[0] << 8) | bytes[1]).toString(16).padStart(4, "0");
    const hextet2 = ((bytes[2] << 8) | bytes[3]).toString(16).padStart(4, "0");
    extraTailNibbles = [...hextet1, ...hextet2];
  }

  const headNibbles = (parsedHead as string[][]).flat();
  const tailNibbles = (parsedTail as string[][]).flat();

  const totalKnownNibbles =
    headNibbles.length + tailNibbles.length + extraTailNibbles.length;
  if (totalKnownNibbles > 32) {
    return null;
  }

  const missingNibbles = 32 - totalKnownNibbles;
  const zeros = Array.from({ length: missingNibbles }, () => "0");

  return [...headNibbles, ...zeros, ...tailNibbles, ...extraTailNibbles];
}

export function toFqdn(recordName: string, zoneName: string): string {
  const trimmed = recordName.trim();
  const zoneTrimmed = zoneName.trim();
  if (!trimmed || trimmed === "@") {
    return ensureTrailingDot(zoneTrimmed);
  }

  // If the caller already provided an absolute name (explicit trailing dot), respect it.
  if (trimmed.endsWith(".")) {
    return ensureTrailingDot(trimmed);
  }

  // If it's already an absolute-ish name under the zone.
  if (trimmed.toLowerCase().endsWith(`.${zoneTrimmed.toLowerCase()}`)) {
    return ensureTrailingDot(trimmed);
  }

  // Treat the value as relative to the provided zone.
  // Note: record names frequently contain dots (e.g., reverse zones, multi-label owners).
  return ensureTrailingDot(`${trimmed}.${zoneTrimmed}`);
}

function ensureTrailingDot(value: string): string {
  const v = value.trim();
  if (!v) return v;
  return v.endsWith(".") ? v : `${v}.`;
}
