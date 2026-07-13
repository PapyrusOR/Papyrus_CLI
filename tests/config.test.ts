import { afterEach, describe, expect, it } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, saveConfig } from "../src/config.js";

const tempPaths: string[] = [];

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "papyrus-cli-config-"));
  tempPaths.push(dir);
  return path.join(dir, "cli.json");
}

afterEach(() => {
  for (const dir of tempPaths.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("CLI configuration", () => {
  it("does not create a config file while reading defaults", () => {
    const filePath = tempFile();
    const config = loadConfig({ filePath, env: {} });

    expect(config.apiUrl).toBe("http://127.0.0.1:8000/api");
    expect(config.mcpUrl).toBe("http://127.0.0.1:9200");
    expect(config.timeoutMs).toBe(30_000);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("uses overrides before environment and file values", () => {
    const filePath = tempFile();
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        apiUrl: "http://file:8000",
        mcpUrl: "http://file:9200",
        timeoutMs: 1000,
        dataDir: "file-data",
      })
    );

    const config = loadConfig({
      filePath,
      env: {
        PAPYRUS_API_URL: "http://env:8000",
        PAPYRUS_MCP_URL: "http://env:9200",
        PAPYRUS_TIMEOUT_MS: "2000",
        PAPYRUS_AUTH_TOKEN: "env-token",
      },
      overrides: {
        apiUrl: "http://flag:8000",
        timeoutMs: 3000,
      },
    });

    expect(config).toMatchObject({
      apiUrl: "http://flag:8000",
      mcpUrl: "http://env:9200",
      timeoutMs: 3000,
      authToken: "env-token",
      dataDir: "file-data",
    });
  });

  it("never persists the authentication token", () => {
    const filePath = tempFile();
    saveConfig(
      {
        apiUrl: "http://127.0.0.1:8000/api",
        mcpUrl: "http://127.0.0.1:9200",
        timeoutMs: 30_000,
        dataDir: "data",
        authToken: "secret",
      },
      filePath
    );

    expect(JSON.parse(fs.readFileSync(filePath, "utf8"))).toEqual({
      apiUrl: "http://127.0.0.1:8000/api",
      mcpUrl: "http://127.0.0.1:9200",
      timeoutMs: 30_000,
      dataDir: "data",
    });
  });
});
