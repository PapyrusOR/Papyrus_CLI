import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PapyrusClient } from "../src/api.js";
import { executeCommand } from "../src/cli.js";
import type { CLIConfig } from "../src/types.js";

const testConfig: CLIConfig = {
  apiUrl: "http://127.0.0.1:8000/api",
  mcpUrl: "http://127.0.0.1:9200",
  timeoutMs: 5000,
  dataDir: "data",
};

describe("complete named command routing", () => {
  let client: PapyrusClient;
  let request: ReturnType<typeof jest.spyOn>;
  let raw: ReturnType<typeof jest.spyOn>;
  let callMcpTool: ReturnType<typeof jest.spyOn>;
  const tempDirs: string[] = [];

  beforeEach(() => {
    client = new PapyrusClient(testConfig);
    request = jest.spyOn(client, "request").mockResolvedValue({ success: true });
    raw = jest.spyOn(client, "requestRaw").mockResolvedValue({
      status: 200,
      contentType: "application/octet-stream",
      body: Uint8Array.from([1, 2, 3]),
    });
    callMcpTool = jest.spyOn(client, "callMcpTool").mockResolvedValue({ success: true });
  });

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function tempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "papyrus-cli-commands-"));
    tempDirs.push(dir);
    return dir;
  }

  async function expectRequest(
    args: string[],
    route: string,
    options?: { method?: string; body?: unknown }
  ): Promise<void> {
    await executeCommand(args, { client });
    if (options === undefined) expect(request).toHaveBeenLastCalledWith(route);
    else expect(request).toHaveBeenLastCalledWith(route, options);
  }

  it("routes the full card and versioning surface", async () => {
    await expectRequest(["cards", "list"], "/cards");
    await expectRequest(["cards", "show", "a/b"], "/cards/a%2Fb");
    await expectRequest(["cards", "edit", "c1", "--q", "Q2", "--tags", "x,y"], "/cards/c1", {
      method: "PATCH",
      body: { q: "Q2", tags: ["x", "y"] },
    });
    await expectRequest(["cards", "delete", "c1"], "/cards/c1", { method: "DELETE" });
    await expectRequest(["cards", "batch-delete", "--ids", "c1,c2"], "/cards/batch-delete", {
      method: "POST",
      body: { ids: ["c1", "c2"] },
    });
    await expectRequest(["cards", "due"], "/review/next");
    await expectRequest(["cards", "history", "c1"], "/cards/c1/history");
    await expectRequest(["cards", "version", "c1", "v1"], "/cards/c1/history/v1");
    await expectRequest(["cards", "rollback", "c1", "v1"], "/cards/c1/rollback/v1", {
      method: "POST",
      body: {},
    });

    const cwd = tempDir();
    fs.writeFileSync(path.join(cwd, "cards.txt"), "Q === A");
    await executeCommand(["cards", "import", "cards.txt"], { client, cwd });
    expect(request).toHaveBeenLastCalledWith("/cards/import/txt", {
      method: "POST",
      body: { content: "Q === A" },
    });
  });

  it("routes notes, history and Obsidian import", async () => {
    await expectRequest(["notes", "list"], "/notes");
    await expectRequest(["notes", "show", "n1"], "/notes/n1");
    await expectRequest(["notes", "edit", "n1", "--title", "New", "--tags", "a,b"], "/notes/n1", {
      method: "PATCH",
      body: { title: "New", tags: ["a", "b"] },
    });
    await expectRequest(["notes", "delete", "n1"], "/notes/n1", { method: "DELETE" });
    await expectRequest(["notes", "batch-delete", "--ids", "n1,n2"], "/notes/batch-delete", {
      method: "POST",
      body: { ids: ["n1", "n2"] },
    });
    await expectRequest(
      ["notes", "import-obsidian", "C:\\Vault", "--exclude", ".git,tmp"],
      "/notes/import/obsidian",
      {
        method: "POST",
        body: { vault_path: "C:\\Vault", exclude_folders: [".git", "tmp"] },
      }
    );
    await expectRequest(["notes", "history", "n1"], "/notes/n1/history");
    await expectRequest(["notes", "version", "n1", "v1"], "/notes/n1/history/v1");
    await expectRequest(["notes", "rollback", "n1", "v1"], "/notes/n1/rollback/v1", {
      method: "POST",
      body: {},
    });
  });

  it("routes files and handles binary downloads", async () => {
    await expectRequest(["files", "list"], "/files");
    await expectRequest(["files", "show", "f1"], "/files/f1");
    await expectRequest(["files", "mkdir", "Folder", "--parent-id", "root"], "/files/folder", {
      method: "POST",
      body: { name: "Folder", parentId: "root" },
    });

    const cwd = tempDir();
    fs.writeFileSync(path.join(cwd, "sample.bin"), Uint8Array.from([7, 8]));
    await executeCommand(["files", "upload", "sample.bin", "--mime-type", "application/test"], {
      client,
      cwd,
    });
    expect(request).toHaveBeenLastCalledWith("/files/upload", {
      method: "POST",
      body: {
        files: [{ name: "sample.bin", content: "Bwg=", mimeType: "application/test" }],
        parentId: undefined,
      },
    });

    const downloaded = await executeCommand(["files", "download", "f1", "--output", "out.bin"], {
      client,
      cwd,
    });
    expect(raw).toHaveBeenCalledWith("/files/f1/download");
    expect(fs.readFileSync(path.join(cwd, "out.bin"))).toEqual(Buffer.from([1, 2, 3]));
    expect(downloaded.value).toMatchObject({ success: true, bytes: 3 });
    await expectRequest(["files", "delete", "f1"], "/files/f1", { method: "DELETE" });
  });

  it("routes note relations", async () => {
    await expectRequest(["relations", "list", "n1"], "/notes/n1/relations");
    await expectRequest(
      ["relations", "search", "term", "--exclude-note-id", "n1", "--limit", "5"],
      "/notes/search-for-relation?query=term&exclude_note_id=n1&limit=5"
    );
    await expectRequest(["relations", "graph", "n1", "--depth", "2"], "/notes/n1/graph?depth=2");
    await expectRequest(
      ["relations", "add", "n1", "n2", "--type", "related"],
      "/notes/n1/relations",
      {
        method: "POST",
        body: { target_id: "n2", relation_type: "related", description: undefined },
      }
    );
    await expectRequest(["relations", "edit", "r1", "--description", "why"], "/relations/r1", {
      method: "PATCH",
      body: { relation_type: undefined, description: "why" },
    });
    await expectRequest(["relations", "delete", "r1"], "/relations/r1", { method: "DELETE" });
  });

  it("routes extensions and local packages", async () => {
    await expectRequest(["extensions", "list"], "/extensions");
    await expectRequest(["extensions", "show", "e1"], "/extensions/e1");
    await expectRequest(["extensions", "install", "e1", "--name", "Example"], "/extensions", {
      method: "POST",
      body: { id: "e1", name: "Example" },
    });
    await expectRequest(["extensions", "enable", "e1"], "/extensions/e1/enabled", {
      method: "POST",
      body: { enabled: true },
    });
    await expectRequest(["extensions", "disable", "e1"], "/extensions/e1/enabled", {
      method: "POST",
      body: { enabled: false },
    });
    await expectRequest(["extensions", "check-updates"], "/extensions/check-updates", {
      method: "POST",
      body: {},
    });
    await expectRequest(
      ["extensions", "config", "e1", "--body", '{"theme":"dark"}'],
      "/extensions/e1/config",
      {
        method: "PUT",
        body: { theme: "dark" },
      }
    );
    await expectRequest(["extensions", "delete", "e1"], "/extensions/e1", { method: "DELETE" });

    const cwd = tempDir();
    fs.writeFileSync(path.join(cwd, "extension.zip"), Uint8Array.from([1, 2]));
    await executeCommand(["extensions", "install-local", "extension.zip"], { client, cwd });
    expect(request).toHaveBeenLastCalledWith("/extensions/install-local", {
      method: "POST",
      body: { filename: "extension.zip", content: "AQI=" },
    });
  });

  it("routes providers, models and keys", async () => {
    await expectRequest(["providers", "list"], "/providers");
    await expectRequest(["providers", "update", "p1", "--body", '{"name":"P"}'], "/providers/p1", {
      method: "PUT",
      body: { name: "P" },
    });
    await expectRequest(["providers", "default", "p1"], "/providers/p1/default", {
      method: "POST",
      body: {},
    });
    await expectRequest(["providers", "disable", "p1"], "/providers/p1/enabled", {
      method: "POST",
      body: { enabled: false },
    });
    await expectRequest(
      ["providers", "model-add", "p1", "--body", '{"name":"M","modelId":"m"}'],
      "/providers/p1/models",
      { method: "POST", body: { name: "M", modelId: "m" } }
    );
    await expectRequest(
      ["providers", "model-update", "p1", "m1", "--body", '{"name":"M2","modelId":"m2"}'],
      "/providers/p1/models/m1",
      { method: "PUT", body: { name: "M2", modelId: "m2" } }
    );
    await expectRequest(["providers", "model-delete", "p1", "m1"], "/providers/p1/models/m1", {
      method: "DELETE",
    });
    await expectRequest(
      ["providers", "key-add", "p1", "--body", '{"name":"key","key":"secret"}'],
      "/providers/p1/apikeys",
      { method: "POST", body: { name: "key", key: "secret" } }
    );
    await expectRequest(["providers", "key-delete", "p1", "k1"], "/providers/p1/apikeys/k1", {
      method: "DELETE",
    });
    await expectRequest(["providers", "delete", "p1"], "/providers/p1", { method: "DELETE" });
  });

  it("routes sessions, progress, MCP, manager and search", async () => {
    await expectRequest(["sessions", "list"], "/sessions");
    await expectRequest(["sessions", "create", "Research"], "/sessions", {
      method: "POST",
      body: { title: "Research" },
    });
    await expectRequest(["sessions", "switch", "s1"], "/sessions/s1/switch", {
      method: "POST",
      body: {},
    });
    await expectRequest(["sessions", "rename", "s1", "New"], "/sessions/s1", {
      method: "PATCH",
      body: { title: "New" },
    });
    await expectRequest(["sessions", "messages", "s1"], "/sessions/s1/messages");
    await expectRequest(["sessions", "delete", "s1"], "/sessions/s1", { method: "DELETE" });
    await expectRequest(["sessions", "clear", "--force"], "/sessions", { method: "DELETE" });
    await expectRequest(["progress", "streak"], "/progress/streak");
    await expectRequest(["progress", "history", "--days", "7"], "/progress/history?days=7");
    await expectRequest(["progress", "heatmap"], "/progress/heatmap");
    await expectRequest(
      ["search", "hello world", "--limit", "10", "--offset", "2"],
      "/search?query=hello+world&limit=10&offset=2"
    );
    await expectRequest(["mcp", "health"], "/mcp/health");
    await expectRequest(["mcp", "tools"], "/mcp/tools");
    await executeCommand(["mcp", "call", "tool-1", "--params", '{"x":1}'], { client });
    expect(callMcpTool).toHaveBeenLastCalledWith("tool-1", { x: 1 });
    await expectRequest(["manager", "status"], "/cli/status");
    await expectRequest(["manager", "install"], "/cli/install", { method: "POST", body: {} });
    await expectRequest(["manager", "update"], "/cli/update", { method: "POST", body: {} });
  });

  it("routes every workspace project, automation and reminder operation", async () => {
    await expectRequest(["workspace", "projects", "list"], "/workspace/projects");
    await expectRequest(["workspace", "projects", "show", "p1"], "/workspace/projects/p1");
    await expectRequest(
      ["workspace", "projects", "update", "p1", "--body", '{"name":"P","links":{"sessionIds":[]}}'],
      "/workspace/projects/p1",
      { method: "PUT", body: { name: "P", links: { sessionIds: [] } } }
    );
    await expectRequest(
      ["workspace", "projects", "reorder", "--ids", "p2,p1"],
      "/workspace/projects-order",
      { method: "PUT", body: { ids: ["p2", "p1"] } }
    );
    await expectRequest(["workspace", "projects", "delete", "p1"], "/workspace/projects/p1", {
      method: "DELETE",
    });
    await expectRequest(["workspace", "automations", "list"], "/workspace/automations");
    await expectRequest(["workspace", "automations", "show", "a1"], "/workspace/automations/a1");
    await expectRequest(
      ["workspace", "automations", "create", "--body", '{"name":"A"}'],
      "/workspace/automations",
      { method: "POST", body: { name: "A" } }
    );
    await expectRequest(
      ["workspace", "automations", "update", "a1", "--body", '{"name":"A2"}'],
      "/workspace/automations/a1",
      { method: "PUT", body: { name: "A2" } }
    );
    await expectRequest(
      ["workspace", "automations", "run", "a1"],
      "/workspace/automations/a1/run",
      { method: "POST", body: {} }
    );
    await expectRequest(["workspace", "automations", "delete", "a1"], "/workspace/automations/a1", {
      method: "DELETE",
    });
    await expectRequest(["workspace", "runs", "pending"], "/workspace/automation-runs/pending");
    await expectRequest(
      ["workspace", "runs", "acknowledge", "r1"],
      "/workspace/automation-runs/r1/acknowledge",
      { method: "POST", body: {} }
    );
  });

  it("routes data backup, export and import", async () => {
    await expectRequest(["data", "backup"], "/backup", { method: "POST", body: {} });
    const cwd = tempDir();
    fs.writeFileSync(path.join(cwd, "data.json"), '{"cards":[]}');
    await executeCommand(["data", "import", "data.json"], { client, cwd });
    expect(request).toHaveBeenLastCalledWith("/import", { method: "POST", body: { cards: [] } });
    request.mockResolvedValueOnce({ success: true, cards: [] });
    await executeCommand(["data", "export", "--output", "export.json"], { client, cwd });
    expect(JSON.parse(fs.readFileSync(path.join(cwd, "export.json"), "utf8"))).toEqual({
      success: true,
      cards: [],
    });
  });

  it("reports managed service semantics and rejects unknown commands", async () => {
    await expect(executeCommand(["serve"], { client })).resolves.toMatchObject({
      value: { managedBy: "Papyrus Desktop" },
    });
    await expect(executeCommand(["stop"], { client })).rejects.toThrow("不允许 CLI 停止后端");
    await expect(executeCommand(["unknown"], { client })).rejects.toThrow("未知命令");
  });
});
