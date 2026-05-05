import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import CookieManager from "@react-native-cookies/cookies";

import { useApp } from "@/contexts/AppContext";
import { useColors } from "@/hooks/useColors";
import { PROVIDERS, type ProviderId } from "@/lib/providers";
import { loginObserverScript } from "@/lib/webview-scripts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LoginPhase = "clearing" | "ready";

interface DetectedSession {
  email: string | null;
  /** Raw document.cookie string — non-httpOnly cookies only. Fallback. */
  docCookies: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LoginWebViewScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { providerId } = useLocalSearchParams<{ providerId: ProviderId }>();
  const provider = providerId ? PROVIDERS[providerId] : null;
  const { addAccount } = useApp();

  // Phase: first load logout URL to wipe any existing session, then switch to
  // the real login URL. A ref guards against firing the transition more than
  // once across redirect chains that may fire onLoadEnd multiple times.
  const [phase, setPhase] = useState<LoginPhase>("clearing");
  const clearingDoneRef = useRef(false);
  const webRef = useRef<WebView | null>(null);

  // Session data emitted by the injected JS observer.
  const [session, setSession] = useState<DetectedSession | null>(null);
  const [saving, setSaving] = useState(false);

  // Redirect away if provider is invalid.
  useEffect(() => {
    if (!provider) router.back();
  }, [provider]);

  if (!provider) return null;

  // -------------------------------------------------------------------------
  // WebView message handler
  // -------------------------------------------------------------------------

  function handleMessage(e: WebViewMessageEvent) {
    try {
      const msg = JSON.parse(e.nativeEvent.data) as {
        type: string;
        payload?: { cookie?: string; email?: string };
      };

      if (msg.type === "loginDetected") {
        // loginDetected is the authoritative signal — set session if not yet set.
        setSession((prev) => prev ?? { email: null, docCookies: "" });
      }

      if (msg.type === "cookies" && msg.payload?.cookie) {
        setSession((prev) =>
          prev ? { ...prev, docCookies: msg.payload!.cookie! } : prev,
        );
      }

      if (msg.type === "profile" && msg.payload?.email) {
        setSession((prev) =>
          prev ? { ...prev, email: msg.payload!.email! } : prev,
        );
      }
    } catch {
      // Malformed message — ignore.
    }
  }

  // -------------------------------------------------------------------------
  // Phase transition: clearing → ready
  // -------------------------------------------------------------------------

  function handleLoadEnd() {
    if (phase === "clearing" && !clearingDoneRef.current) {
      clearingDoneRef.current = true;
      setPhase("ready");
    }
  }

  // -------------------------------------------------------------------------
  // Save session
  // -------------------------------------------------------------------------

  async function handleSave() {
    if (!session || saving) return;
    setSaving(true);
    try {
      const cookies = await captureCookies(session.docCookies);
      await addAccount({
        providerId: provider.id,
        email: session.email ?? `${provider.id}@local`,
        cookies,
      });
      router.back();
    } finally {
      setSaving(false);
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const sourceUri =
    phase === "clearing" ? provider.logoutUrl : provider.loginUrl;
  const isDetected = session !== null;

  return (
    <View
      style={[
        styles.root,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.6 : 1 }]}
          hitSlop={10}
        >
          <Feather name="x" size={20} color={colors.foreground} />
        </Pressable>

        <View style={styles.headerCenter}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Sign in to {provider.name}
          </Text>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor:
                    phase === "clearing"
                      ? colors.textMuted
                      : isDetected
                        ? colors.success
                        : colors.textMuted,
                },
              ]}
            />
            <Text style={[styles.statusText, { color: colors.mutedForeground }]}>
              {phase === "clearing"
                ? "Clearing previous session…"
                : isDetected
                  ? "Session detected"
                  : "Waiting for login…"}
            </Text>
          </View>
        </View>

        <Pressable
          onPress={handleSave}
          disabled={!isDetected || saving}
          style={({ pressed }) => [
            styles.saveBtn,
            {
              backgroundColor: isDetected ? colors.foreground : colors.raised,
              opacity: pressed || saving ? 0.7 : 1,
            },
          ]}
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.background} />
          ) : (
            <Text
              style={[
                styles.saveBtnText,
                { color: isDetected ? colors.background : colors.textMuted },
              ]}
            >
              Save
            </Text>
          )}
        </Pressable>
      </View>

      {/* WebView */}
      <View style={styles.webWrap}>
        <WebView
          ref={(r) => { webRef.current = r; }}
          // `key` forces a full remount when the phase changes so the new URL
          // always gets a fresh navigation context.
          key={phase}
          source={{ uri: sourceUri }}
          injectedJavaScriptBeforeContentLoaded={
            phase === "ready" ? loginObserverScript(provider) : undefined
          }
          onMessage={handleMessage}
          onLoadEnd={handleLoadEnd}
          javaScriptEnabled
          domStorageEnabled
          thirdPartyCookiesEnabled
          // Keep the shared OS cookie store so CookieManager.getAll() can
          // capture httpOnly session cookies after login. Session isolation
          // is handled by the clearing phase (logout URL) above.
          incognito={false}
          sharedCookiesEnabled
          // Always fetch logout fresh so stale cache doesn't skip the clearing.
          cacheEnabled={phase !== "clearing"}
          startInLoadingState
          renderLoading={() => (
            <View
              style={[
                StyleSheet.absoluteFill,
                styles.centred,
                { backgroundColor: colors.background },
              ]}
            >
              <ActivityIndicator color={colors.foreground} />
            </View>
          )}
          originWhitelist={["*"]}
          userAgent={
            Platform.OS === "android"
              ? "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
              : undefined
          }
        />

        {/* Overlay while clearing the previous session */}
        {phase === "clearing" && (
          <View
            style={[
              StyleSheet.absoluteFill,
              styles.centred,
              { backgroundColor: colors.background },
            ]}
          >
            <ActivityIndicator color={colors.foreground} />
            <Text
              style={[
                styles.loadingText,
                { color: colors.mutedForeground, marginTop: 12 },
              ]}
            >
              Preparing a fresh login…
            </Text>
          </View>
        )}
      </View>

      {/* Footer hint */}
      {phase === "ready" && (
        <View
          style={[
            styles.footer,
            {
              borderTopColor: colors.border,
              backgroundColor: colors.elevated,
              paddingBottom: insets.bottom + 12,
            },
          ]}
        >
          {isDetected ? (
            <>
              <Feather name="check-circle" size={16} color={colors.success} />
              <Text style={[styles.footerText, { color: colors.foreground }]}>
                Logged in{session?.email ? ` as ${session.email}` : ""}. Tap Save to
                continue.
              </Text>
            </>
          ) : (
            <>
              <Feather name="lock" size={14} color={colors.mutedForeground} />
              <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
                Sign in with your existing {provider.name} account.
              </Text>
            </>
          )}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Captures the full cookie jar via CookieManager (includes httpOnly cookies
 * that document.cookie cannot see). Falls back to the non-httpOnly string
 * collected by the injected observer script when CookieManager is unavailable.
 */
async function captureCookies(docCookieFallback: string): Promise<string> {
  try {
    const all = await CookieManager.getAll();
    const arr = Object.values(all);
    if (arr.length > 0) {
      return JSON.stringify(arr);
    }
  } catch {
    // CookieManager not available in this environment — use fallback.
  }
  return docCookieFallback;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: { flex: 1 },
  title: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
  },
  saveBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    minWidth: 64,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  webWrap: { flex: 1 },
  centred: { alignItems: "center", justifyContent: "center" },
  loadingText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerText: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    flex: 1,
  },
});
