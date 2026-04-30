import Constants from "expo-constants";
import { Platform } from "react-native";

import type { ChatMessage, ConversationSummary } from "./types";

function apiBase(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN as string | undefined;
  if (domain) return `https://${domain}`;
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.location.origin;
  }
  const hostUri =
    (Constants.expoConfig as unknown as { hostUri?: string } | null)?.hostUri ||
    (Constants as unknown as {
      manifest2?: {
        extra?: { expoGo?: { developer?: { tool?: string } } };
      };
    }).manifest2?.extra?.expoGo?.developer?.tool;
  if (hostUri) {
    const host = hostUri.split(":")[0];
    return `http://${host}:5000`;
  }
  return "";
}

export interface SummarizeResult extends ConversationSummary {
  /**
   * Where the summary actually came from. The server echoes this back so the
   * UI can show "via your key" or "via Replit" without guessing.
   */
  source: "user-key" | "replit";
}

export async function summarizeMessages(
  messages: ChatMessage[],
  previousSummary: ConversationSummary | null,
  options?: { userGeminiKey?: string | null },
): Promise<SummarizeResult> {
  const base = apiBase();
  const url = `${base}/api/summarize`;

  const body = {
    messages: messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content })),
    previousSummary: previousSummary?.summary ?? null,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const userKey = options?.userGeminiKey?.trim();
  if (userKey) {
    headers["x-user-gemini-key"] = userKey;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Summarize failed: ${res.status}`);
  }

  const json = (await res.json()) as Partial<SummarizeResult>;
  return {
    summary: json.summary ?? "",
    important_data: Array.isArray(json.important_data)
      ? json.important_data
      : [],
    tone: json.tone ?? "",
    source: json.source === "user-key" ? "user-key" : "replit",
  };
}
