import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import http from "node:http";
import { PapyrusClient } from "../src/api.js";
import { executeCommand } from "../src/cli.js";

describe("CLI to Desktop HTTP contract", () => {
  let server: http.Server;
  let apiUrl: string;
  const requests: Array<{ method?: string; url?: string; token?: string; body: unknown }> = [];

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        requests.push({
          method: request.method,
          url: request.url,
          token: request.headers["x-papyrus-token"] as string | undefined,
          body: text ? (JSON.parse(text) as unknown) : undefined,
        });
        response.writeHead(200, { "Content-Type": "application/json" });
        if (request.url === "/api/health") {
          response.end(JSON.stringify({ status: "ok" }));
        } else {
          response.end(JSON.stringify({ success: true, card: { id: "card-1" } }));
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not bind");
    apiUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("runs status and a write command with Desktop authentication", async () => {
    const client = new PapyrusClient({
      apiUrl,
      mcpUrl: "http://127.0.0.1:9200",
      authToken: "test-token",
      timeoutMs: 5000,
      dataDir: "data",
    });

    const status = await executeCommand(["status", "--json"], { client });
    expect(status.value).toMatchObject({ success: true, health: { status: "ok" } });

    await executeCommand(["cards", "add", "Question", "Answer"], { client });
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "GET", url: "/api/health", token: "test-token" }),
        expect.objectContaining({
          method: "POST",
          url: "/api/cards",
          token: "test-token",
          body: { q: "Question", a: "Answer", tags: [] },
        }),
      ])
    );
  });
});
