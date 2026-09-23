import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAutomationCredentialMap } from "./credential-map";

describe("automation credential maps", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "credential-map-spec-"));
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  const write = (source: string): string => {
    const path = join(directory, "map.json");
    writeFileSync(path, source);
    return path;
  };

  it("accepts a strict subset of known groups", () => {
    const result = loadAutomationCredentialMap(
      write(
        JSON.stringify({
          version: 1,
          groups: {
            "site-a": { username: "automation-a", token: "token-a" },
          },
        }),
      ),
      new Set(["site-a", "site-b"]),
      "TECHNITIUM_BACKGROUND_TOKEN_MAP_FILE",
    );
    expect([...result.entries()]).toEqual([
      ["site-a", { username: "automation-a", token: "token-a" }],
    ]);
  });

  it("rejects unknown groups, malformed entries, empty maps, and duplicate keys", () => {
    expect(() =>
      loadAutomationCredentialMap(
        write(
          '{"version":1,"groups":{"unknown":{"username":"user","token":"token"}}}',
        ),
        new Set(["site-a"]),
        "TECHNITIUM_BACKGROUND_TOKEN_MAP_FILE",
      ),
    ).toThrow(/unknown group/);
    expect(() =>
      loadAutomationCredentialMap(
        write('{"version":1,"groups":{}}'),
        new Set(["site-a"]),
        "TECHNITIUM_BACKGROUND_TOKEN_MAP_FILE",
      ),
    ).toThrow(/at least one group/);
    expect(() =>
      loadAutomationCredentialMap(
        write(
          '{"version":1,"groups":{"site-a":{"username":"user","token":"one"},"site-a":{"username":"user","token":"two"}}}',
        ),
        new Set(["site-a"]),
        "TECHNITIUM_BACKGROUND_TOKEN_MAP_FILE",
      ),
    ).toThrow(/readable, valid JSON/);
    expect(() =>
      loadAutomationCredentialMap(
        write(
          '{"version":1,"groups":{"site-a":{"username":"user","token":"token","extra":true}}}',
        ),
        new Set(["site-a"]),
        "TECHNITIUM_BACKGROUND_TOKEN_MAP_FILE",
      ),
    ).toThrow(/invalid schema/);
  });
});
