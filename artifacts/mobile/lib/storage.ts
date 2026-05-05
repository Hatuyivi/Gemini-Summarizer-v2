import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import type {
  AIAccount,
  ChatMessage,
  ConversationSummary,
  GeminiApiKey,
  ProviderSelectorOverrides,
  SummaryBlock,
} from "./types";

const KEYS = {
  ACCOUNTS: "mac_accounts_v1",
  ACTIVE_ACCOUNT: "mac_active_account_v1",
  MESSAGES: "mac_messages_v1",
  SUMMARY: "mac_summary_v1",
  SELECTORS: "mac_selectors_v1",
  CHAT_URLS: "mac_chat_urls_v1",
  GEMINI_KEYS_INDEX: "mac_gemini_keys_index_v1",
  ACTIVE_GEMINI_KEY: "mac_active_gemini_key_v1",
  SUMMARY_BLOCKS: "mac_summary_blocks_v1",
};

const COOKIE_PREFIX = "mac_ck_";
const GEMINI_KEY_PREFIX = "mac_gemini_key_";

/**
 * iOS SecureStore limit is ~2 048 bytes per value.
 * We chunk large cookie strings into 1 800-byte slices so even large
 * Google / Claude session payloads (5–20 KB) are stored reliably.
 *
 * Layout per account (accountId = "abc123"):
 *   mac_ck_abc123_n   → "3"          (chunk count)
 *   mac_ck_abc123_0   → first 1800 chars
 *   mac_ck_abc123_1   → next  1800 chars
 *   mac_ck_abc123_2   → remainder
 *
 * Legacy single-key format (mac_ck_abc123) is read as fallback so
 * old accounts still load until the user refreshes their session.
 */
const CHUNK_SIZE = 1800;

const isWeb = Platform.OS === "web";

async function secureSet(key: string, value: string): Promise<void> {
  if (isWeb) {
    await AsyncStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

async function secureGet(key: string): Promise<string | null> {
  if (isWeb) return AsyncStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

async function secureDelete(key: string): Promise<void> {
  if (isWeb) {
    await AsyncStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

function chunkCountKey(accountId: string): string {
  return `${COOKIE_PREFIX}${accountId}_n`;
}
function chunkKey(accountId: string, i: number): string {
  return `${COOKIE_PREFIX}${accountId}_${i}`;
}
function legacyKey(accountId: string): string {
  // Old format used a different prefix; kept for backward compat reads.
  return `mac_cookies_${accountId}`;
}

export const storage = {
  async loadAccounts(): Promise<AIAccount[]> {
    const raw = await AsyncStorage.getItem(KEYS.ACCOUNTS);
    if (!raw) return [];
    try { return JSON.parse(raw) as AIAccount[]; } catch { return []; }
  },

  async saveAccounts(accounts: AIAccount[]): Promise<void> {
    await AsyncStorage.setItem(KEYS.ACCOUNTS, JSON.stringify(accounts));
  },

  async loadActiveAccountId(): Promise<string | null> {
    return AsyncStorage.getItem(KEYS.ACTIVE_ACCOUNT);
  },

  async saveActiveAccountId(id: string | null): Promise<void> {
    if (id === null) await AsyncStorage.removeItem(KEYS.ACTIVE_ACCOUNT);
    else await AsyncStorage.setItem(KEYS.ACTIVE_ACCOUNT, id);
  },

  async loadMessages(): Promise<ChatMessage[]> {
    const raw = await AsyncStorage.getItem(KEYS.MESSAGES);
    if (!raw) return [];
    try { return JSON.parse(raw) as ChatMessage[]; } catch { return []; }
  },

  async saveMessages(messages: ChatMessage[]): Promise<void> {
    await AsyncStorage.setItem(KEYS.MESSAGES, JSON.stringify(messages));
  },

  async loadSummary(): Promise<ConversationSummary | null> {
    const raw = await AsyncStorage.getItem(KEYS.SUMMARY);
    if (!raw) return null;
    try { return JSON.parse(raw) as ConversationSummary; } catch { return null; }
  },

  async saveSummary(s: ConversationSummary | null): Promise<void> {
    if (!s) { await AsyncStorage.removeItem(KEYS.SUMMARY); return; }
    await AsyncStorage.setItem(KEYS.SUMMARY, JSON.stringify(s));
  },

  /**
   * Save cookies in chunks to bypass SecureStore's ~2 KB per-value limit.
   * Overwrites any previous chunk set for this account.
   */
  async saveCookies(accountId: string, cookies: string): Promise<void> {
    const chunks: string[] = [];
    for (let i = 0; i < cookies.length; i += CHUNK_SIZE) {
      chunks.push(cookies.slice(i, i + CHUNK_SIZE));
    }
    // Write count first so a partial write is detectable on read.
    await secureSet(chunkCountKey(accountId), String(chunks.length));
    for (let i = 0; i < chunks.length; i++) {
      await secureSet(chunkKey(accountId, i), chunks[i]);
    }
  },

  /**
   * Read chunked cookies. Falls back to legacy single-key format for
   * accounts added before this chunking was introduced.
   */
  async loadCookies(accountId: string): Promise<string | null> {
    // Try new chunked format.
    const nStr = await secureGet(chunkCountKey(accountId));
    if (nStr !== null) {
      const n = parseInt(nStr, 10);
      if (!Number.isFinite(n) || n < 1) return null;
      const parts: string[] = [];
      for (let i = 0; i < n; i++) {
        const chunk = await secureGet(chunkKey(accountId, i));
        if (chunk === null) return null; // incomplete write
        parts.push(chunk);
      }
      return parts.join("");
    }
    // Fallback: legacy single-key (old mac_cookies_ prefix).
    return secureGet(legacyKey(accountId));
  },

  async deleteCookies(accountId: string): Promise<void> {
    const nStr = await secureGet(chunkCountKey(accountId));
    if (nStr !== null) {
      const n = parseInt(nStr, 10);
      await secureDelete(chunkCountKey(accountId));
      for (let i = 0; i < n; i++) {
        await secureDelete(chunkKey(accountId, i));
      }
    } else {
      // Legacy key
      await secureDelete(legacyKey(accountId));
    }
  },

  async loadChatUrls(): Promise<Record<string, string>> {
    const raw = await AsyncStorage.getItem(KEYS.CHAT_URLS);
    if (!raw) return {};
    try { return JSON.parse(raw) as Record<string, string>; } catch { return {}; }
  },

  async saveChatUrls(map: Record<string, string>): Promise<void> {
    await AsyncStorage.setItem(KEYS.CHAT_URLS, JSON.stringify(map));
  },

  async loadSelectors(): Promise<ProviderSelectorOverrides> {
    const raw = await AsyncStorage.getItem(KEYS.SELECTORS);
    if (!raw) return {};
    try { return JSON.parse(raw) as ProviderSelectorOverrides; } catch { return {}; }
  },

  async saveSelectors(s: ProviderSelectorOverrides): Promise<void> {
    await AsyncStorage.setItem(KEYS.SELECTORS, JSON.stringify(s));
  },

  async loadGeminiKeys(): Promise<GeminiApiKey[]> {
    const raw = await AsyncStorage.getItem(KEYS.GEMINI_KEYS_INDEX);
    if (!raw) return [];
    let index: Array<Omit<GeminiApiKey, "key">>;
    try { index = JSON.parse(raw) as Array<Omit<GeminiApiKey, "key">>; }
    catch { return []; }
    const keys: GeminiApiKey[] = [];
    for (const meta of index) {
      const k = await secureGet(`${GEMINI_KEY_PREFIX}${meta.id}`);
      if (k) keys.push({ ...meta, key: k });
    }
    return keys;
  },

  async saveGeminiKey(input: { id: string; label: string; key: string; addedAt?: number }): Promise<void> {
    const addedAt = input.addedAt ?? Date.now();
    await secureSet(`${GEMINI_KEY_PREFIX}${input.id}`, input.key);
    const raw = await AsyncStorage.getItem(KEYS.GEMINI_KEYS_INDEX);
    let index: Array<Omit<GeminiApiKey, "key">> = [];
    if (raw) { try { index = JSON.parse(raw) as Array<Omit<GeminiApiKey, "key">>; } catch { index = []; } }
    const without = index.filter((k) => k.id !== input.id);
    without.push({ id: input.id, label: input.label, addedAt });
    await AsyncStorage.setItem(KEYS.GEMINI_KEYS_INDEX, JSON.stringify(without));
  },

  async deleteGeminiKey(id: string): Promise<void> {
    await secureDelete(`${GEMINI_KEY_PREFIX}${id}`);
    const raw = await AsyncStorage.getItem(KEYS.GEMINI_KEYS_INDEX);
    if (!raw) return;
    let index: Array<Omit<GeminiApiKey, "key">> = [];
    try { index = JSON.parse(raw) as Array<Omit<GeminiApiKey, "key">>; } catch { return; }
    await AsyncStorage.setItem(KEYS.GEMINI_KEYS_INDEX, JSON.stringify(index.filter((k) => k.id !== id)));
    const active = await AsyncStorage.getItem(KEYS.ACTIVE_GEMINI_KEY);
    if (active === id) await AsyncStorage.removeItem(KEYS.ACTIVE_GEMINI_KEY);
  },

  async touchGeminiKey(id: string): Promise<void> {
    const raw = await AsyncStorage.getItem(KEYS.GEMINI_KEYS_INDEX);
    if (!raw) return;
    let index: Array<Omit<GeminiApiKey, "key">> = [];
    try { index = JSON.parse(raw) as Array<Omit<GeminiApiKey, "key">>; } catch { return; }
    await AsyncStorage.setItem(KEYS.GEMINI_KEYS_INDEX, JSON.stringify(index.map((k) => k.id === id ? { ...k, lastUsedAt: Date.now() } : k)));
  },

  async loadActiveGeminiKeyId(): Promise<string | null> {
    return AsyncStorage.getItem(KEYS.ACTIVE_GEMINI_KEY);
  },

  async saveActiveGeminiKeyId(id: string | null): Promise<void> {
    if (id === null) await AsyncStorage.removeItem(KEYS.ACTIVE_GEMINI_KEY);
    else await AsyncStorage.setItem(KEYS.ACTIVE_GEMINI_KEY, id);
  },

  async loadSummaryBlocks(): Promise<SummaryBlock[]> {
    const raw = await AsyncStorage.getItem(KEYS.SUMMARY_BLOCKS);
    if (!raw) return [];
    try { return JSON.parse(raw) as SummaryBlock[]; } catch { return []; }
  },

  async saveSummaryBlocks(blocks: SummaryBlock[]): Promise<void> {
    await AsyncStorage.setItem(KEYS.SUMMARY_BLOCKS, JSON.stringify(blocks));
  },

  async clearAll(): Promise<void> {
    const accounts = await storage.loadAccounts();
    const keys = await storage.loadGeminiKeys();
    await Promise.all(accounts.map((a) => storage.deleteCookies(a.id)));
    await Promise.all(keys.map((k) => secureDelete(`${GEMINI_KEY_PREFIX}${k.id}`)));
    await AsyncStorage.multiRemove([
      KEYS.ACCOUNTS, KEYS.SELECTORS, KEYS.ACTIVE_ACCOUNT,
      KEYS.MESSAGES, KEYS.SUMMARY, KEYS.CHAT_URLS,
      KEYS.GEMINI_KEYS_INDEX, KEYS.ACTIVE_GEMINI_KEY, KEYS.SUMMARY_BLOCKS,
    ]);
  },
};

export function newId(): string {
  const part = () => Math.random().toString(36).slice(2, 11);
  return `${Date.now().toString(36)}_${part()}_${part()}`;
}
