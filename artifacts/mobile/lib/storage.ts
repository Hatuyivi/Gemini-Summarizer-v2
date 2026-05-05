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

// ---------------------------------------------------------------------------
// Storage key registry
// ---------------------------------------------------------------------------

const KEYS = {
  ACCOUNTS: "mac_accounts_v1",
  ACTIVE_ACCOUNT: "mac_active_account_v1",
  MESSAGES: "mac_messages_v1",
  SUMMARY: "mac_summary_v1",
  SELECTORS: "mac_selectors_v1",
  CHAT_URLS: "mac_chat_urls_v1",
  /** Index of Gemini key metadata — no key material stored here. */
  GEMINI_KEYS_INDEX: "mac_gemini_keys_index_v1",
  /** ID of the currently-selected Gemini key. */
  ACTIVE_GEMINI_KEY: "mac_active_gemini_key_v1",
  /** History of viewable summary blocks. */
  SUMMARY_BLOCKS: "mac_summary_blocks_v1",
} as const;

const PREFIX_COOKIES = "mac_cookies_";
const PREFIX_GEMINI_KEY = "mac_gemini_key_";

// ---------------------------------------------------------------------------
// Secure storage primitives
//
// On native: SecureStore (Keychain / Keystore) with WHEN_UNLOCKED_THIS_DEVICE_ONLY.
// On web: AsyncStorage (no native keychain available).
// ---------------------------------------------------------------------------

const isWeb = Platform.OS === "web";

const secure = {
  async set(key: string, value: string): Promise<void> {
    if (isWeb) {
      await AsyncStorage.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },

  async get(key: string): Promise<string | null> {
    if (isWeb) return AsyncStorage.getItem(key);
    return SecureStore.getItemAsync(key);
  },

  async delete(key: string): Promise<void> {
    if (isWeb) {
      await AsyncStorage.removeItem(key);
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

async function readJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJSON(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

// ---------------------------------------------------------------------------
// Session (cookie) persistence
//
// Cookies are the only true credential in this app — they are stored
// in SecureStore (Keychain) keyed by account ID so they never appear
// in AsyncStorage or plain-text backups.
// ---------------------------------------------------------------------------

export const sessionStorage = {
  async save(accountId: string, cookies: string): Promise<void> {
    await secure.set(`${PREFIX_COOKIES}${accountId}`, cookies);
  },

  async load(accountId: string): Promise<string | null> {
    return secure.get(`${PREFIX_COOKIES}${accountId}`);
  },

  async remove(accountId: string): Promise<void> {
    await secure.delete(`${PREFIX_COOKIES}${accountId}`);
  },
};

// ---------------------------------------------------------------------------
// Main storage API
// ---------------------------------------------------------------------------

export const storage = {
  // ---- Accounts ------------------------------------------------------------

  async loadAccounts(): Promise<AIAccount[]> {
    return readJSON<AIAccount[]>(KEYS.ACCOUNTS, []);
  },

  async saveAccounts(accounts: AIAccount[]): Promise<void> {
    await writeJSON(KEYS.ACCOUNTS, accounts);
  },

  async loadActiveAccountId(): Promise<string | null> {
    return AsyncStorage.getItem(KEYS.ACTIVE_ACCOUNT);
  },

  async saveActiveAccountId(id: string | null): Promise<void> {
    if (id === null) {
      await AsyncStorage.removeItem(KEYS.ACTIVE_ACCOUNT);
    } else {
      await AsyncStorage.setItem(KEYS.ACTIVE_ACCOUNT, id);
    }
  },

  // ---- Session cookies (delegates to sessionStorage) -----------------------

  saveCookies: sessionStorage.save,
  loadCookies: sessionStorage.load,
  deleteCookies: sessionStorage.remove,

  // ---- Messages ------------------------------------------------------------

  async loadMessages(): Promise<ChatMessage[]> {
    return readJSON<ChatMessage[]>(KEYS.MESSAGES, []);
  },

  async saveMessages(messages: ChatMessage[]): Promise<void> {
    await writeJSON(KEYS.MESSAGES, messages);
  },

  // ---- Conversation summary ------------------------------------------------

  async loadSummary(): Promise<ConversationSummary | null> {
    return readJSON<ConversationSummary | null>(KEYS.SUMMARY, null);
  },

  async saveSummary(s: ConversationSummary | null): Promise<void> {
    if (!s) {
      await AsyncStorage.removeItem(KEYS.SUMMARY);
      return;
    }
    await writeJSON(KEYS.SUMMARY, s);
  },

  // ---- Chat URLs (last visited URL per account) ----------------------------

  async loadChatUrls(): Promise<Record<string, string>> {
    return readJSON<Record<string, string>>(KEYS.CHAT_URLS, {});
  },

  async saveChatUrls(map: Record<string, string>): Promise<void> {
    await writeJSON(KEYS.CHAT_URLS, map);
  },

  // ---- Provider selector overrides -----------------------------------------

  async loadSelectors(): Promise<ProviderSelectorOverrides> {
    return readJSON<ProviderSelectorOverrides>(KEYS.SELECTORS, {});
  },

  async saveSelectors(s: ProviderSelectorOverrides): Promise<void> {
    await writeJSON(KEYS.SELECTORS, s);
  },

  // ---- Gemini API keys -------------------------------------------------------
  //
  // Key metadata (id, label, addedAt, lastUsedAt) is stored in AsyncStorage as
  // a plain JSON index. The actual secret key material lives in SecureStore.
  // ---------------------------------------------------------------------------

  async loadGeminiKeys(): Promise<GeminiApiKey[]> {
    const index = await readJSON<Array<Omit<GeminiApiKey, "key">>>(
      KEYS.GEMINI_KEYS_INDEX,
      [],
    );
    const results: GeminiApiKey[] = [];
    for (const meta of index) {
      const key = await secure.get(`${PREFIX_GEMINI_KEY}${meta.id}`);
      if (key) results.push({ ...meta, key });
    }
    return results;
  },

  async saveGeminiKey(input: {
    id: string;
    label: string;
    key: string;
    addedAt?: number;
  }): Promise<void> {
    const addedAt = input.addedAt ?? Date.now();
    // Persist key material securely.
    await secure.set(`${PREFIX_GEMINI_KEY}${input.id}`, input.key);
    // Update metadata index — replace entry if it already exists.
    const index = await readJSON<Array<Omit<GeminiApiKey, "key">>>(
      KEYS.GEMINI_KEYS_INDEX,
      [],
    );
    const withoutCurrent = index.filter((k) => k.id !== input.id);
    withoutCurrent.push({ id: input.id, label: input.label, addedAt });
    await writeJSON(KEYS.GEMINI_KEYS_INDEX, withoutCurrent);
  },

  async deleteGeminiKey(id: string): Promise<void> {
    await secure.delete(`${PREFIX_GEMINI_KEY}${id}`);
    const index = await readJSON<Array<Omit<GeminiApiKey, "key">>>(
      KEYS.GEMINI_KEYS_INDEX,
      [],
    );
    await writeJSON(
      KEYS.GEMINI_KEYS_INDEX,
      index.filter((k) => k.id !== id),
    );
    // Clear the active-key pointer if it was pointing at this key.
    const active = await AsyncStorage.getItem(KEYS.ACTIVE_GEMINI_KEY);
    if (active === id) {
      await AsyncStorage.removeItem(KEYS.ACTIVE_GEMINI_KEY);
    }
  },

  async touchGeminiKey(id: string): Promise<void> {
    const index = await readJSON<Array<Omit<GeminiApiKey, "key">>>(
      KEYS.GEMINI_KEYS_INDEX,
      [],
    );
    await writeJSON(
      KEYS.GEMINI_KEYS_INDEX,
      index.map((k) => (k.id === id ? { ...k, lastUsedAt: Date.now() } : k)),
    );
  },

  async loadActiveGeminiKeyId(): Promise<string | null> {
    return AsyncStorage.getItem(KEYS.ACTIVE_GEMINI_KEY);
  },

  async saveActiveGeminiKeyId(id: string | null): Promise<void> {
    if (id === null) {
      await AsyncStorage.removeItem(KEYS.ACTIVE_GEMINI_KEY);
    } else {
      await AsyncStorage.setItem(KEYS.ACTIVE_GEMINI_KEY, id);
    }
  },

  // ---- Summary blocks (compression history) --------------------------------

  async loadSummaryBlocks(): Promise<SummaryBlock[]> {
    return readJSON<SummaryBlock[]>(KEYS.SUMMARY_BLOCKS, []);
  },

  async saveSummaryBlocks(blocks: SummaryBlock[]): Promise<void> {
    await writeJSON(KEYS.SUMMARY_BLOCKS, blocks);
  },

  // ---- Nuclear reset -------------------------------------------------------

  async clearAll(): Promise<void> {
    const [accounts, keys] = await Promise.all([
      storage.loadAccounts(),
      storage.loadGeminiKeys(),
    ]);

    await Promise.all([
      ...accounts.map((a) => secure.delete(`${PREFIX_COOKIES}${a.id}`)),
      ...keys.map((k) => secure.delete(`${PREFIX_GEMINI_KEY}${k.id}`)),
    ]);

    await AsyncStorage.multiRemove([
      KEYS.ACCOUNTS,
      KEYS.ACTIVE_ACCOUNT,
      KEYS.MESSAGES,
      KEYS.SUMMARY,
      KEYS.SELECTORS,
      KEYS.CHAT_URLS,
      KEYS.GEMINI_KEYS_INDEX,
      KEYS.ACTIVE_GEMINI_KEY,
      KEYS.SUMMARY_BLOCKS,
    ]);
  },
};

// ---------------------------------------------------------------------------
// ID generator
// ---------------------------------------------------------------------------

export function newId(): string {
  const rand = () => Math.random().toString(36).slice(2, 11);
  return `${Date.now().toString(36)}_${rand()}_${rand()}`;
}
