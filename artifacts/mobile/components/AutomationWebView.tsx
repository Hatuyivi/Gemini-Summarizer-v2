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
  | { type: "sessionExpired" }
  | { type: "sessionValid" };

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
   * Cookies saved at login time. Two formats:
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
    'auth?', 'accounts.google.com',
  ];
  return loginPatterns.some((p) => lower.includes(p));
}

/** Parse stored cookies — JSON array (new) or legacy "name=value; …" string. */
function parseCookieString(raw: string): CookieEntry[] {
  if (raw.trimStart().startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as CookieEntry[];
      return parsed.filter((c) => c.name && c.value && c.value !== "deleted");
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

export const AutomationWebView = forwardRef<AutomationHandle, Props>(
  function AutomationWebView(
    { provider, sessionKey, cookies, onEvent, visible, resumeUrl, onUrlChange },
    ref,
  ) {
    const sourceUriRef = useRef<string>(resumeUrl || provider.chatUrl);
    const webRef = useRef<WebView | null>(null);
    const sendQueue = useRef<{ prompt: string; image?: string | null }[]>([]);
    const ready = useRef(false);
    const currentUrlRef = useRef<string>("");
    /** Prevent duplicate sessionExpired / sessionValid events per session. */
    const sessionEventFiredRef = useRef<"expired" | "valid" | null>(null);

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
        sessionEventFiredRef.current = null;
        sourceUriRef.current = resumeUrl || provider.chatUrl;
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [provider.id, sessionKey]);

    /** Clear OS cookie store then install this account's saved cookies. */
    useEffect(() => {
      if (cookies === null) {
        setCookiesReady(false);
        return;
      }

      let cancelled = false;
      setCookiesReady(false);
      sessionEventFiredRef.current = null;

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
          // Best-effort; WebView may recover via server-side session refresh.
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
        const url = currentUrlRef.current;
        if (url && isLoginPageUrl(url)) {
          // Initial load landed on a login page → session is invalid.
          if (sessionEventFiredRef.current === null) {
            sessionEventFiredRef.current = "expired";
            onEvent({ type: "sessionExpired" });
          }
          return; // don't flush queue against a login page
        }
        // Initial load landed on a normal page → session is valid.
        if (sessionEventFiredRef.current === null) {
          sessionEventFiredRef.current = "valid";
          onEvent({ type: "sessionValid" });
        }
        // Flush any queued sends.
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
      // After first load: detect mid-session redirect to login.
      if (ready.current && isLoginPageUrl(url) && sessionEventFiredRef.current !== "expired") {
        sessionEventFiredRef.current = "expired";
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
