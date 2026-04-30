import { forwardRef, useImperativeHandle, useRef } from "react";
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

interface Props {
  provider: AIProvider;
  cookies: string;
  onEvent: (e: AutomationEvent) => void;
  visible?: boolean;
  /**
   * If provided, the WebView resumes the previous chat at this URL instead
   * of loading the provider's default chat URL (which would create a new
   * chat). Used to keep the same conversation when the user navigates
   * away from the chat screen and returns.
   */
  resumeUrl?: string | null;
  /**
   * Fires whenever the underlying WebView navigates to a new URL. The chat
   * screen persists this so we can resume on remount.
   */
  onUrlChange?: (url: string) => void;
}

/** Hidden WebView that drives an authenticated AI service. */
export const AutomationWebView = forwardRef<AutomationHandle, Props>(
  function AutomationWebView(
    { provider, cookies, onEvent, visible, resumeUrl, onUrlChange },
    ref,
  ) {
    // Snapshot the source URL at mount so navigation inside the WebView
    // doesn't cause the `source` prop to change and trigger a reload.
    const sourceUriRef = useRef<string>(resumeUrl || provider.chatUrl);
    const webRef = useRef<WebView | null>(null);
    const sendQueue = useRef<{ prompt: string; image?: string | null }[]>([]);
    const ready = useRef(false);

    useImperativeHandle(ref, () => ({
      async send(prompt: string, imageDataUrl?: string | null) {
        // Queue the prompt until both the WebView is mounted AND the page
        // has finished its initial load. Otherwise injectJavaScript fires
        // against a blank/loading document and the prompt is lost — this is
        // exactly what happened during account rotation.
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
        // Restore cookies via a small bootstrap (web view normally remembers
        // them, but we re-inject just in case the page expects them inline).
        if (cookies) {
          const lines = cookies
            .split(";")
            .map((c) => c.trim())
            .filter(Boolean)
            .map(
              (c) =>
                `document.cookie = ${JSON.stringify(c + "; path=/")};`,
            )
            .join("\n");
          webRef.current?.injectJavaScript(`(function(){try{${lines}}catch(e){} })(); true;`);
        }
        // process queued sends
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
        <WebView
          ref={(r) => {
            webRef.current = r;
          }}
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
          sharedCookiesEnabled
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
      </View>
    );
  },
);

AutomationWebView.displayName = "AutomationWebView";

// Attempt to silence unused import warning for type narrowing
void PROVIDERS;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
});
