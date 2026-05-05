import { Feather } from "@expo/vector-icons";
import CookieManager from "@react-native-cookies/cookies";
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

import { useApp } from "@/contexts/AppContext";
import { useColors } from "@/hooks/useColors";
import { PROVIDERS, type ProviderId } from "@/lib/providers";
import { loginObserverScript } from "@/lib/webview-scripts";

/** Returns true if the URL looks like a login / auth page. */
function isAuthUrl(url: string): boolean {
  const l = url.toLowerCase();
  return (
    l.includes('/login') ||
    l.includes('/auth/login') ||
    l.includes('/signin') ||
    l.includes('/sign-in') ||
    l.includes('/logout') ||
    l.includes('accounts.google.com')
  );
}

export default function LoginWebViewScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { providerId } = useLocalSearchParams<{ providerId: ProviderId }>();
  const provider = providerId ? PROVIDERS[providerId] : null;

  const { addAccount } = useApp();

  const [email, setEmail] = useState<string | null>(null);
  const [detected, setDetected] = useState(false);
  const [saving, setSaving] = useState(false);

  /**
   * Two-phase load:
   *   "logout" — navigate to logoutUrl so any prior session is cleared.
   *   "login"  — load the actual login page in the shared cookie store.
   *
   * incognito={false} + sharedCookiesEnabled={true} ensures that after login
   * CookieManager.getAll() can capture ALL cookies including httpOnly ones.
   * Session isolation is achieved by the logout phase, not by incognito.
   */
  const [phase, setPhase] = useState<"logout" | "login">("logout");
  const webRef = useRef<WebView | null>(null);
  const logoutLoadedRef = useRef(false);
  const detectedRef = useRef(false);

  useEffect(() => {
    if (!provider) router.back();
  }, [provider]);

  /**
   * DETECTION STRATEGY 1 (backup) — JS / document.cookie via injected script.
   * Works for non-httpOnly session cookies.
   */
  function handleMessage(e: WebViewMessageEvent) {
    try {
      const parsed = JSON.parse(e.nativeEvent.data) as {
        type: string;
        payload?: { cookie?: string; email?: string };
      };
      if (parsed.type === "profile" && parsed.payload?.email) {
        setEmail(parsed.payload.email);
      }
      if (parsed.type === "loginDetected" && !detectedRef.current) {
        detectedRef.current = true;
        setDetected(true);
      }
    } catch { /* ignore */ }
  }

  function handleLoadEnd() {
    if (phase === "logout" && !logoutLoadedRef.current) {
      logoutLoadedRef.current = true;
      setPhase("login");
    }
  }

  /**
   * DETECTION STRATEGY 2 (primary) — URL navigation.
   * When the WebView leaves a login/auth URL and lands on the provider's
   * domain (e.g. chatgpt.com/, claude.ai/new, gemini.google.com/app),
   * the user is now logged in — even if session cookies are httpOnly and
   * invisible to document.cookie.
   */
  function handleNavChange(navState: { url?: string }) {
    if (phase !== "login" || detectedRef.current) return;
    const url = navState.url ?? "";
    if (!url || isAuthUrl(url)) return;
    const providerDomain = provider?.cookieDomains.some((d) =>
      url.toLowerCase().includes(d.replace(/^./, "")),
    );
    if (providerDomain) {
      detectedRef.current = true;
      setDetected(true);
    }
  }

  /**
   * DETECTION STRATEGY 3 (backup for httpOnly) — periodic CookieManager poll.
   * Every 2 s during the login phase, check the OS cookie store for session
   * keys. Catches httpOnly cookies that document.cookie cannot see and that
   * URL-navigation may miss (e.g. SPAs that don't navigate post-login).
   */
  useEffect(() => {
    if (phase !== "login" || detected || !provider) return;
    const sessionKeys = new Set(provider.sessionCookieKeys);
    const iv = setInterval(async () => {
      if (detectedRef.current) { clearInterval(iv); return; }
      try {
        const all = await CookieManager.getAll();
        const found = Object.keys(all).some((k) => sessionKeys.has(k));
        if (found) {
          clearInterval(iv);
          detectedRef.current = true;
          setDetected(true);
        }
      } catch { /* CookieManager unavailable */ }
    }, 2000);
    return () => clearInterval(iv);
  }, [phase, detected, provider]);

  async function handleSave() {
    if (!detected || saving || !provider) return;
    setSaving(true);
    try {
      // Capture ALL cookies from the OS store — includes httpOnly session cookies
      // that document.cookie cannot access. Stored as a JSON array with full
      // metadata (domain, path, httpOnly, secure) so AutomationWebView can
      // restore them precisely via CookieManager.set().
      let cookiesToSave = "";
      try {
        const allCookies = await CookieManager.getAll();
        const cookieArray = Object.values(allCookies);
        if (cookieArray.length > 0) {
          // Filter out obviously expired / empty cookies to keep size down.
          const valid = cookieArray.filter(
            (c) => c.value && c.value !== "deleted",
          );
          cookiesToSave = JSON.stringify(valid.length > 0 ? valid : cookieArray);
        }
      } catch {
        // CookieManager unavailable — account won't be saveable; surface error.
        throw new Error("Unable to capture session cookies. Please try again.");
      }

      if (!cookiesToSave) {
        throw new Error("No cookies captured. Please complete the login first.");
      }

      await addAccount({
        providerId: provider.id,
        email: email ?? `${provider.id}@local`,
        cookies: cookiesToSave,
      });
      router.back();
    } catch (err) {
      // Re-set saving so user can retry
      setSaving(false);
      // Rethrow so a future error boundary or alert can surface it
      throw err;
    } finally {
      setSaving(false);
    }
  }

  const sourceUri = phase === "logout" ? provider?.logoutUrl ?? "" : provider?.loginUrl ?? "";

  if (!provider) return null;

  return (
    <View
      style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}
    >
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
                    phase === "logout"
                      ? colors.textMuted
                      : detected
                      ? colors.success
                      : colors.textMuted,
                },
              ]}
            />
            <Text style={[styles.statusText, { color: colors.mutedForeground }]}>
              {phase === "logout"
                ? "Clearing previous session…"
                : detected
                ? "Session detected"
                : "Waiting for login…"}
            </Text>
          </View>
        </View>
        <Pressable
          onPress={handleSave}
          disabled={!detected || saving}
          style={({ pressed }) => [
            styles.saveBtn,
            {
              backgroundColor: detected ? colors.foreground : colors.raised,
              opacity: pressed || saving ? 0.7 : 1,
            },
          ]}
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.background} />
          ) : (
            <Text
              style={[styles.saveBtnText, { color: detected ? colors.background : colors.textMuted }]}
            >
              Save
            </Text>
          )}
        </Pressable>
      </View>

      <View style={styles.webWrap}>
        <WebView
          ref={(r) => { webRef.current = r; }}
          key={phase}
          source={{ uri: sourceUri }}
          injectedJavaScriptBeforeContentLoaded={
            phase === "login" ? loginObserverScript(provider) : undefined
          }
          onMessage={handleMessage}
          onLoadEnd={handleLoadEnd}
          onNavigationStateChange={handleNavChange}
          javaScriptEnabled
          domStorageEnabled
          thirdPartyCookiesEnabled
          incognito={false}
          sharedCookiesEnabled={true}
          cacheEnabled={false}
          startInLoadingState
          renderLoading={() => (
            <View style={[StyleSheet.absoluteFill, styles.loading, { backgroundColor: colors.background }]}>
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
        {phase === "logout" ? (
          <View style={[StyleSheet.absoluteFill, styles.loading, { backgroundColor: colors.background }]}>
            <ActivityIndicator color={colors.foreground} />
            <Text style={[styles.loadingText, { color: colors.mutedForeground, marginTop: 12 }]}>
              Preparing a fresh login…
            </Text>
          </View>
        ) : null}
      </View>

      {phase === "login" ? (
        detected ? (
          <View
            style={[
              styles.footerHint,
              { borderTopColor: colors.border, backgroundColor: colors.elevated, paddingBottom: insets.bottom + 12 },
            ]}
          >
            <Feather name="check-circle" size={16} color={colors.success} />
            <Text style={[styles.footerText, { color: colors.foreground }]}>
              Logged in{email ? ` as ${email}` : ""}. Tap Save to continue.
            </Text>
          </View>
        ) : (
          <View
            style={[
              styles.footerHint,
              { borderTopColor: colors.border, backgroundColor: colors.elevated, paddingBottom: insets.bottom + 12 },
            ]}
          >
            <Feather name="lock" size={14} color={colors.mutedForeground} />
            <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
              Sign in with your existing {provider.name} account.
            </Text>
          </View>
        )
      ) : null}
    </View>
  );
}

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
  title: { fontFamily: "Inter_700Bold", fontSize: 16 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontFamily: "Inter_400Regular", fontSize: 12 },
  saveBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    minWidth: 64,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  webWrap: { flex: 1 },
  loading: { alignItems: "center", justifyContent: "center" },
  loadingText: { fontFamily: "Inter_400Regular", fontSize: 13 },
  footerHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerText: { fontFamily: "Inter_500Medium", fontSize: 13, flex: 1 },
});
