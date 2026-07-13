import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { PapyrusClient } from "../src/api.js";
import { executeCommand, formatOutput } from "../src/cli.js";
import type { CLIConfig } from "../src/types.js";

const testConfig: CLIConfig = {
  apiUrl: "http://127.0.0.1:8000/api",
  mcpUrl: "http://127.0.0.1:9200",
  timeoutMs: 5000,
  dataDir: "data",
};

describe("CLI command contracts", () => {
  let client: PapyrusClient;
  let request: ReturnType<typeof jest.spyOn>;
  let callMcpTool: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    client = new PapyrusClient(testConfig);
    request = jest.spyOn(client, "request").mockResolvedValue({ success: true });
    callMcpTool = jest.spyOn(client, "callMcpTool").mockResolvedValue({ success: true });
  });

  it("exposes the complete Desktop command families", async () => {
    const result = await executeCommand(["help"], { client });
    expect(result.value).toMatchObject({
      name: "@papyrus/cli",
      commands: expect.arrayContaining([
        "cards",
        "notes",
        "files",
        "relations",
        "extensions",
        "providers",
        "sessions",
        "mcp",
        "workspace",
      ]),
    });
  });

  it("supports conventional help and version flags", async () => {
    await expect(executeCommand(["--help"], { client })).resolves.toMatchObject({
      value: { name: "@papyrus/cli" },
    });
    await expect(executeCommand(["--version"], { client })).resolves.toEqual({
      value: { version: "2.0.0-beta.12" },
      json: false,
    });
  });

  it("maps card creation to the Desktop card schema", async () => {
    await executeCommand(["cards", "add", "Question", "Answer", "--tags", "one,two"], {
      client,
    });

    expect(request).toHaveBeenCalledWith("/cards", {
      method: "POST",
      body: { q: "Question", a: "Answer", tags: ["one", "two"] },
    });
  });

  it("maps review grades and MCP statistics", async () => {
    await executeCommand(["review", "rate", "card-1", "--grade", "3"], { client });
    expect(request).toHaveBeenCalledWith("/review/card-1/rate", {
      method: "POST",
      body: { grade: 3 },
    });

    await executeCommand(["review", "stats"], { client });
    expect(callMcpTool).toHaveBeenCalledWith("get_review_stats", {});
  });

  it("supports notes, providers and workspace JSON contracts", async () => {
    await executeCommand(["notes", "add", "Title", "--folder", "Inbox", "--content", "Body"], {
      client,
    });
    expect(request).toHaveBeenLastCalledWith("/notes", {
      method: "POST",
      body: { title: "Title", folder: "Inbox", content: "Body", tags: [] },
    });

    await executeCommand(
      ["providers", "add", "--body", '{"name":"Local","baseUrl":"http://127.0.0.1:11434"}'],
      { client }
    );
    expect(request).toHaveBeenLastCalledWith("/providers", {
      method: "POST",
      body: { name: "Local", baseUrl: "http://127.0.0.1:11434" },
    });

    await executeCommand(
      ["workspace", "projects", "create", "--body", '{"name":"Study","links":{"sessionIds":[]}}'],
      { client }
    );
    expect(request).toHaveBeenLastCalledWith("/workspace/projects", {
      method: "POST",
      body: { name: "Study", links: { sessionIds: [] } },
    });
  });

  it("requires explicit force for destructive aggregate operations", async () => {
    await expect(executeCommand(["data", "reset"], { client })).rejects.toThrow("需要 --force");
    await executeCommand(["data", "reset", "--force"], { client });
    expect(request).toHaveBeenLastCalledWith("/data/reset", {
      method: "POST",
      body: {},
    });

    await expect(executeCommand(["sessions", "clear"], { client })).rejects.toThrow("需要 --force");
  });

  it("supports future Desktop endpoints through the generic request command", async () => {
    await executeCommand(
      ["request", "POST", "/future/route", "--body", '{"enabled":true}', "--json"],
      { client }
    );

    expect(request).toHaveBeenCalledWith("/future/route", {
      method: "POST",
      body: { enabled: true },
    });
    expect(formatOutput({ success: true }, true)).toBe('{"success":true}\n');
  });

  it("rejects invalid review grades before making an API request", async () => {
    await expect(
      executeCommand(["review", "rate", "card-1", "--grade", "5"], { client })
    ).rejects.toThrow("grade 必须是 1、2 或 3");
    expect(request).not.toHaveBeenCalled();
  });
});
