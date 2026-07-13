export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = Record<string, unknown>;

export interface Card {
  id: string;
  q: string;
  a: string;
  next_review: number;
  interval: number;
  ef: number;
  repetitions: number;
  tags: string[];
}

export interface Note {
  id: string;
  title: string;
  folder: string;
  content: string;
  preview: string;
  tags: string[];
  created_at: number;
  updated_at: number;
  word_count: number;
  hash: string;
  headings: Array<{ level: number; text: string }>;
  outgoing_links: string[];
  incoming_count: number;
}

export interface FileRecord {
  id: string;
  name: string;
  type: string;
  size: number;
  mime_type: string;
  parent_id: string | null;
  file_storage_path: string | null;
  is_folder: number;
  created_at: number;
  updated_at: number;
}

export interface CreateCardInput {
  q: string;
  a: string;
  tags?: string[];
}

export interface UpdateCardInput {
  q?: string;
  a?: string;
  tags?: string[];
}

export interface CardsListResponse {
  success: boolean;
  cards: Card[];
  count: number;
}

export interface CardResponse {
  success: boolean;
  card: Card;
}

export interface DeleteResponse {
  success: boolean;
}

export interface ImportResponse {
  success: boolean;
  count: number;
}

export interface HealthResponse {
  status: string;
}

export interface ReviewStats {
  total_cards: number;
  due_today: number;
  new_cards: number;
  review_cards: number;
}

export interface ReviewStatsResponse {
  success: boolean;
  stats: ReviewStats;
}

export interface ReviewSubmission {
  quality: number;
}

export interface ReviewSubmitResponse {
  success: boolean;
  message: string;
}

export interface ReviewQueueItem {
  card: Card;
  index: number;
}

export interface SearchResult {
  card: Card;
  score: number;
}

export interface SearchResponse {
  success: boolean;
  results: SearchResult[];
  count: number;
}

export interface BackupInfo {
  path: string;
  size: number;
  created: Date;
}

export interface APIError {
  error?: string;
  detail?: string;
  message?: string;
  errorId?: string;
}

export interface CLIConfig {
  apiUrl: string;
  mcpUrl: string;
  authToken?: string;
  timeoutMs: number;
  dataDir: string;
  defaultEditor?: string;
}

export interface RuntimeOverrides {
  apiUrl?: string;
  mcpUrl?: string;
  authToken?: string;
  timeoutMs?: number;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface RawResponse {
  status: number;
  contentType: string;
  body: Uint8Array;
}

export interface CliExecutionResult {
  value: unknown;
  json: boolean;
}
