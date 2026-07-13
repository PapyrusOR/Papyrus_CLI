import { describe, expect, it, jest } from "@jest/globals";
import { normalizeApiBase, PapyrusApiError, PapyrusClient } from "../src/api.js";
import type { CLIConfig } from "../src/types.js";

function config(overrides: Partial<CLIConfig> = {}): CLIConfig {
  return {
    apiUrl: "http://127.0.0.1:8000",
    mcpUrl: "http://127.0.0.1:9200/",
    authToken: "token-123",
    timeoutMs: 5000,
    dataDir: "data",
    ...overrides,
  };
}

describe("PapyrusClient", () => {
  it("normalizes Desktop API roots", () => {
    expect(normalizeApiBase("http://127.0.0.1:8000/")).toBe("http://127.0.0.1:8000/api");
    expect(normalizeApiBase("http://127.0.0.1:8000/api/")).toBe("http://127.0.0.1:8000/api");
  });

  it("sends Desktop auth and JSON bodies", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const client = new PapyrusClient(config(), fetchMock);

    await client.request("/cards", {
      method: "POST",
      body: { q: "Q", a: "A" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://127.0.0.1:8000/api/cards");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Papyrus-Token": "token-123",
    });
    expect(init?.body).toBe(JSON.stringify({ q: "Q", a: "A" }));
  });

  it("preserves status, request ID and sanitized server error", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: "Unauthorized", errorId: "abc123" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    );
    const client = new PapyrusClient(config(), fetchMock);

    await expect(client.request("/cards")).rejects.toMatchObject({
      name: "PapyrusApiError",
      message: "Unauthorized",
      status: 401,
      errorId: "abc123",
    } satisfies Partial<PapyrusApiError>);
  });

  it("supports raw file responses", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      new Response(Uint8Array.from([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
      })
    );
    const client = new PapyrusClient(config(), fetchMock);

    const response = await client.requestRaw("/files/file-1/download");

    expect(response.status).toBe(200);
    expect(response.contentType).toBe("application/octet-stream");
    expect([...response.body]).toEqual([1, 2, 3]);
  });
});
