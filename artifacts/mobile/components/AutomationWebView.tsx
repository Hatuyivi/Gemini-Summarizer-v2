import CookieManager from "@react-native-cookies/cookies";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { PROVIDERS, type AIProvider } from "@/lib/providers";
import { automationScript, loginObserverScript } from "@/lib/webview-scripts";

export type AutomationEvent =
  | { type: "response"; text: string }
  | { type: "error"; reason: string }
  | { type: "limit"; reason: string; resetAtMs?: number | null }
  | { type: "stage"; stage: string }
  | { type: "log"; msg: string }
  | { type: "sessionExpired" };

export interface AutomationHandle {
  send(prompt: string, imageDataUrl?: string | null): Promise<void>;
}

interface CookieEntry {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
}

interface Props {
  provider: AIProvider;
  sessionKey: string;
  /**
   * Cookies saved at login time. Two formats supported:
   *   - JSON string: JSON.stringify(CookieEntry[]) — includes httpOnly cookies.
   *   - Legacy "name=value; name2=value2" — backward-compat.
   * null = still loading from SecureStore; WebView will not mount yet.
   */
  cookies: string | null;
  onEvent: (e: AutomationEvent) => void;
  visible?: boolean;
  resumeUrl?: string | null;
  onUrlChange?: (url: string) => void;
}

/** Returns true if the URL looks like a login / auth page. */
function isLoginPageUrl(url: string): boolean {
  const lower = url.toLowerCase();
  const loginPatterns = [
    '/login', '/auth/login', '/signin', '/sign-in',
    '/auth?', 'auth/login', 'accounts.google.com',
  ];
  return loginPatterns.some((p) => lower.includes(p));
}

/** Parse stored cookies — JSON array (new) or legacy "name=value; …" string. */
function parseCookieString(raw: string): CookieEntry[] {
  if (raw.trimStart().startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as CookieEntry[];
      return parsed.filter((c) => c.name);
    } catch {
      // fall through
    }
  }
  return raw
    .split(";")
    .map((c) => c.trim())
    .filter(Boolean)
    .flatMap((pair) => {
      const eqIdx = pair.indexOf("=");
      if (eqIdx === -1) return [];
      const name = pair.slice(0, eqIdx).trim();
      const value = pair.slice(eqIdx + 1).trim();
      if (!name) return [];
      return [{ name, value }];
    });
}

/** Hidden WebView that drives an authenticated AI service. */
export const AutomationWebView = forwardRef<AutomationHandle, Props>(
  function AutomationWebView(
    { provider, sessionKey, cookies, onEvent, visible, resumeUrl, onUrlChange },
    ref,
  ) {
    const sourceUriRef = useRef<string>(resumeUrl || provider.chatUrl);
    const webRef = useRef<WebView | null>(null);
    const sendQueue = useRef<{ prompt: string; image?: string | null }[]>([]);
    const ready = useRef(false);
    /** Tracks the URL the WebView is currently on, updated by onNavigationStateChange. */
    const currentUrlRef = useRef<string>("");
    /** True once sessionExpired has been emitted for this session, so we don't fire twice. */
    const sessionExpiredFiredRef = useRef(false);

    /**
     * cookiesReady gates WebView mounting. False while clearing + installing
     * OS-level cookies so the WebView never fires its first request against
     * the wrong account's cookie store.
     */
    const [cookiesReady, setCookiesReady] = useState(false);

    const prevProviderIdRef = useRef(provider.id);
    const prevSessionKeyRef = useRef(sessionKey);
    useEffect(() => {
      if (
        provider.id !== prevProviderIdRef.current ||
        sessionKey !== prevSessionKeyRef.current
      ) {
        prevProviderIdRef.current = provider.id;
        prevSessionKeyRef.current = sessionKey;
        ready.current = false;
        sendQueue.current = [];
        sessionExpiredFiredRef.current = false;
        sourceUriRef.current = resumeUrl || provider.chatUrl;
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [provider.id, sessionKey]);

    /**
     * Install this account's cookies at the OS level before the WebView loads.
     * Uses CookieManager (native layer) instead of document.cookie so httpOnly
     * session cookies are properly installed/cleared on account switch.
     */
    useEffect(() => {
      if (cookies === null) {
        setCookiesReady(false);
        return;
      }

      let cancelled = false;
      setCookiesReady(false);
      sessionExpiredFiredRef.current = false;

      (async () => {
        try {
          await CookieManager.clearAll();

          if (!cancelled && cookies) {
            const entries = parseCookieString(cookies);
            for (const entry of entries) {
              const cookieUrl = entry.domain
                ? `https://${entry.domain.replace(/^\./, "")}`
                : provider.chatUrl;
              await CookieManager.set(cookieUrl, {
                name: entry.name,
                value: entry.value,
                domain: entry.domain,
                path: entry.path ?? "/",
                secure: entry.secure,
                httpOnly: entry.httpOnly,
              });
            }
          }
        } catch {
          // Best-effort; WebView may still recover via server-side session refresh.
        }

        if (!cancelled) setCookiesReady(true);
      })();

      return () => { cancelled = true; };
    }, [sessionKey, provider.id, provider.chatUrl, cookies]);

    const webViewKey = `${provider.id}:${sessionKey}`;

    useImperativeHandle(ref, () => ({
      async send(prompt: string, imageDataUrl?: string | null) {
        if (!webRef.current || !ready.current) {
          sendQueue.current.push({ prompt, image: imageDataUrl });
          return;
        }
        webRef.current.injectJavaScript(automationScript(prompt, provider, imageDataUrl));
      },
    }));

    function handleMessage(e: WebViewMessageEvent) {
      try {
        const parsed = JSON.parse(e.nativeEvent.data) as {
          type: string;
          payload?: {
            text?: string; reason?: string; stage?: string;
            msg?: string; resetAtMs?: number | null;
          };
        };
        switch (parsed.type) {
          case "automation:response":
            onEvent({ type: "response", text: parsed.payload?.text ?? "" });
            break;
          case "automation:error":
            onEvent({ type: "error", reason: parsed.payload?.reason ?? "unknown" });
            break;
          case "automation:limit":
            onEvent({
              type: "limit",
              reason: parsed.payload?.reason ?? "limit",
              resetAtMs: parsed.payload?.resetAtMs ?? null,
            });
            break;
          case "automation:typing":
            onEvent({ type: "stage", stage: parsed.payload?.stage ?? "typing" });
            break;
          case "log":
            onEvent({ type: "log", msg: parsed.payload?.msg ?? "" });
            break;
        }
      } catch { /* ignore */ }
    }

    function handleLoadEnd() {
      if (!ready.current) {
        ready.current = true;
        // Check if the initial load already landed on a login page —
        // this means the session is invalid (clearAll removed the cookies
        // and the stored cookies were not sufficient to restore it).
        const url = currentUrlRef.current;
        if (url && isLoginPageUrl(url) && !sessionExpiredFiredRef.current) {
          sessionExpiredFiredRef.current = true;
          onEvent({ type: "sessionExpired" });
          return; // don't flush send queue against a login page
        }
        const queued = sendQueue.current.splice(0);
        queued.forEach((q) =>
          webRef.current?.injectJavaScript(automationScript(q.prompt, provider, q.image)),
        );
      }
    }

    function handleNavChange(navState: { url?: string }) {
      const url = navState.url;
      if (!url) return;
      currentUrlRef.current = url;
      if (onUrlChange) onUrlChange(url);
      // After the first load, detect mid-session redirects to login pages.
      if (ready.current && isLoginPageUrl(url) && !sessionExpiredFiredRef.current) {
        sessionExpiredFiredRef.current = true;
        onEvent({ type: "sessionExpired" });
      }
    }

    return (
      <View style={styles.container} pointerEvents={visible ? "auto" : "none"}>
        {cookiesReady ? (
          <WebView
            ref={(r) => { webRef.current = r; }}
            key={webViewKey}
            source={{ uri: sourceUriRef.current }}
            injectedJavaScriptBeforeContentLoaded={loginObserverScript(provider)}
            onMessage={handleMessage}
            onLoadEnd={handleLoadEnd}
            onNavigationStateChange={handleNavChange}
            javaScriptEnabled
            domStorageEnabled
            thirdPartyCookiesEnabled
            sharedCookiesEnabled={true}
            cacheEnabled
            incognito={false}
            startInLoadingState={false}
            originWhitelist={["*"]}
            userAgent={
              Platform.OS === "android"
                ? "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
                : undefined
            }
          />
        ) : null}
      </View>
    );
  },
);

AutomationWebView.displayName = "AutomationWebView";

void PROVIDERS;

const styles = StyleSheet.create({
  container: { flex: 1, width: "100%", height: "100%" },
});
