import {
  computeReverseZoneAndRecordName,
  computeReverseZoneCidr,
  expandIpv6ToNibbles,
  toFqdn,
} from "./split-horizon-ptr.util";

describe("split-horizon-ptr.util", () => {
  describe("toFqdn", () => {
    it("treats dotted relative names as relative to the zone", () => {
      expect(toFqdn("www.sub", "example.com")).toBe("www.sub.example.com.");
    });

    it("does not duplicate zone when record name already includes it", () => {
      expect(toFqdn("www.example.com", "example.com")).toBe("www.example.com.");
    });

    it("respects explicit absolute names (trailing dot)", () => {
      expect(toFqdn("foo.bar.", "example.com")).toBe("foo.bar.");
    });
  });

  describe("computeReverseZoneAndRecordName (IPv4)", () => {
    it("computes /24 zone and record", () => {
      expect(
        computeReverseZoneAndRecordName("192.168.1.10", {
          ipv4ZonePrefixLength: 24,
        }),
      ).toEqual({
        ipVersion: 4,
        zoneName: "1.168.192.in-addr.arpa",
        recordName: "10",
      });
    });

    it("computes /32 zone with apex record", () => {
      expect(
        computeReverseZoneAndRecordName("192.168.1.10", {
          ipv4ZonePrefixLength: 32,
        }),
      ).toEqual({
        ipVersion: 4,
        zoneName: "10.1.168.192.in-addr.arpa",
        recordName: "@",
      });
    });

    it("rejects non-octet-aligned prefix lengths", () => {
      expect(
        computeReverseZoneAndRecordName("192.168.1.10", {
          ipv4ZonePrefixLength: 20,
        }),
      ).toEqual({
        ipVersion: 4,
        error: expect.stringContaining("Invalid IPv4 PTR zone prefix length"),
      });
    });
  });

  describe("computeReverseZoneAndRecordName (IPv6)", () => {
    it("computes /64 zone and record", () => {
      expect(
        computeReverseZoneAndRecordName("2001:db8::1", {
          ipv6ZonePrefixLength: 64,
        }),
      ).toEqual({
        ipVersion: 6,
        zoneName: "0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa",
        recordName: "1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0",
      });
    });

    it("supports zone indexes (e.g., %en0)", () => {
      expect(
        computeReverseZoneAndRecordName("fe80::1%en0", {
          ipv6ZonePrefixLength: 64,
        }),
      ).toEqual({
        ipVersion: 6,
        zoneName: "0.0.0.0.0.0.0.0.0.0.0.0.0.8.e.f.ip6.arpa",
        recordName: "1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0",
      });
    });

    it("rejects non-nibble-aligned prefix lengths", () => {
      expect(
        computeReverseZoneAndRecordName("2001:db8::1", {
          ipv6ZonePrefixLength: 62,
        }),
      ).toEqual({
        ipVersion: 6,
        error: expect.stringContaining("Invalid IPv6 PTR zone prefix length"),
      });
    });
  });

  describe("computeReverseZoneCidr", () => {
    it("computes IPv4 /24 network CIDR", () => {
      expect(
        computeReverseZoneCidr("192.168.1.10", { ipv4ZonePrefixLength: 24 }),
      ).toEqual({ ipVersion: 4, cidr: "192.168.1.0/24" });
    });

    it("computes IPv4 /32 network CIDR", () => {
      expect(
        computeReverseZoneCidr("192.168.1.10", { ipv4ZonePrefixLength: 32 }),
      ).toEqual({ ipVersion: 4, cidr: "192.168.1.10/32" });
    });

    it("computes IPv6 /64 network CIDR", () => {
      expect(
        computeReverseZoneCidr("2001:db8::1", { ipv6ZonePrefixLength: 64 }),
      ).toEqual({
        ipVersion: 6,
        cidr: "2001:0db8:0000:0000:0000:0000:0000:0000/64",
      });
    });

    it("supports IPv6 zone indexes", () => {
      expect(
        computeReverseZoneCidr("fe80::1%en0", { ipv6ZonePrefixLength: 64 }),
      ).toEqual({
        ipVersion: 6,
        cidr: "fe80:0000:0000:0000:0000:0000:0000:0000/64",
      });
    });

    it("rejects invalid IPv4 prefix", () => {
      expect(
        computeReverseZoneCidr("192.168.1.10", { ipv4ZonePrefixLength: 20 }),
      ).toEqual({
        ipVersion: 4,
        error: expect.stringContaining("Invalid IPv4 PTR zone prefix length"),
      });
    });

    it("rejects invalid IPv6 prefix", () => {
      expect(
        computeReverseZoneCidr("2001:db8::1", { ipv6ZonePrefixLength: 62 }),
      ).toEqual({
        ipVersion: 6,
        error: expect.stringContaining("Invalid IPv6 PTR zone prefix length"),
      });
    });
  });

  describe("expandIpv6ToNibbles", () => {
    it("expands IPv4-mapped IPv6", () => {
      const nibbles = expandIpv6ToNibbles("::ffff:192.0.2.128");
      expect(nibbles).not.toBeNull();
      expect(nibbles).toHaveLength(32);

      // Last 32 bits should encode 192.0.2.128 => c000:0280
      expect(nibbles!.slice(24).join("")).toBe("c0000280");
    });

    it("returns null for invalid input", () => {
      expect(expandIpv6ToNibbles("not-an-ip")).toBeNull();
    });
  });
});
