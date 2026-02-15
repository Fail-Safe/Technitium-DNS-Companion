import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getEnvOrFile, resolveEnvFileVariables } from "./env-file";

describe("env-file utilities", () => {
  const testDir = join(tmpdir(), "tdc-env-file-test");

  beforeAll(() => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Clean up env vars before each test
    delete process.env.TEST_VAR;
    delete process.env.TEST_VAR_FILE;
    delete process.env.TECHNITIUM_BACKGROUND_TOKEN;
    delete process.env.TECHNITIUM_BACKGROUND_TOKEN_FILE;
    delete process.env.TECHNITIUM_NODES;
    delete process.env.TECHNITIUM_NODE1_TOKEN;
    delete process.env.TECHNITIUM_NODE1_TOKEN_FILE;
  });

  describe("getEnvOrFile", () => {
    it("should return direct env value when no _FILE variant is set", () => {
      process.env.TEST_VAR = "direct-value";

      const result = getEnvOrFile("TEST_VAR");

      expect(result).toBe("direct-value");
    });

    it("should return undefined when neither variant is set", () => {
      const result = getEnvOrFile("TEST_VAR");

      expect(result).toBeUndefined();
    });

    it("should read file contents when _FILE variant is set", () => {
      const filePath = join(testDir, "test-secret.txt");
      writeFileSync(filePath, "file-secret-value");
      process.env.TEST_VAR_FILE = filePath;

      const result = getEnvOrFile("TEST_VAR");

      expect(result).toBe("file-secret-value");
    });

    it("should trim whitespace from file contents", () => {
      const filePath = join(testDir, "test-whitespace.txt");
      writeFileSync(filePath, "  secret-with-whitespace  \n\n");
      process.env.TEST_VAR_FILE = filePath;

      const result = getEnvOrFile("TEST_VAR");

      expect(result).toBe("secret-with-whitespace");
    });

    it("should prefer _FILE variant over direct env value", () => {
      const filePath = join(testDir, "test-priority.txt");
      writeFileSync(filePath, "file-value");
      process.env.TEST_VAR = "direct-value";
      process.env.TEST_VAR_FILE = filePath;

      const result = getEnvOrFile("TEST_VAR");

      expect(result).toBe("file-value");
    });

    it("should return undefined when _FILE points to non-existent file", () => {
      process.env.TEST_VAR_FILE = "/non/existent/path.txt";

      const result = getEnvOrFile("TEST_VAR");

      expect(result).toBeUndefined();
    });
  });

  describe("resolveEnvFileVariables", () => {
    it("should resolve TECHNITIUM_BACKGROUND_TOKEN from file", () => {
      const filePath = join(testDir, "background-token.txt");
      writeFileSync(filePath, "my-background-token");
      process.env.TECHNITIUM_BACKGROUND_TOKEN_FILE = filePath;

      resolveEnvFileVariables();

      expect(process.env.TECHNITIUM_BACKGROUND_TOKEN).toBe(
        "my-background-token",
      );
    });

    it("should resolve per-node tokens from files", () => {
      const filePath = join(testDir, "node1-token.txt");
      writeFileSync(filePath, "node1-secret-token");
      process.env.TECHNITIUM_NODES = "node1";
      process.env.TECHNITIUM_NODE1_TOKEN_FILE = filePath;

      resolveEnvFileVariables();

      expect(process.env.TECHNITIUM_NODE1_TOKEN).toBe("node1-secret-token");
    });

    it("should not overwrite existing env values", () => {
      const filePath = join(testDir, "should-not-use.txt");
      writeFileSync(filePath, "file-value");
      process.env.TECHNITIUM_BACKGROUND_TOKEN = "existing-value";
      process.env.TECHNITIUM_BACKGROUND_TOKEN_FILE = filePath;

      resolveEnvFileVariables();

      expect(process.env.TECHNITIUM_BACKGROUND_TOKEN).toBe("existing-value");
    });
  });
});
