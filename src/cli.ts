#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PapyrusApiError, PapyrusClient } from "./api.js";
import { getConfigPath, loadConfig, resetConfig, setConfig } from "./config.js";
import type { CLIConfig, JsonObject, RuntimeOverrides } from "./types.js";

function readPackageVersion(): string {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")
    ) as { version?: unknown };
    return typeof packageJson.version === "string" ? packageJson.version : "0.0.0-dev";
  } catch {
    return "0.0.0-dev";
  }
}

const VERSION = readPackageVersion();
const BOOLEAN_FLAGS = new Set(["json", "force", "enabled", "disabled", "help", "version"]);

interface ParsedArgs {
  json: boolean;
  positionals: string[];
  values: Map<string, string>;
  booleans: Set<string>;
}

export interface ExecuteOptions {
  client?: PapyrusClient;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

export interface ExecuteResult {
  value: unknown;
  json: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const positionals: string[] = [];
  const values = new Map<string, string>();
  const booleans = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === undefined) {
      continue;
    }
    if (!current.startsWith("--")) {
      positionals.push(current);
      continue;
    }

    const equalsIndex = current.indexOf("=");
    const key = current.slice(2, equalsIndex === -1 ? undefined : equalsIndex);
    if (equalsIndex !== -1) {
      values.set(key, current.slice(equalsIndex + 1));
      continue;
    }
    if (BOOLEAN_FLAGS.has(key)) {
      booleans.add(key);
      continue;
    }
    const next = args[index + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new Error(`--${key} 需要提供值`);
    }
    values.set(key, next);
    index += 1;
  }

  return { json: booleans.has("json"), positionals, values, booleans };
}

function required(value: string | undefined, message: string): string {
  if (!value) {
    throw new Error(message);
  }
  return value;
}

function encode(value: string): string {
  return encodeURIComponent(value);
}

function csv(value: string | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function integer(value: string | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} 必须是整数`);
  }
  return parsed;
}

function jsonObject(value: string | undefined, label: string, fallback?: JsonObject): JsonObject {
  if (value === undefined) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error(`${label} 需要 JSON 对象`);
  }
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} 必须是 JSON 对象`);
  }
  return parsed as JsonObject;
}

function runtimeOverrides(parsed: ParsedArgs): RuntimeOverrides {
  return {
    apiUrl: parsed.values.get("api-url"),
    mcpUrl: parsed.values.get("mcp-url"),
    authToken: parsed.values.get("token"),
    timeoutMs: integer(parsed.values.get("timeout"), "--timeout"),
  };
}

function makeClient(parsed: ParsedArgs, options: ExecuteOptions): PapyrusClient {
  if (options.client) {
    return options.client;
  }
  return new PapyrusClient(loadConfig({ env: options.env, overrides: runtimeOverrides(parsed) }));
}

function help(): JsonObject {
  return {
    name: "@papyrus/cli",
    version: VERSION,
    purpose: "Papyrus Desktop TypeScript API/MCP command layer",
    commands: [
      "status",
      "cards",
      "review",
      "search",
      "notes",
      "files",
      "relations",
      "extensions",
      "progress",
      "providers",
      "sessions",
      "mcp",
      "workspace",
      "data",
      "manager",
      "request",
      "config",
    ],
    globalOptions: ["--json", "--api-url", "--mcp-url", "--token", "--timeout"],
  };
}

async function executeCards(
  client: PapyrusClient,
  action: string,
  args: string[],
  parsed: ParsedArgs,
  cwd: string
): Promise<unknown> {
  if (action === "list" || action === "ls") {
    return await client.request("/cards");
  }
  if (action === "show" || action === "get") {
    const id = required(args[0], "cards show 需要卡片 ID");
    return await client.request(`/cards/${encode(id)}`);
  }
  if (action === "add" || action === "create") {
    const q = required(
      args[0] ?? parsed.values.get("q") ?? parsed.values.get("question"),
      "cards add 需要问题"
    );
    const a = required(
      args[1] ?? parsed.values.get("a") ?? parsed.values.get("answer"),
      "cards add 需要答案"
    );
    return await client.request("/cards", {
      method: "POST",
      body: { q, a, tags: csv(parsed.values.get("tags")) ?? [] },
    });
  }
  if (action === "edit" || action === "update") {
    const id = required(args[0], "cards edit 需要卡片 ID");
    const q = parsed.values.get("q") ?? parsed.values.get("question");
    const a = parsed.values.get("a") ?? parsed.values.get("answer");
    const tags = csv(parsed.values.get("tags"));
    if (q === undefined && a === undefined && tags === undefined) {
      throw new Error("cards edit 至少需要 --q/--question、--a/--answer 或 --tags");
    }
    return await client.request(`/cards/${encode(id)}`, {
      method: "PATCH",
      body: {
        ...(q !== undefined ? { q } : {}),
        ...(a !== undefined ? { a } : {}),
        ...(tags !== undefined ? { tags } : {}),
      },
    });
  }
  if (action === "delete" || action === "rm") {
    const id = required(args[0], "cards delete 需要卡片 ID");
    return await client.request(`/cards/${encode(id)}`, { method: "DELETE" });
  }
  if (action === "batch-delete") {
    const ids = csv(parsed.values.get("ids"));
    if (!ids?.length) {
      throw new Error("cards batch-delete 需要 --ids id1,id2");
    }
    return await client.request("/cards/batch-delete", { method: "POST", body: { ids } });
  }
  if (action === "import") {
    const file = path.resolve(cwd, required(args[0], "cards import 需要文本文件路径"));
    return await client.request("/cards/import/txt", {
      method: "POST",
      body: { content: fs.readFileSync(file, "utf8") },
    });
  }
  if (action === "export") {
    const result = await client.request("/cards");
    const output = parsed.values.get("output");
    if (output) {
      fs.writeFileSync(path.resolve(cwd, output), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    }
    return result;
  }
  if (action === "due" || action === "due-today") {
    return await client.request("/review/next");
  }
  if (action === "history") {
    const id = required(args[0], "cards history 需要卡片 ID");
    return await client.request(`/cards/${encode(id)}/history`);
  }
  if (action === "version") {
    const id = required(args[0], "cards version 需要卡片 ID");
    const versionId = required(args[1], "cards version 需要版本 ID");
    return await client.request(`/cards/${encode(id)}/history/${encode(versionId)}`);
  }
  if (action === "rollback") {
    const id = required(args[0], "cards rollback 需要卡片 ID");
    const versionId = required(args[1], "cards rollback 需要版本 ID");
    return await client.request(`/cards/${encode(id)}/rollback/${encode(versionId)}`, {
      method: "POST",
      body: {},
    });
  }
  throw new Error(`未知 cards 命令: ${action}`);
}

async function executeNotes(
  client: PapyrusClient,
  action: string,
  args: string[],
  parsed: ParsedArgs
): Promise<unknown> {
  if (action === "list" || action === "ls") return await client.request("/notes");
  if (action === "show" || action === "get")
    return await client.request(`/notes/${encode(required(args[0], "notes show 需要笔记 ID"))}`);
  if (action === "add" || action === "create") {
    const title = required(args[0] ?? parsed.values.get("title"), "notes add 需要标题");
    return await client.request("/notes", {
      method: "POST",
      body: {
        title,
        folder: parsed.values.get("folder"),
        content: parsed.values.get("content") ?? "",
        tags: csv(parsed.values.get("tags")) ?? [],
      },
    });
  }
  if (action === "edit" || action === "update") {
    const id = required(args[0], "notes edit 需要笔记 ID");
    const title = parsed.values.get("title");
    const folder = parsed.values.get("folder");
    const content = parsed.values.get("content");
    const tags = csv(parsed.values.get("tags"));
    return await client.request(`/notes/${encode(id)}`, {
      method: "PATCH",
      body: {
        ...(title !== undefined ? { title } : {}),
        ...(folder !== undefined ? { folder } : {}),
        ...(content !== undefined ? { content } : {}),
        ...(tags !== undefined ? { tags } : {}),
      },
    });
  }
  if (action === "delete" || action === "rm")
    return await client.request(`/notes/${encode(required(args[0], "notes delete 需要笔记 ID"))}`, {
      method: "DELETE",
    });
  if (action === "batch-delete") {
    const ids = csv(parsed.values.get("ids"));
    if (!ids?.length) throw new Error("notes batch-delete 需要 --ids id1,id2");
    return await client.request("/notes/batch-delete", { method: "POST", body: { ids } });
  }
  if (action === "import-obsidian") {
    const vaultPath = required(
      args[0] ?? parsed.values.get("vault"),
      "notes import-obsidian 需要 vault 路径"
    );
    return await client.request("/notes/import/obsidian", {
      method: "POST",
      body: { vault_path: vaultPath, exclude_folders: csv(parsed.values.get("exclude")) ?? [] },
    });
  }
  if (action === "history")
    return await client.request(
      `/notes/${encode(required(args[0], "notes history 需要笔记 ID"))}/history`
    );
  if (action === "version") {
    const id = required(args[0], "notes version 需要笔记 ID");
    const versionId = required(args[1], "notes version 需要版本 ID");
    return await client.request(`/notes/${encode(id)}/history/${encode(versionId)}`);
  }
  if (action === "rollback") {
    const id = required(args[0], "notes rollback 需要笔记 ID");
    const versionId = required(args[1], "notes rollback 需要版本 ID");
    return await client.request(`/notes/${encode(id)}/rollback/${encode(versionId)}`, {
      method: "POST",
      body: {},
    });
  }
  throw new Error(`未知 notes 命令: ${action}`);
}

async function executeFiles(
  client: PapyrusClient,
  action: string,
  args: string[],
  parsed: ParsedArgs,
  cwd: string
): Promise<unknown> {
  if (action === "list" || action === "ls") return await client.request("/files");
  if (action === "show" || action === "get")
    return await client.request(`/files/${encode(required(args[0], "files show 需要文件 ID"))}`);
  if (action === "mkdir") {
    return await client.request("/files/folder", {
      method: "POST",
      body: {
        name: required(args[0], "files mkdir 需要名称"),
        parentId: parsed.values.get("parent-id"),
      },
    });
  }
  if (action === "upload") {
    const filePath = path.resolve(cwd, required(args[0], "files upload 需要本地文件路径"));
    return await client.request("/files/upload", {
      method: "POST",
      body: {
        files: [
          {
            name: path.basename(filePath),
            content: fs.readFileSync(filePath).toString("base64"),
            mimeType: parsed.values.get("mime-type"),
          },
        ],
        parentId: parsed.values.get("parent-id"),
      },
    });
  }
  if (action === "preview" || action === "download" || action === "thumbnail") {
    const id = required(args[0], `files ${action} 需要文件 ID`);
    let raw = await client.requestRaw(`/files/${encode(id)}/${action}`);
    if (action === "download" && raw.body.byteLength === 0) {
      const metadata = await client.request<{ file?: { size?: number } }>(`/files/${encode(id)}`);
      if ((metadata.file?.size ?? 0) > 0) {
        raw = await client.requestRaw(`/files/${encode(id)}/preview`);
      }
    }
    const output = parsed.values.get("output");
    if (output) fs.writeFileSync(path.resolve(cwd, output), raw.body);
    return {
      success: true,
      status: raw.status,
      contentType: raw.contentType,
      bytes: raw.body.byteLength,
      ...(output
        ? { output: path.resolve(cwd, output) }
        : { content: Buffer.from(raw.body).toString("base64") }),
    };
  }
  if (action === "delete" || action === "rm")
    return await client.request(`/files/${encode(required(args[0], "files delete 需要文件 ID"))}`, {
      method: "DELETE",
    });
  throw new Error(`未知 files 命令: ${action}`);
}

async function executeRelations(
  client: PapyrusClient,
  action: string,
  args: string[],
  parsed: ParsedArgs
): Promise<unknown> {
  if (action === "list")
    return await client.request(
      `/notes/${encode(required(args[0], "relations list 需要笔记 ID"))}/relations`
    );
  if (action === "search") {
    const query = required(args[0], "relations search 需要查询词");
    const exclude = parsed.values.get("exclude-note-id");
    const limit = parsed.values.get("limit");
    const search = new URLSearchParams({ query });
    if (exclude) search.set("exclude_note_id", exclude);
    if (limit) search.set("limit", limit);
    return await client.request(`/notes/search-for-relation?${search.toString()}`);
  }
  if (action === "graph") {
    const id = required(args[0], "relations graph 需要笔记 ID");
    const depth = parsed.values.get("depth");
    return await client.request(
      `/notes/${encode(id)}/graph${depth ? `?depth=${encode(depth)}` : ""}`
    );
  }
  if (action === "add") {
    const noteId = required(args[0], "relations add 需要源笔记 ID");
    const targetId = required(
      args[1] ?? parsed.values.get("target-id"),
      "relations add 需要目标笔记 ID"
    );
    return await client.request(`/notes/${encode(noteId)}/relations`, {
      method: "POST",
      body: {
        target_id: targetId,
        relation_type: parsed.values.get("type"),
        description: parsed.values.get("description"),
      },
    });
  }
  if (action === "edit")
    return await client.request(
      `/relations/${encode(required(args[0], "relations edit 需要关联 ID"))}`,
      {
        method: "PATCH",
        body: {
          relation_type: parsed.values.get("type"),
          description: parsed.values.get("description"),
        },
      }
    );
  if (action === "delete" || action === "rm")
    return await client.request(
      `/relations/${encode(required(args[0], "relations delete 需要关联 ID"))}`,
      { method: "DELETE" }
    );
  throw new Error(`未知 relations 命令: ${action}`);
}

async function executeExtensions(
  client: PapyrusClient,
  action: string,
  args: string[],
  parsed: ParsedArgs,
  cwd: string
): Promise<unknown> {
  if (action === "list" || action === "ls") return await client.request("/extensions");
  if (action === "show" || action === "get")
    return await client.request(
      `/extensions/${encode(required(args[0], "extensions show 需要扩展 ID"))}`
    );
  if (action === "install") {
    const body = parsed.values.has("body")
      ? jsonObject(parsed.values.get("body"), "--body")
      : {
          id: required(args[0], "extensions install 需要扩展 ID"),
          name: required(parsed.values.get("name"), "extensions install 需要 --name"),
        };
    return await client.request("/extensions", { method: "POST", body });
  }
  if (action === "install-local") {
    const filePath = path.resolve(cwd, required(args[0], "extensions install-local 需要 zip 路径"));
    return await client.request("/extensions/install-local", {
      method: "POST",
      body: {
        filename: path.basename(filePath),
        content: fs.readFileSync(filePath).toString("base64"),
      },
    });
  }
  if (action === "delete" || action === "uninstall")
    return await client.request(
      `/extensions/${encode(required(args[0], "extensions delete 需要扩展 ID"))}`,
      { method: "DELETE" }
    );
  if (action === "enable" || action === "disable")
    return await client.request(
      `/extensions/${encode(required(args[0], `extensions ${action} 需要扩展 ID`))}/enabled`,
      { method: "POST", body: { enabled: action === "enable" } }
    );
  if (action === "check-updates")
    return await client.request("/extensions/check-updates", { method: "POST", body: {} });
  if (action === "config")
    return await client.request(
      `/extensions/${encode(required(args[0], "extensions config 需要扩展 ID"))}/config`,
      { method: "PUT", body: jsonObject(parsed.values.get("body"), "--body") }
    );
  throw new Error(`未知 extensions 命令: ${action}`);
}

async function executeProviders(
  client: PapyrusClient,
  action: string,
  args: string[],
  parsed: ParsedArgs
): Promise<unknown> {
  if (action === "list" || action === "ls") return await client.request("/providers");
  if (action === "add" || action === "create")
    return await client.request("/providers", {
      method: "POST",
      body: jsonObject(parsed.values.get("body"), "--body"),
    });
  if (action === "update")
    return await client.request(
      `/providers/${encode(required(args[0], "providers update 需要 provider ID"))}`,
      { method: "PUT", body: jsonObject(parsed.values.get("body"), "--body") }
    );
  if (action === "delete" || action === "rm")
    return await client.request(
      `/providers/${encode(required(args[0], "providers delete 需要 provider ID"))}`,
      { method: "DELETE" }
    );
  if (action === "default")
    return await client.request(
      `/providers/${encode(required(args[0], "providers default 需要 provider ID"))}/default`,
      { method: "POST", body: {} }
    );
  if (action === "enable" || action === "disable")
    return await client.request(
      `/providers/${encode(required(args[0], `providers ${action} 需要 provider ID`))}/enabled`,
      { method: "POST", body: { enabled: action === "enable" } }
    );
  if (action === "model-add")
    return await client.request(
      `/providers/${encode(required(args[0], "providers model-add 需要 provider ID"))}/models`,
      { method: "POST", body: jsonObject(parsed.values.get("body"), "--body") }
    );
  if (action === "model-update")
    return await client.request(
      `/providers/${encode(required(args[0], "providers model-update 需要 provider ID"))}/models/${encode(required(args[1], "providers model-update 需要 model ID"))}`,
      { method: "PUT", body: jsonObject(parsed.values.get("body"), "--body") }
    );
  if (action === "model-delete")
    return await client.request(
      `/providers/${encode(required(args[0], "providers model-delete 需要 provider ID"))}/models/${encode(required(args[1], "providers model-delete 需要 model ID"))}`,
      { method: "DELETE" }
    );
  if (action === "key-add")
    return await client.request(
      `/providers/${encode(required(args[0], "providers key-add 需要 provider ID"))}/apikeys`,
      { method: "POST", body: jsonObject(parsed.values.get("body"), "--body") }
    );
  if (action === "key-delete")
    return await client.request(
      `/providers/${encode(required(args[0], "providers key-delete 需要 provider ID"))}/apikeys/${encode(required(args[1], "providers key-delete 需要 key ID"))}`,
      { method: "DELETE" }
    );
  throw new Error(`未知 providers 命令: ${action}`);
}

async function executeSessions(
  client: PapyrusClient,
  action: string,
  args: string[],
  parsed: ParsedArgs
): Promise<unknown> {
  if (action === "list" || action === "ls") return await client.request("/sessions");
  if (action === "create" || action === "add")
    return await client.request("/sessions", {
      method: "POST",
      body: { title: args[0] ?? parsed.values.get("title") },
    });
  if (action === "clear") {
    if (!parsed.booleans.has("force"))
      throw new Error("sessions clear 会删除全部会话，需要 --force");
    return await client.request("/sessions", { method: "DELETE" });
  }
  if (action === "switch")
    return await client.request(
      `/sessions/${encode(required(args[0], "sessions switch 需要会话 ID"))}/switch`,
      { method: "POST", body: {} }
    );
  if (action === "rename")
    return await client.request(
      `/sessions/${encode(required(args[0], "sessions rename 需要会话 ID"))}`,
      {
        method: "PATCH",
        body: {
          title: required(args[1] ?? parsed.values.get("title"), "sessions rename 需要标题"),
        },
      }
    );
  if (action === "delete" || action === "rm")
    return await client.request(
      `/sessions/${encode(required(args[0], "sessions delete 需要会话 ID"))}`,
      { method: "DELETE" }
    );
  if (action === "messages")
    return await client.request(
      `/sessions/${encode(required(args[0], "sessions messages 需要会话 ID"))}/messages`
    );
  throw new Error(`未知 sessions 命令: ${action}`);
}

async function executeWorkspace(
  client: PapyrusClient,
  resource: string,
  action: string,
  args: string[],
  parsed: ParsedArgs
): Promise<unknown> {
  if (resource === "projects") {
    if (action === "list") return await client.request("/workspace/projects");
    if (action === "show")
      return await client.request(
        `/workspace/projects/${encode(required(args[0], "workspace projects show 需要项目 ID"))}`
      );
    if (action === "create")
      return await client.request("/workspace/projects", {
        method: "POST",
        body: jsonObject(parsed.values.get("body"), "--body"),
      });
    if (action === "update")
      return await client.request(
        `/workspace/projects/${encode(required(args[0], "workspace projects update 需要项目 ID"))}`,
        { method: "PUT", body: jsonObject(parsed.values.get("body"), "--body") }
      );
    if (action === "delete")
      return await client.request(
        `/workspace/projects/${encode(required(args[0], "workspace projects delete 需要项目 ID"))}`,
        { method: "DELETE" }
      );
    if (action === "reorder") {
      const ids = csv(parsed.values.get("ids"));
      if (!ids?.length) throw new Error("workspace projects reorder 需要 --ids");
      return await client.request("/workspace/projects-order", { method: "PUT", body: { ids } });
    }
  }
  if (resource === "automations") {
    if (action === "list") return await client.request("/workspace/automations");
    if (action === "show")
      return await client.request(
        `/workspace/automations/${encode(required(args[0], "workspace automations show 需要自动化 ID"))}`
      );
    if (action === "create")
      return await client.request("/workspace/automations", {
        method: "POST",
        body: jsonObject(parsed.values.get("body"), "--body"),
      });
    if (action === "update")
      return await client.request(
        `/workspace/automations/${encode(required(args[0], "workspace automations update 需要自动化 ID"))}`,
        { method: "PUT", body: jsonObject(parsed.values.get("body"), "--body") }
      );
    if (action === "delete")
      return await client.request(
        `/workspace/automations/${encode(required(args[0], "workspace automations delete 需要自动化 ID"))}`,
        { method: "DELETE" }
      );
    if (action === "run")
      return await client.request(
        `/workspace/automations/${encode(required(args[0], "workspace automations run 需要自动化 ID"))}/run`,
        { method: "POST", body: {} }
      );
  }
  if (resource === "runs") {
    if (action === "pending") return await client.request("/workspace/automation-runs/pending");
    if (action === "acknowledge")
      return await client.request(
        `/workspace/automation-runs/${encode(required(args[0], "workspace runs acknowledge 需要 run ID"))}/acknowledge`,
        { method: "POST", body: {} }
      );
  }
  throw new Error(`未知 workspace 命令: ${resource} ${action}`);
}

async function dispatch(parsed: ParsedArgs, options: ExecuteOptions): Promise<unknown> {
  const [primary = "help", secondary = "", tertiary = "", ...rest] = parsed.positionals;
  if (parsed.booleans.has("version") || primary === "version" || primary === "-v")
    return { version: VERSION };
  if (parsed.booleans.has("help") || primary === "help" || primary === "-h") return help();

  if (primary === "config") {
    if (!secondary || secondary === "show") {
      const config = loadConfig({ env: options.env });
      return {
        success: true,
        config: { ...config, authToken: config.authToken ? "***" : undefined },
        file: getConfigPath(options.env),
      };
    }
    if (secondary === "set") {
      const assignment = required(tertiary, "config set 需要 key=value");
      const separator = assignment.indexOf("=");
      if (separator < 1) throw new Error("config set 需要 key=value");
      const key = assignment.slice(0, separator) as keyof CLIConfig;
      const raw = assignment.slice(separator + 1);
      if (!["apiUrl", "mcpUrl", "timeoutMs", "dataDir", "defaultEditor"].includes(key))
        throw new Error(`不支持的配置项: ${key}`);
      setConfig(key, (key === "timeoutMs" ? integer(raw, "timeoutMs") : raw) as never);
      return { success: true, key };
    }
    if (secondary === "reset") {
      resetConfig();
      return { success: true };
    }
    throw new Error(`未知 config 命令: ${secondary}`);
  }

  if (primary === "serve" || primary === "server")
    return {
      success: true,
      managedBy: "Papyrus Desktop",
      message: "TypeScript/Fastify 后端由 Desktop 托管，无需 CLI 启动。",
    };
  if (primary === "stop") throw new Error("Desktop 托管模式不允许 CLI 停止后端");

  const client = makeClient(parsed, options);
  const cwd = options.cwd ?? process.cwd();

  if (primary === "status") {
    const health = await client.request("/health");
    return {
      success: true,
      cli: "@papyrus/cli",
      version: VERSION,
      apiBase: client.apiBase,
      mcpBase: client.mcpBase,
      health,
    };
  }
  if (primary === "cards" || primary === "card")
    return await executeCards(
      client,
      secondary || "list",
      [tertiary, ...rest].filter(Boolean),
      parsed,
      cwd
    );
  if (primary === "review") {
    const action = secondary || "next";
    if (action === "next") return await client.request("/review/next");
    if (action === "rate") {
      const cardId = required(tertiary, "review rate 需要卡片 ID");
      const grade = integer(parsed.values.get("grade") ?? rest[0], "grade");
      if (grade !== 1 && grade !== 2 && grade !== 3) throw new Error("grade 必须是 1、2 或 3");
      return await client.request(`/review/${encode(cardId)}/rate`, {
        method: "POST",
        body: { grade },
      });
    }
    if (action === "stats" || action === "summary")
      return await client.callMcpTool("get_review_stats", {});
    throw new Error(`未知 review 命令: ${action}`);
  }
  if (primary === "stats" || primary === "statistics")
    return await client.callMcpTool("get_review_stats", {});
  if (primary === "search") {
    const query = required(secondary, "search 需要查询词");
    const search = new URLSearchParams({ query });
    const limit = parsed.values.get("limit");
    const offset = parsed.values.get("offset");
    if (limit) search.set("limit", limit);
    if (offset) search.set("offset", offset);
    return await client.request(`/search?${search.toString()}`);
  }
  if (primary === "notes" || primary === "note")
    return await executeNotes(
      client,
      secondary || "list",
      [tertiary, ...rest].filter(Boolean),
      parsed
    );
  if (primary === "files" || primary === "file")
    return await executeFiles(
      client,
      secondary || "list",
      [tertiary, ...rest].filter(Boolean),
      parsed,
      cwd
    );
  if (primary === "relations" || primary === "relation")
    return await executeRelations(
      client,
      secondary || "list",
      [tertiary, ...rest].filter(Boolean),
      parsed
    );
  if (primary === "extensions" || primary === "ext")
    return await executeExtensions(
      client,
      secondary || "list",
      [tertiary, ...rest].filter(Boolean),
      parsed,
      cwd
    );
  if (primary === "progress") {
    const action = secondary || "streak";
    if (action === "streak") return await client.request("/progress/streak");
    if (action === "history" || action === "heatmap") {
      const days = parsed.values.get("days");
      return await client.request(`/progress/${action}${days ? `?days=${encode(days)}` : ""}`);
    }
    throw new Error(`未知 progress 命令: ${action}`);
  }
  if (primary === "providers" || primary === "provider")
    return await executeProviders(
      client,
      secondary || "list",
      [tertiary, ...rest].filter(Boolean),
      parsed
    );
  if (primary === "sessions" || primary === "session")
    return await executeSessions(
      client,
      secondary || "list",
      [tertiary, ...rest].filter(Boolean),
      parsed
    );
  if (primary === "mcp") {
    const action = secondary || "health";
    if (action === "health") return await client.request("/mcp/health");
    if (action === "tools") return await client.request("/mcp/tools");
    if (action === "call")
      return await client.callMcpTool(
        required(tertiary, "mcp call 需要工具名"),
        jsonObject(parsed.values.get("params"), "--params", {})
      );
    throw new Error(`未知 mcp 命令: ${action}`);
  }
  if (primary === "workspace")
    return await executeWorkspace(client, secondary, tertiary, rest, parsed);
  if (primary === "data") {
    const action = secondary;
    if (action === "backup") return await client.request("/backup", { method: "POST", body: {} });
    if (action === "export") {
      const result = await client.request("/export");
      const output = parsed.values.get("output");
      if (output)
        fs.writeFileSync(path.resolve(cwd, output), `${JSON.stringify(result, null, 2)}\n`, "utf8");
      return result;
    }
    if (action === "import") {
      const filePath = path.resolve(cwd, required(tertiary, "data import 需要 JSON 文件"));
      return await client.request("/import", {
        method: "POST",
        body: JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown,
      });
    }
    if (action === "reset") {
      if (!parsed.booleans.has("force")) throw new Error("data reset 会清空数据，需要 --force");
      return await client.request("/data/reset", { method: "POST", body: {} });
    }
    throw new Error(`未知 data 命令: ${action}`);
  }
  if (primary === "manager") {
    const action = secondary || "status";
    if (action === "status") return await client.request("/cli/status");
    if (action === "install" || action === "update")
      return await client.request(`/cli/${action}`, { method: "POST", body: {} });
    throw new Error(`未知 manager 命令: ${action}`);
  }
  if (primary === "request") {
    const method = required(secondary, "request 需要 HTTP method").toUpperCase();
    const requestPath = required(tertiary, "request 需要 API 路径");
    const body = parsed.values.has("body")
      ? jsonObject(parsed.values.get("body"), "--body")
      : undefined;
    return await client.request(requestPath, { method, body });
  }
  if (primary === "docs")
    return {
      success: true,
      api: `${client.apiBase}/health`,
      note: "Papyrus Desktop API 契约位于 docs/API.md",
    };
  throw new Error(`未知命令: ${parsed.positionals.join(" ")}`);
}

export async function executeCommand(
  args: string[],
  options: ExecuteOptions = {}
): Promise<ExecuteResult> {
  const parsed = parseArgs(args);
  return { value: await dispatch(parsed, options), json: parsed.json };
}

export function formatOutput(value: unknown, compact: boolean): string {
  return `${JSON.stringify(value, null, compact ? undefined : 2)}\n`;
}

export async function runCli(args = process.argv.slice(2)): Promise<number> {
  try {
    const result = await executeCommand(args);
    process.stdout.write(formatOutput(result.value, result.json));
    return 0;
  } catch (error) {
    const payload =
      error instanceof PapyrusApiError
        ? { success: false, error: error.message, status: error.status, errorId: error.errorId }
        : { success: false, error: error instanceof Error ? error.message : String(error) };
    process.stderr.write(formatOutput(payload, true));
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await runCli();
}
