import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { storage, newId } from "@/lib/storage";
import {
  PROVIDERS,
  resolveProvider,
  type AIProvider,
  type ProviderId,
} from "@/lib/providers";
import type {
  AIAccount,
  ChatMessage,
  ConversationSummary,
  CustomSelectors,
  GeminiApiKey,
  ProviderSelectorOverrides,
  SummaryBlock,
} from "@/lib/types";
import { summarizeMessages, type SummarizeResult } from "@/lib/gemini";

const COMPRESSION_THRESHOLD = 24;
const COMPRESSION_KEEP_RECENT = 8;
const HANDOFF_RECENT_TURNS = 12;
const HANDOFF_MAX_CHARS = 6000;

function buildHandoffSeed(
  msgs: ChatMessage[],
  prevSummary: ConversationSummary | null,
): string {
  const turns = msgs
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-HANDOFF_RECENT_TURNS);
  const transcript = turns
    .map(
      (m) =>
        `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`,
    )
    .join("\n\n");
  const prefix = prevSummary?.summary
    ? `Earlier conversation summary:\n${prevSummary.summary}\n\nRecent messages:\n`
    : "Recent conversation:\n";
  const seed = prefix + transcript;
  return seed.length > HANDOFF_MAX_CHARS
    ? seed.slice(seed.length - HANDOFF_MAX_CHARS)
    : seed;
}

export type CompressResult =
  | { status: "compressed"; compactedCount: number; remainingCount: number }
  | { status: "not-needed"; messageCount: number; threshold: number }
  | { status: "no-old" }
  | { status: "failed"; error: string };

interface AppContextValue {
  ready: boolean;
  accounts: AIAccount[];
  activeAccount: AIAccount | null;
  messages: ChatMessage[];
  summary: ConversationSummary | null;
  /** History of all compressions, newest first. */
  summaryBlocks: SummaryBlock[];
  /** All saved Gemini keys; the one selected for use is `activeGeminiKey`. */
  geminiKeys: GeminiApiKey[];
  activeGeminiKey: GeminiApiKey | null;
  isAssistantTyping: boolean;
  selectors: ProviderSelectorOverrides;
  setActiveAccount: (id: string | null) => Promise<void>;
  addAccount: (input: {
    providerId: ProviderId;
    email: string;
    cookies: string;
    displayName?: string;
  }) => Promise<AIAccount>;
  removeAccount: (id: string) => Promise<void>;
  markAccountStatus: (
    id: string,
    status: AIAccount["status"],
    resetAtMs?: number | null,
  ) => Promise<void>;
  bumpAccountUsage: (id: string) => Promise<void>;
  appendMessage: (m: Omit<ChatMessage, "id" | "createdAt">) => ChatMessage;
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  setAssistantTyping: (v: boolean) => void;
  clearChat: () => Promise<void>;
  rotateToNextAvailable: () => Promise<AIAccount | null>;
  compressIfNeeded: () => Promise<CompressResult>;
  chatUrls: Record<string, string>;
  setChatUrl: (accountId: string, url: string) => void;
  clearChatUrl: (accountId: string) => void;
  pendingContextSeed: { accountId: string; text: string } | null;
  consumePendingContextSeed: (accountId: string) => string | null;
  setCustomSelector: (
    providerId: ProviderId,
    patch: CustomSelectors,
  ) => Promise<void>;
  clearCustomSelectors: (providerId: ProviderId) => Promise<void>;
  getResolvedProvider: (providerId: ProviderId) => AIProvider;
  // Gemini key management ------------------------------------------------
  addGeminiKey: (input: { label: string; key: string }) => Promise<GeminiApiKey>;
  removeGeminiKey: (id: string) => Promise<void>;
  setActiveGeminiKey: (id: string | null) => Promise<void>;
  // Summary blocks history ----------------------------------------------
  clearSummaryBlocks: () => Promise<void>;
}

const Ctx = createContext<AppContextValue | null>(null);

function isSameDay(ts: number): boolean {
  const d = new Date(ts);
  const now = new Date();
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  );
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [accounts, setAccounts] = useState<AIAccount[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [summary, setSummary] = useState<ConversationSummary | null>(null);
  const [isAssistantTyping, setAssistantTyping] = useState(false);
  const [selectors, setSelectors] = useState<ProviderSelectorOverrides>({});
  const [chatUrls, setChatUrls] = useState<Record<string, string>>({});
  const [pendingContextSeed, setPendingContextSeed] = useState<
    { accountId: string; text: string } | null
  >(null);
  const pendingContextSeedRef = useRef<{
    accountId: string;
    text: string;
  } | null>(null);
  const [geminiKeys, setGeminiKeys] = useState<GeminiApiKey[]>([]);
  const [activeGeminiKeyId, setActiveGeminiKeyId] = useState<string | null>(
    null,
  );
  const [summaryBlocks, setSummaryBlocks] = useState<SummaryBlock[]>([]);

  /** Always in sync before paint — avoids stale closures in context callbacks. */
  const accountsRef = useRef<AIAccount[]>([]);
  const activeIdRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    accountsRef.current = accounts;
    activeIdRef.current = activeId;
  }, [accounts, activeId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [a, id, m, s, sel, urls, keys, activeKeyId, blocks] =
        await Promise.all([
          storage.loadAccounts(),
          storage.loadActiveAccountId(),
          storage.loadMessages(),
          storage.loadSummary(),
          storage.loadSelectors(),
          storage.loadChatUrls(),
          storage.loadGeminiKeys(),
          storage.loadActiveGeminiKeyId(),
          storage.loadSummaryBlocks(),
        ]);
      if (cancelled) return;

      setSelectors(sel);
      setChatUrls(urls);
      setGeminiKeys(keys);
      // If the previously-active key was deleted out-of-band, fall back to
      // the first available key (or null) so the UI never points at a ghost.
      const validActive =
        activeKeyId && keys.some((k) => k.id === activeKeyId)
          ? activeKeyId
          : keys[0]?.id ?? null;
      setActiveGeminiKeyId(validActive);
      setSummaryBlocks(blocks);
      // reset daily counts
      const refreshed = a.map((acc) =>
        acc.lastResetDate === todayKey()
          ? acc
          : { ...acc, messagesUsedToday: 0, lastResetDate: todayKey(), status: acc.status === "limit" ? "active" : acc.status },
      );
      const validIds = new Set(refreshed.map((acc) => acc.id));
      let resolvedActive = id;
      if (resolvedActive && !validIds.has(resolvedActive)) {
        resolvedActive = null;
      }
      if (!resolvedActive) {
        resolvedActive = refreshed[0]?.id ?? null;
      }

      setAccounts(refreshed);
      setActiveId((current) => {
        if (current && validIds.has(current)) {
          activeIdRef.current = current;
          return current;
        }
        activeIdRef.current = resolvedActive;
        return resolvedActive;
      });
      setMessages(m);
      setSummary(s);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (ready) void storage.saveAccounts(accounts);
  }, [accounts, ready]);

  useEffect(() => {
    if (ready) void storage.saveActiveAccountId(activeId);
  }, [activeId, ready]);

  useEffect(() => {
    if (ready) void storage.saveMessages(messages);
  }, [messages, ready]);

  useEffect(() => {
    if (ready) void storage.saveSummary(summary);
  }, [summary, ready]);

  useEffect(() => {
    if (ready) void storage.saveSelectors(selectors);
  }, [selectors, ready]);

  useEffect(() => {
    if (ready) void storage.saveChatUrls(chatUrls);
  }, [chatUrls, ready]);

  useEffect(() => {
    if (ready) void storage.saveActiveGeminiKeyId(activeGeminiKeyId);
  }, [activeGeminiKeyId, ready]);

  useEffect(() => {
    if (ready) void storage.saveSummaryBlocks(summaryBlocks);
  }, [summaryBlocks, ready]);

  // Tick once every 30 seconds: any account whose limit timer has expired
  // gets promoted back to "active" and its daily counter is zeroed so it
  // becomes a candidate for both manual selection and auto-rotation again.
  useEffect(() => {
    if (!ready) return;
    const tick = () => {
      setAccounts((prev) => {
        const now = Date.now();
        let changed = false;
        const next = prev.map((a) => {
          if (
            a.status === "limit" &&
            typeof a.limitResetAt === "number" &&
            now >= a.limitResetAt
          ) {
            changed = true;
            const { limitResetAt: _drop, ...rest } = a;
            return {
              ...rest,
              status: "active" as const,
              messagesUsedToday: 0,
              lastResetDate: todayKey(),
            };
          }
          return a;
        });
        return changed ? next : prev;
      });
    };
    tick();
    const iv = setInterval(tick, 30_000);
    return () => clearInterval(iv);
  }, [ready]);

  const activeAccount = useMemo(
    () => accounts.find((a) => a.id === activeId) ?? null,
    [accounts, activeId],
  );

  const activeGeminiKey = useMemo(
    () => geminiKeys.find((k) => k.id === activeGeminiKeyId) ?? null,
    [geminiKeys, activeGeminiKeyId],
  );

  // The summarize call always carries the currently-selected user key (if
  // any). The server falls back to Replit's built-in Gemini integration when
  // no header is present, so passing `null` is safe.
  const summarizeOpts = useMemo(
    () => ({ userGeminiKey: activeGeminiKey?.key ?? null }),
    [activeGeminiKey],
  );

  const value: AppContextValue = useMemo(() => {
    /**
     * Append a SummaryBlock for a successful compression and (best-effort)
     * mark the source key as recently used.
     */
    const recordSummaryBlock = (
      result: SummarizeResult,
      compactedCount: number,
      remainingCount: number,
    ) => {
      const block: SummaryBlock = {
        id: newId(),
        createdAt: Date.now(),
        compactedCount,
        remainingCount,
        summary: result.summary,
        important_data: result.important_data,
        tone: result.tone,
        source: result.source,
      };
      setSummaryBlocks((prev) => [block, ...prev]);
      if (result.source === "user-key" && activeGeminiKeyId) {
        void storage.touchGeminiKey(activeGeminiKeyId);
        setGeminiKeys((prev) =>
          prev.map((k) =>
            k.id === activeGeminiKeyId ? { ...k, lastUsedAt: Date.now() } : k,
          ),
        );
      }
    };

    return {
      ready,
      accounts,
      activeAccount,
      messages,
      summary,
      summaryBlocks,
      geminiKeys,
      activeGeminiKey,
      isAssistantTyping,
      selectors,
      getResolvedProvider(providerId) {
        return resolveProvider(providerId, selectors);
      },
      async setCustomSelector(providerId, patch) {
        setSelectors((prev) => ({
          ...prev,
          [providerId]: { ...(prev[providerId] ?? {}), ...patch },
        }));
      },
      async clearCustomSelectors(providerId) {
        setSelectors((prev) => {
          const { [providerId]: _drop, ...rest } = prev;
          return rest;
        });
      },
      async setActiveAccount(id) {
        const list = accountsRef.current;
        if (id !== null && !list.some((a) => a.id === id)) return;
        if (!id) {
          setActiveId(null);
          activeIdRef.current = null;
          await storage.saveActiveAccountId(null);
          return;
        }
        if (id === activeIdRef.current) {
          setActiveId(id);
          await storage.saveActiveAccountId(id);
          return;
        }
        // Switching to a different account:
        //   1. The previous account's chat URL is already saved in chatUrls
        //      (updated continuously via onUrlChange in the chat screen).
        //   2. Clear any saved URL for the new account so its WebView
        //      lands on a *fresh* chat.
        //   3. Compress current local history → produce a context seed,
        //      which gets prepended to the user's first message on the
        //      new account, so the new bot has the prior conversation.
        setChatUrls((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        const oldMessages = messages;
        const oldSummary = summary;
        const userAssistantMsgs = oldMessages.filter(
          (m) => m.role === "user" || m.role === "assistant",
        );
        if (userAssistantMsgs.length > 0) {
          // 1. Set a SYNCHRONOUS handoff seed *immediately* so the new
          //    account always has context, even if the user sends a
          //    message before the async summary finishes.
          const rawSeed = buildHandoffSeed(userAssistantMsgs, oldSummary);
          const seed = { accountId: id, text: rawSeed };
          pendingContextSeedRef.current = seed;
          setPendingContextSeed(seed);
          // 2. Kick off summarization in the background. If the seed
          //    has not been consumed yet, upgrade it to the compact
          //    summary; either way, persist the summary in history.
          void summarizeMessages(userAssistantMsgs, oldSummary, summarizeOpts)
            .then((result) => {
              setSummary(result);
              const summaryMsg: ChatMessage = {
                id: newId(),
                role: "summary",
                content: result.summary,
                createdAt: Date.now(),
              };
              setMessages((prev) => {
                const hasSummaryAtTop = prev[0]?.role === "summary";
                if (hasSummaryAtTop) return prev;
                return [summaryMsg, ...prev];
              });
              setPendingContextSeed((prev) => {
                if (prev && prev.accountId === id) {
                  const nextSeed = { accountId: id, text: result.summary };
                  pendingContextSeedRef.current = nextSeed;
                  return nextSeed;
                }
                return prev;
              });
              recordSummaryBlock(result, userAssistantMsgs.length, 0);
            })
            .catch(() => {
              // Raw seed already in place — nothing else to do.
            });
        }
        setActiveId(id);
        activeIdRef.current = id;
        // Persist selection immediately so a fast screen transition/app pause
        // cannot leave storage with the previously active account.
        await storage.saveActiveAccountId(id);
      },
      chatUrls,
      setChatUrl(accountId, url) {
        setChatUrls((prev) => {
          if (prev[accountId] === url) return prev;
          return { ...prev, [accountId]: url };
        });
      },
      clearChatUrl(accountId) {
        setChatUrls((prev) => {
          if (!(accountId in prev)) return prev;
          const next = { ...prev };
          delete next[accountId];
          return next;
        });
      },
      pendingContextSeed,
      consumePendingContextSeed(accountId) {
        const seed = pendingContextSeedRef.current;
        if (!seed || seed.accountId !== accountId) {
          return null;
        }
        const text = seed.text;
        pendingContextSeedRef.current = null;
        setPendingContextSeed(null);
        return text;
      },
      async addAccount({ providerId, email, cookies, displayName }) {
        const provider: AIProvider = PROVIDERS[providerId];
        const acc: AIAccount = {
          id: newId(),
          providerId,
          email,
          displayName: displayName ?? email.split("@")[0] ?? provider.name,
          status: "active",
          createdAt: Date.now(),
          lastActiveAt: Date.now(),
          messagesUsedToday: 0,
          estimatedDailyLimit: provider.estimatedDailyMessages,
          lastResetDate: todayKey(),
        };
        await storage.saveCookies(acc.id, cookies);
        setAccounts((prev) => [...prev, acc]);
        if (!activeIdRef.current) {
          setActiveId(acc.id);
          activeIdRef.current = acc.id;
        }
        return acc;
      },
      async removeAccount(id) {
        await storage.deleteCookies(id);
        setAccounts((prev) => {
          const next = prev.filter((a) => a.id !== id);
          accountsRef.current = next;
          return next;
        });
        setActiveId((cur) => {
          if (cur !== id) return cur;
          const na = accountsRef.current[0]?.id ?? null;
          activeIdRef.current = na;
          return na;
        });
      },
      async markAccountStatus(id, status, resetAtMs) {
        setAccounts((prev) =>
          prev.map((a) => {
            if (a.id !== id) return a;
            // When transitioning INTO "limit", remember when it expires.
            // Caller passes a parsed timestamp from the page when known,
            // otherwise we default to a 4-hour cooldown.
            if (status === "limit") {
              const fallback = Date.now() + 4 * 60 * 60 * 1000;
              return {
                ...a,
                status,
                limitResetAt:
                  typeof resetAtMs === "number" && resetAtMs > Date.now()
                    ? resetAtMs
                    : fallback,
              };
            }
            // Leaving "limit" → drop the timer.
            const { limitResetAt: _drop, ...rest } = a;
            return { ...rest, status };
          }),
        );
      },
      async bumpAccountUsage(id) {
        setAccounts((prev) =>
          prev.map((a) => {
            if (a.id !== id) return a;
            const reset = isSameDay(a.lastActiveAt) ? a.messagesUsedToday : 0;
            return {
              ...a,
              lastActiveAt: Date.now(),
              messagesUsedToday: reset + 1,
              lastResetDate: todayKey(),
            };
          }),
        );
      },
      appendMessage(m) {
        const msg: ChatMessage = {
          ...m,
          id: newId(),
          createdAt: Date.now(),
        };
        setMessages((prev) => [...prev, msg]);
        return msg;
      },
      updateMessage(id, patch) {
        setMessages((prev) =>
          prev.map((m) => (m.id === id ? { ...m, ...patch } : m)),
        );
      },
      setAssistantTyping,
      async clearChat() {
        setMessages([]);
        setSummary(null);
      },
      async rotateToNextAvailable() {
        const candidates = accounts.filter(
          (a) =>
            a.id !== activeId &&
            a.status === "active" &&
            a.messagesUsedToday < a.estimatedDailyLimit,
        );
        const next = candidates[0] ?? null;
        if (next) {
          // Auto-rotation is also an account switch — apply the same
          // handoff: clear stored URL → fresh chat, and queue a context
          // seed built from the current local history.
          setChatUrls((prev) => {
            if (!(next.id in prev)) return prev;
            const copy = { ...prev };
            delete copy[next.id];
            return copy;
          });
          const userAssistantMsgs = messages.filter(
            (m) => m.role === "user" || m.role === "assistant",
          );
          if (userAssistantMsgs.length > 0) {
            // Synchronous raw-transcript seed so the next account
            // always has context, even if the auto-rotation pendingSend
            // fires before summarization finishes.
            const rawSeed = buildHandoffSeed(userAssistantMsgs, summary);
            const seed = { accountId: next.id, text: rawSeed };
            pendingContextSeedRef.current = seed;
            setPendingContextSeed(seed);
            void summarizeMessages(userAssistantMsgs, summary, summarizeOpts)
              .then((result) => {
                setSummary(result);
                setMessages((prev) => {
                  if (prev[0]?.role === "summary") return prev;
                  const sm: ChatMessage = {
                    id: newId(),
                    role: "summary",
                    content: result.summary,
                    createdAt: Date.now(),
                  };
                  return [sm, ...prev];
                });
                setPendingContextSeed((prev) => {
                  if (prev && prev.accountId === next.id) {
                    const nextSeed = {
                      accountId: next.id,
                      text: result.summary,
                    };
                    pendingContextSeedRef.current = nextSeed;
                    return nextSeed;
                  }
                  return prev;
                });
                recordSummaryBlock(result, userAssistantMsgs.length, 0);
              })
              .catch(() => {
                // Raw seed already in place — nothing else to do.
              });
          }
          setActiveId(next.id);
          activeIdRef.current = next.id;
        }
        return next;
      },
      async compressIfNeeded(): Promise<CompressResult> {
        if (messages.length < COMPRESSION_THRESHOLD) {
          return {
            status: "not-needed",
            messageCount: messages.length,
            threshold: COMPRESSION_THRESHOLD,
          };
        }
        const cutoff = messages.length - COMPRESSION_KEEP_RECENT;
        const oldOnes = messages.slice(0, cutoff).filter(
          (m) => m.role === "user" || m.role === "assistant",
        );
        if (oldOnes.length === 0) return { status: "no-old" };
        try {
          const result = await summarizeMessages(oldOnes, summary, summarizeOpts);
          const summaryMsg: ChatMessage = {
            id: newId(),
            role: "summary",
            content: result.summary,
            createdAt: Date.now(),
          };
          const remaining = messages.slice(cutoff);
          setMessages([summaryMsg, ...remaining]);
          setSummary(result);
          recordSummaryBlock(result, oldOnes.length, remaining.length);
          return {
            status: "compressed",
            compactedCount: oldOnes.length,
            remainingCount: remaining.length,
          };
        } catch (e) {
          return {
            status: "failed",
            error: e instanceof Error ? e.message : "unknown error",
          };
        }
      },
      async addGeminiKey({ label, key }) {
        const trimmedLabel = label.trim() || "Gemini key";
        const trimmedKey = key.trim();
        if (!trimmedKey) {
          throw new Error("API key cannot be empty");
        }
        const newKey: GeminiApiKey = {
          id: newId(),
          label: trimmedLabel,
          key: trimmedKey,
          addedAt: Date.now(),
        };
        await storage.saveGeminiKey(newKey);
        setGeminiKeys((prev) => [...prev, newKey]);
        // First key added becomes the active one automatically.
        setActiveGeminiKeyId((prev) => prev ?? newKey.id);
        return newKey;
      },
      async removeGeminiKey(id) {
        await storage.deleteGeminiKey(id);
        setGeminiKeys((prev) => prev.filter((k) => k.id !== id));
        setActiveGeminiKeyId((prev) => {
          if (prev !== id) return prev;
          const next = geminiKeys.find((k) => k.id !== id);
          return next?.id ?? null;
        });
      },
      async setActiveGeminiKey(id) {
        if (id !== null && !geminiKeys.some((k) => k.id === id)) return;
        setActiveGeminiKeyId(id);
      },
      async clearSummaryBlocks() {
        setSummaryBlocks([]);
      },
    };
  }, [
    ready,
    accounts,
    activeAccount,
    messages,
    summary,
    summaryBlocks,
    geminiKeys,
    activeGeminiKey,
    activeGeminiKeyId,
    summarizeOpts,
    isAssistantTyping,
    activeId,
    selectors,
    chatUrls,
    pendingContextSeed,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside AppProvider");
  return v;
}
