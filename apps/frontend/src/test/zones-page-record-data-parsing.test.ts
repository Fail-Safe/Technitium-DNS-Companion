import { describe, expect, it } from "vitest";
import { parseKeyValueLine } from "../utils/zoneRecordDataParsing";

describe("ZonesPage parseKeyValueLine", () => {
  it("parses IPv4 key/value lines", () => {
    expect(parseKeyValueLine("100.64.64.170: restrict.youtube.com")).toEqual({
      indent: "",
      key: "100.64.64.170",
      value: "restrict.youtube.com",
    });
  });

  it("parses IPv6 key/value lines (colons in key)", () => {
    expect(
      parseKeyValueLine("fd7a:115c:a1e0:10::170: restrict.youtube.com"),
    ).toEqual({
      indent: "",
      key: "fd7a:115c:a1e0:10::170",
      value: "restrict.youtube.com",
    });
  });

  it("parses CIDR key/value lines", () => {
    expect(
      parseKeyValueLine("192.168.18.0/24: restrictmoderate.youtube.com"),
    ).toEqual({
      indent: "",
      key: "192.168.18.0/24",
      value: "restrictmoderate.youtube.com",
    });
  });

  it("preserves indentation", () => {
    expect(parseKeyValueLine("  classPath: SplitHorizon.SimpleCNAME")).toEqual({
      indent: "  ",
      key: "classPath",
      value: "SplitHorizon.SimpleCNAME",
    });
  });

  it("does not split on URL scheme colon", () => {
    expect(parseKeyValueLine("url: https://example.com/path")).toEqual({
      indent: "",
      key: "url",
      value: "https://example.com/path",
    });
  });

  it("returns null when no ': ' delimiter exists", () => {
    expect(parseKeyValueLine("fd7a::170:restrict.youtube.com")).toBeNull();
    expect(parseKeyValueLine("no delimiter here")).toBeNull();
  });

  it("returns null when key or value is empty", () => {
    expect(parseKeyValueLine("key: ")).toBeNull();
    expect(parseKeyValueLine(": value")).toBeNull();
  });
});
