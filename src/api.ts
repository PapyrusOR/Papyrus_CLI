import { loadConfig } from "./config.js";
import type {
  APIError,
  Card,
  CardResponse,
  CardsListResponse,
  CLIConfig,
  CreateCardInput,
  HealthResponse,
  ImportResponse,
  RawResponse,
  RequestOptions,
  ReviewStatsResponse,
  SearchResponse,
  UpdateCardInput,
} from "./types.js";

export function normalizeApiBase(rawBase: string): string {
  const trimmed = rawBase.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

function normalizeRelativePath(path: string): string {
  const prefixed = path.startsWith("/") ? path : `/${path}`;
  return prefixed.startsWith("/api/") ? prefixed.slice(4) : prefixed;
}

function errorMessage(payload: unknown, status: number): { message: string; errorId?: string } {
  if (typeof payload === "object" && payload !== null) {
    const error = payload as APIError;
    return {
      message: error.error ?? error.detail ?? error.message ?? `HTTP ${status}`,
      errorId: error.errorId,
    };
  }
  return { message: typeof payload === "string" && payload ? payload : `HTTP ${status}` };
}

export class PapyrusApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorId?: string,
    readonly payload?: unknown
  ) {
    super(message);
    this.name = "PapyrusApiError";
  }
}

export class PapyrusClient {
  readonly apiBase: string;
  readonly mcpBase: string;
  private readonly authToken?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: CLIConfig, fetchImpl: typeof fetch = fetch) {
    this.apiBase = normalizeApiBase(config.apiUrl);
    this.mcpBase = config.mcpUrl.replace(/\/+$/, "");
    this.authToken = config.authToken;
    this.timeoutMs = config.timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  private headers(options: RequestOptions): Record<string, string> {
    const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
    if (this.authToken) {
      headers["X-Papyrus-Token"] = this.authToken;
    }
    if (options.body !== undefined && headers["Content-Type"] === undefined) {
      headers["Content-Type"] = "application/json";
    }
    return headers;
  }

  private async fetchResponse(path: string, options: RequestOptions = {}): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const externalAbort = (): void => controller.abort();
    options.signal?.addEventListener("abort", externalAbort, { once: true });
    try {
      return await this.fetchImpl(`${this.apiBase}${normalizeRelativePath(path)}`, {
        method: options.method ?? "GET",
        headers: this.headers(options),
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Papyrus API 请求超时或已取消（${this.timeoutMs}ms）`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`无法连接 Papyrus Desktop API ${this.apiBase}: ${message}`);
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", externalAbort);
    }
  }

  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.fetchResponse(path, options);
    const text = await response.text();
    let payload: unknown = {};
    if (text) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = text;
      }
    }
    if (!response.ok) {
      const details = errorMessage(payload, response.status);
      throw new PapyrusApiError(details.message, response.status, details.errorId, payload);
    }
    return payload as T;
  }

  async requestRaw(path: string, options: RequestOptions = {}): Promise<RawResponse> {
    const response = await this.fetchResponse(path, {
      ...options,
      headers: { Accept: "*/*", ...options.headers },
    });
    const body = new Uint8Array(await response.arrayBuffer());
    if (!response.ok) {
      const text = new TextDecoder().decode(body);
      let payload: unknown = text;
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        // Keep the response text when it is not JSON.
      }
      const details = errorMessage(payload, response.status);
      throw new PapyrusApiError(details.message, response.status, details.errorId, payload);
    }
    return {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      body,
    };
  }

  async callMcpTool(tool: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return await this.request("/mcp/call", {
      method: "POST",
      body: { tool, params },
    });
  }
}

export function createPapyrusClient(config = loadConfig()): PapyrusClient {
  return new PapyrusClient(config);
}

export async function healthCheck(): Promise<HealthResponse> {
  return await createPapyrusClient().request<HealthResponse>("/health");
}

export async function isApiAvailable(): Promise<boolean> {
  try {
    await healthCheck();
    return true;
  } catch {
    return false;
  }
}

export async function listCards(): Promise<Card[]> {
  return (await createPapyrusClient().request<CardsListResponse>("/cards")).cards;
}

export async function getCard(id: string): Promise<Card> {
  return (await createPapyrusClient().request<CardResponse>(`/cards/${encodeURIComponent(id)}`))
    .card;
}

export async function createCard(input: CreateCardInput): Promise<Card> {
  return (
    await createPapyrusClient().request<CardResponse>("/cards", { method: "POST", body: input })
  ).card;
}

export async function updateCard(id: string, input: UpdateCardInput): Promise<Card> {
  return (
    await createPapyrusClient().request<CardResponse>(`/cards/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: input,
    })
  ).card;
}

export async function deleteCard(id: string): Promise<void> {
  await createPapyrusClient().request(`/cards/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function importCards(content: string): Promise<number> {
  return (
    await createPapyrusClient().request<ImportResponse>("/cards/import/txt", {
      method: "POST",
      body: { content },
    })
  ).count;
}

export async function getNextDue(): Promise<{
  card: Card | null;
  dueCount: number;
  totalCount: number;
}> {
  const response = await createPapyrusClient().request<{
    card: Card | null;
    due_count: number;
    total_count: number;
  }>("/review/next");
  return { card: response.card, dueCount: response.due_count, totalCount: response.total_count };
}

export async function getReviewQueue(): Promise<Card[]> {
  const cards = await listCards();
  const now = Date.now() / 1000;
  return cards.filter((card) => card.next_review <= now);
}

export async function getReviewStats(): Promise<ReviewStatsResponse> {
  return (await createPapyrusClient().callMcpTool("get_review_stats")) as ReviewStatsResponse;
}

export async function submitReview(cardId: string, grade: number): Promise<void> {
  await createPapyrusClient().request(`/review/${encodeURIComponent(cardId)}/rate`, {
    method: "POST",
    body: { grade },
  });
}

export async function searchCards(query: string): Promise<SearchResponse> {
  const response = await createPapyrusClient().request<{
    results: Array<{ id: string; type: string; title: string; preview: string; tags: string[] }>;
  }>(`/search?query=${encodeURIComponent(query)}`);
  const results = response.results
    .filter((result) => result.type === "card")
    .map((result) => ({
      card: {
        id: result.id,
        q: result.title,
        a: result.preview,
        next_review: 0,
        interval: 0,
        ef: 2.5,
        repetitions: 0,
        tags: result.tags,
      },
      score: 1,
    }));
  return { success: true, results, count: results.length };
}

export async function exportData(): Promise<unknown> {
  return await createPapyrusClient().request("/export");
}

export async function importData(data: unknown): Promise<void> {
  await createPapyrusClient().request("/import", { method: "POST", body: data });
}

export async function createBackup(): Promise<{ path: string }> {
  return await createPapyrusClient().request<{ path: string }>("/backup", {
    method: "POST",
    body: {},
  });
}
