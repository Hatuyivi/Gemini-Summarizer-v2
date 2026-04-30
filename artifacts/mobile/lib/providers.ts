export type ProviderId = "chatgpt" | "claude" | "gemini" | "perplexity";

export interface AIProvider {
  id: ProviderId;
  name: string;
  loginUrl: string;
  chatUrl: string;
  cookieDomains: string[];
  sessionCookieKeys: string[];
  inputSelector: string;
  sendButtonSelector: string;
  responseSelector: string;
  estimatedDailyMessages: number;
}

export const PROVIDERS: Record<ProviderId, AIProvider> = {
  chatgpt: {
    id: "chatgpt",
    name: "ChatGPT",
    loginUrl: "https://chatgpt.com/auth/login",
    chatUrl: "https://chatgpt.com/",
    cookieDomains: ["chatgpt.com", ".chatgpt.com", "chat.openai.com"],
    sessionCookieKeys: [
      "__Secure-next-auth.session-token",
      "__Host-next-auth.csrf-token",
    ],
    inputSelector: "div#prompt-textarea, textarea#prompt-textarea",
    sendButtonSelector: "button[data-testid='send-button']",
    responseSelector: "div[data-message-author-role='assistant']",
    estimatedDailyMessages: 40,
  },
  claude: {
    id: "claude",
    name: "Claude",
    loginUrl: "https://claude.ai/login",
    chatUrl: "https://claude.ai/new",
    cookieDomains: ["claude.ai", ".claude.ai"],
    sessionCookieKeys: ["sessionKey", "lastActiveOrg"],
    inputSelector:
      "div.ProseMirror[contenteditable='true'], div[contenteditable='true'][role='textbox'], div[contenteditable='true'][data-placeholder], fieldset div[contenteditable='true']",
    sendButtonSelector:
      "button[aria-label*='Send'], button[aria-label*='send'], button[type='submit']:has(svg), fieldset button:has(svg[data-icon='paper-airplane'])",
    responseSelector:
      "div.font-claude-message, div[data-is-streaming], div[data-testid='message'], div.prose",
    estimatedDailyMessages: 30,
  },
  gemini: {
    id: "gemini",
    name: "Gemini",
    loginUrl: "https://gemini.google.com/",
    chatUrl: "https://gemini.google.com/app",
    cookieDomains: [
      ".google.com",
      "google.com",
      "gemini.google.com",
      "accounts.google.com",
    ],
    sessionCookieKeys: ["SID", "HSID", "SSID", "APISID", "SAPISID"],
    inputSelector: "div.ql-editor[contenteditable='true']",
    sendButtonSelector: "button[aria-label='Send message']",
    responseSelector: "message-content, .model-response-text",
    estimatedDailyMessages: 50,
  },
  perplexity: {
    id: "perplexity",
    name: "Perplexity",
    loginUrl: "https://www.perplexity.ai/",
    chatUrl: "https://www.perplexity.ai/",
    cookieDomains: ["perplexity.ai", ".perplexity.ai", "www.perplexity.ai"],
    sessionCookieKeys: ["__Secure-next-auth.session-token", "pplx.session-token"],
    inputSelector: "textarea[placeholder*='Ask'], textarea",
    sendButtonSelector: "button[aria-label='Submit']",
    responseSelector: "div.prose",
    estimatedDailyMessages: 20,
  },
};

export const PROVIDER_LIST: AIProvider[] = Object.values(PROVIDERS);

import type { CustomSelectors, ProviderSelectorOverrides } from "./types";

/** Returns provider with user-defined selector overrides applied. */
export function resolveProvider(
  id: ProviderId,
  overrides: ProviderSelectorOverrides | null | undefined,
): AIProvider {
  const base = PROVIDERS[id];
  const o: CustomSelectors | undefined = overrides?.[id];
  if (!o) return base;
  return {
    ...base,
    inputSelector: o.inputSelector
      ? `${o.inputSelector}, ${base.inputSelector}`
      : base.inputSelector,
    sendButtonSelector: o.sendButtonSelector
      ? `${o.sendButtonSelector}, ${base.sendButtonSelector}`
      : base.sendButtonSelector,
    responseSelector: o.responseSelector
      ? `${o.responseSelector}, ${base.responseSelector}`
      : base.responseSelector,
  };
}
