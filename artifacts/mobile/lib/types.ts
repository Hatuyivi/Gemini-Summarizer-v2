import type { ProviderId } from "./providers";

export type AccountStatus = "active" | "limit" | "expired" | "disabled";

export interface AIAccount {
  id: string;
  providerId: ProviderId;
  email: string;
  displayName: string;
  status: AccountStatus;
  createdAt: number;
  lastActiveAt: number;
  messagesUsedToday: number;
  estimatedDailyLimit: number;
  lastResetDate: string;
  /**
   * Unix-ms moment when the per-account usage limit is expected to clear.
   * Set when the WebView reports `automation:limit` (parsed from the page)
   * or when the app proactively soft-rotates because the local counter
   * already met `estimatedDailyLimit`. When `Date.now() >= limitResetAt`
   * the AppProvider tick effect clears the limit and resets the daily
   * counter so the account becomes a candidate again.
   */
  limitResetAt?: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "summary" | "system";
  content: string;
  createdAt: number;
  providerId?: ProviderId;
  accountId?: string;
  status?: "sending" | "sent" | "error";
  errorMessage?: string;
  imageUri?: string;
}

export interface ConversationSummary {
  summary: string;
  important_data: string[];
  tone: string;
}

/**
 * A historical, viewable record of a single compression event.
 * Created every time `compressIfNeeded` (manual or automatic) successfully
 * compacts older messages into a memory block. Stored separately from the
 * "live" rolling `summary` so the user can scroll back through past summaries.
 */
export interface SummaryBlock {
  id: string;
  createdAt: number;
  /** How many older messages were folded into this block. */
  compactedCount: number;
  /** How many messages remained verbatim in chat at the time of compression. */
  remainingCount: number;
  /** The summary returned by the API for this compression. */
  summary: string;
  important_data: string[];
  tone: string;
  /** Which Gemini key (or "replit") produced this summary, for transparency. */
  source: "user-key" | "replit";
}

/**
 * A user-supplied Gemini API key. Multiple keys can be stored. The currently
 * selected key (`activeGeminiKeyId` in storage) is the one sent on the
 * `x-user-gemini-key` header to `/api/summarize`. When no keys are configured,
 * the server falls back to Replit's built-in Gemini integration.
 */
export interface GeminiApiKey {
  id: string;
  label: string;
  /** Full key value. Stored in SecureStore on native, AsyncStorage on web. */
  key: string;
  addedAt: number;
  /** Last time this key was used to make a summarize call. */
  lastUsedAt?: number;
}

export interface CustomSelectors {
  inputSelector?: string;
  sendButtonSelector?: string;
  responseSelector?: string;
}

export type ProviderSelectorOverrides = Record<string, CustomSelectors>;
