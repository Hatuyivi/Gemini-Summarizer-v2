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
  | { type: "log"; msg: string };

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
  /**
   * Stable per-device account id. MUST NOT depend on the cookie string:
   * cookies load async / can be re-serialized — using them in WebView `key`
   * remounts the WebView and reloads the chat URL after every message.
   */
  sessionKey: string;
  /**
   * Cookies saved at login time. Two formats are supported:
   *   - JSON string (new format): JSON.stringify(CookieEntry[]) — includes
   *     httpOnly session cookies captured via CookieManager.getAll().
   *   - Legacy string: "name=value; name2=value2" — document.cookie format,
   *     non-httpOnly cookies only. Still accepted for backward compatibility
   *     with accounts added before this fix.
   * null means cookies are still loading from SecureStore — the WebView will
   * not mount until this resolves to prevent firing the first request against
   * the wrong (previous account's) OS cookie store.
   */
  cookies: string | null;
  onEvent: (e: AutomationEvent) => void;
  visible?: boolean;
  /**
   * If provided, the WebView resumes the previous chat at this URL instead
   * of loading the provider's default chat URL (which would create a new chat).
   */
  resumeUrl?: string | null;
  /**
   * Fires whenever the underlying WebView navigates to a new URL.
   */
  onUrlChange?: (url: string) => void;
}

/** Parse the stored cookie string into a list of CookieEntry objects. */
function parseCookieString(raw: string): CookieEntry[] {
  // New format: JSON array produced by CookieManager.getAll()
  if (raw.trimStart().startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as CookieEntry[];
      return parsed.filter((c) => c.name);
    } catch {
      // fall through to legacy parser
    }
  }
  // Legacy format: "name=value; name2=value2" (document.cookie)
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
    // Snapshot the source URL at mount so navigation inside the WebView
    // doesn't cause the `source` prop to change and trigger a reload.
    const sourceUriRef = useRef<string>(resumeUrl || provider.chatUrl);
    const webRef = useRef<WebView | null>(null);
    const sendQueue = useRef<{ prompt: string; image?: string | null }[]>([]);
    const ready = useRef(false);

    /**
     * cookiesReady gates WebView mounting. It is false while we are clearing
     * and re-installing OS-level cookies for the active account. The WebView
     * must NOT fire its first network request until the correct session cookies
     * are installed in the shared OS cookie store.
     */
    const [cookiesReady, setCookiesReady] = useState(false);

    // Track session identity so we can detect account / provider switches.
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
        sourceUriRef.current = resumeUrl || provider.chatUrl;
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- resumeUrl/chatUrl
      // intentionally read only when session changes; adding resumeUrl would
      // fight the in-page URL on every Claude navigation.
    }, [provider.id, sessionKey]);

    /**
     * Install this account's cookies at the OS level before the WebView loads.
     *
     * Why CookieManager instead of document.cookie injection:
     *   Session cookies for Claude, Gemini, and ChatGPT are marked httpOnly.
     *   document.cookie cannot read or write httpOnly cookies, so the previous
     *   JS-injection approach silently failed — the WebView always used the
     *   session of whichever account last completed a real WebView login.
     *
     *   CookieManager operates on the native WKHTTPCookieStore (iOS) /
     *   CookieManager (Android) that sharedCookiesEnabled WebViews read,
     *   bypassing the httpOnly restriction entirely.
     *
     *   Cookies are now captured at login time via CookieManager.getAll()
     *   (in login.tsx), stored as a JSON array in SecureStore, and restored
     *   here with full fidelity including domain, path, httpOnly, and secure.
     *
     * Flow:
     *   1. Gate the WebView (cookiesReady = false) so it cannot start loading.
     *   2. CookieManager.clearAll() — evict the previous account's httpOnly
     *      session cookies from the shared OS store.
     *   3. CookieManager.set() each saved cookie for the new account.
     *   4. Ungate (cookiesReady = true) — the WebView mounts with the correct
     *      cookies already in place before the first network request fires.
     */
    useEffect(() => {
      if (cookies === null) {
        // Cookies are still loading from SecureStore — keep WebView gated.
        setCookiesReady(false);
        return;
      }

      let cancelled = false;
      setCookiesReady(false);

      (async () => {
        try {
          // Step 1: clear the shared OS store so no previous account's
          // httpOnly session cookies bleed into the new WebView session.
          await CookieManager.clearAll();

          if (!cancelled && cookies) {
            const entries = parseCookieString(cookies);

            for (const entry of entries) {
              // Derive the URL to associate the cookie with. For cookies
              // captured via CookieManager.getAll() the domain field is set;
              // for legacy document.cookie strings we fall back to chatUrl.
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
          // Cookie installation is best-effort; the WebView may recover via
          // server-side session-refresh mechanisms.
        }

        if (!cancelled) {
          setCookiesReady(true);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [sessionKey, provider.id, provider.chatUrl, cookies]);

    const webViewKey = `${provider.id}:${sessionKey}`;

    useImperativeHandle(ref, () => ({
      async send(prompt: string, imageDataUrl?: string | null) {
        if (!webRef.current || !ready.current) {
          sendQueue.current.push({ prompt, image: imageDataUrl });
          return;
        }
        const script = automationScript(prompt, provider, imageDataUrl);
        webRef.current.injectJavaScript(script);
      },
    }));

    function handleMessage(e: WebViewMessageEvent) {
      try {
        const parsed = JSON.parse(e.nativeEvent.data) as {
          type: string;
          payload?: {
            text?: string;
            reason?: string;
            stage?: string;
            msg?: string;
            resetAtMs?: number | null;
          };
        };
        switch (parsed.type) {
          case "automation:response":
            onEvent({ type: "response", text: parsed.payload?.text ?? "" });
            break;
          case "automation:error":
            onEvent({
              type: "error",
              reason: parsed.payload?.reason ?? "unknown",
            });
            break;
          case "automation:limit":
            onEvent({
              type: "limit",
              reason: parsed.payload?.reason ?? "limit",
              resetAtMs: parsed.payload?.resetAtMs ?? null,
            });
            break;
          case "automation:typing":
            onEvent({
              type: "stage",
              stage: parsed.payload?.stage ?? "typing",
            });
            break;
          case "log":
            onEvent({ type: "log", msg: parsed.payload?.msg ?? "" });
            break;
        }
      } catch {
        // ignore
      }
    }

    function handleLoadEnd() {
      if (!ready.current) {
        ready.current = true;
        // Flush any prompts queued while the page was loading.
        const queued = sendQueue.current.splice(0);
        queued.forEach((q) =>
          webRef.current?.injectJavaScript(
            automationScript(q.prompt, provider, q.image),
          ),
        );
      }
    }

    return (
      <View style={styles.container} pointerEvents={visible ? "auto" : "none"}>
        {/*
          Only render the WebView after CookieManager has cleared the shared OS
          store and installed the active account's cookies. This prevents the
          WebView from firing its first request before the correct session is
          in place — the root cause of the account-switching bug.
        */}
        {cookiesReady ? (
          <WebView
            ref={(r) => {
              webRef.current = r;
            }}
            // key changes when the active account changes, forcing a full
            // remount so each account gets its own WebView lifecycle.
            key={webViewKey}
            source={{ uri: sourceUriRef.current }}
            injectedJavaScriptBeforeContentLoaded={loginObserverScript(provider)}
            onMessage={handleMessage}
            onLoadEnd={handleLoadEnd}
            onNavigationStateChange={(navState) => {
              if (navState.url && onUrlChange) {
                onUrlChange(navState.url);
              }
            }}
            javaScriptEnabled
            domStorageEnabled
            thirdPartyCookiesEnabled
            // Keep sharedCookiesEnabled so the WebView reads the OS cookie
            // store where CookieManager installs the per-account cookies.
            sharedCookiesEnabled={true}
            cacheEnabled
            // incognito must stay false — incognito WebViews use a separate
            // ephemeral store that CookieManager cannot write to.
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

// Silence unused import warning for type narrowing
void PROVIDERS;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
});
