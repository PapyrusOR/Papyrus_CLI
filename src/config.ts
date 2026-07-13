import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { CLIConfig, RuntimeOverrides } from "./types.js";

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv;
  filePath?: string;
  overrides?: RuntimeOverrides;
}

const DEFAULT_CONFIG: CLIConfig = {
  apiUrl: "http://127.0.0.1:8000/api",
  mcpUrl: "http://127.0.0.1:9200",
  timeoutMs: 30_000,
  dataDir: join(homedir(), "PapyrusData"),
};

export function getConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.PAPYRUS_CLI_CONFIG ?? join(homedir(), ".papyrus", "cli.json");
}

function readFileConfig(filePath: string): Partial<CLIConfig> {
  if (!existsSync(filePath)) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Partial<CLIConfig>) : {};
  } catch {
    return {};
  }
}

function readTimeout(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(options: LoadConfigOptions = {}): CLIConfig {
  const env = options.env ?? process.env;
  const filePath = options.filePath ?? getConfigPath(env);
  const file = readFileConfig(filePath);
  const timeoutMs =
    options.overrides?.timeoutMs ??
    readTimeout(env.PAPYRUS_TIMEOUT_MS, file.timeoutMs ?? DEFAULT_CONFIG.timeoutMs);

  return {
    ...DEFAULT_CONFIG,
    ...file,
    apiUrl:
      options.overrides?.apiUrl ?? env.PAPYRUS_API_URL ?? file.apiUrl ?? DEFAULT_CONFIG.apiUrl,
    mcpUrl:
      options.overrides?.mcpUrl ?? env.PAPYRUS_MCP_URL ?? file.mcpUrl ?? DEFAULT_CONFIG.mcpUrl,
    authToken: options.overrides?.authToken ?? env.PAPYRUS_AUTH_TOKEN ?? file.authToken,
    timeoutMs,
    dataDir: env.PAPYRUS_DATA_DIR ?? file.dataDir ?? DEFAULT_CONFIG.dataDir,
  };
}

export function saveConfig(config: CLIConfig, filePath = getConfigPath()): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const persisted = { ...config };
  delete persisted.authToken;
  writeFileSync(filePath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
}

export function getConfig<K extends keyof CLIConfig>(key: K): CLIConfig[K] {
  return loadConfig()[key];
}

export function setConfig<K extends keyof CLIConfig>(key: K, value: CLIConfig[K]): void {
  if (key === "authToken") {
    throw new Error("authToken 只能通过 PAPYRUS_AUTH_TOKEN 或 --token 提供，不会写入磁盘");
  }
  const config = loadConfig();
  config[key] = value;
  saveConfig(config);
}

export function resetConfig(filePath = getConfigPath()): void {
  saveConfig({ ...DEFAULT_CONFIG }, filePath);
}

export function getDataDir(): string {
  return loadConfig().dataDir;
}

export function getApiUrl(): string {
  return loadConfig().apiUrl;
}

export function displayConfig(): void {
  const config = loadConfig();
  console.log(
    JSON.stringify({ ...config, authToken: config.authToken ? "***" : undefined }, null, 2)
  );
}
