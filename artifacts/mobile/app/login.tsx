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

  import { useApp } from "@/contexts/AppContext";
  import { useColors } from "@/hooks/useColors";
  import { PROVIDERS, type ProviderId } from "@/lib/providers";
  import CookieManager from "@react-native-cookies/cookies";
  import { loginObserverScript } from "@/lib/webview-scripts";

  export default function LoginWebViewScreen() {
    const colors = useColors();
    const insets = useSafeAreaInsets();
    const { providerId } = useLocalSearchParams<{ providerId: ProviderId }>();
    const provider = providerId ? PROVIDERS[providerId] : null;

    const { addAccount } = useApp();

    const [cookies, setCookies] = useState<string>("");
    const [email, setEmail] = useState<string | null>(null);
    const [detected, setDetected] = useState(false);
    const [saving, setSaving] = useState(false);
    /**
     * Two-phase load: first navigate to the provider's logout URL so any
     * existing browser session is cleared, then load the actual login page.
     *
     * We use `incognito={true}` on the WebView so the login flow runs in a
     * completely isolated cookie store — separate from both the OS shared
     * cookie store AND any other AutomationWebView instances. Without this,
     * iOS reuses the shared WKWebView data store and the user sees the
     * session of the account that was already active instead of a fresh
     * login form.
     *
     * After successful login we extract the cookies via JS injection and
     * persist them ourselves via storage.saveCookies(), so incognito mode
     * does not lose the session.
     */
    const [phase, setPhase] = useState<"logout" | "login">("logout");
    const webRef = useRef<WebView | null>(null);
    // Guard: only transition from logout→login once, even if onLoadEnd fires
    // multiple times (redirect chains can fire it more than once).
    const logoutLoadedRef = useRef(false);

    useEffect(() => {
      if (!provider) {
        router.back();
      }
    }, [provider]);

    if (!provider) return null;

    function handleMessage(e: WebViewMessageEvent) {
      try {
        const parsed = JSON.parse(e.nativeEvent.data) as {
          type: string;
          payload?: { cookie?: string; email?: string; url?: string };
        };
        if (parsed.type === "cookies" && parsed.payload?.cookie) {
          setCookies(parsed.payload.cookie);
        } else if (parsed.type === "profile" && parsed.payload?.email) {
          setEmail(parsed.payload.email);
        } else if (parsed.type === "loginDetected") {
          setDetected(true);
        }
      } catch {
        // ignore
      }
    }

    function handleLoadEnd() {
      if (phase === "logout" && !logoutLoadedRef.current) {
        logoutLoadedRef.current = true;
        // Logout page has fully loaded — now switch to the login URL.
        // key={phase} on the WebView forces a full remount so the
        // incognito session is completely fresh for the login URL.
        setPhase("login");
      }
    }

    async function handleSave() {
      if (!detected || saving || !provider) return;
      setSaving(true);
      try {
        // Capture ALL cookies from the OS store via CookieManager — this
        // includes httpOnly session cookies that document.cookie cannot access.
        // Stored as a JSON array so AutomationWebView can restore them with
        // full fidelity (domain, path, httpOnly, secure) via CookieManager.set().
        let cookiesToSave = cookies; // fallback: legacy document.cookie string
        try {
          const allCookies = await CookieManager.getAll();
          const cookieArray = Object.values(allCookies);
          if (cookieArray.length > 0) {
            cookiesToSave = JSON.stringify(cookieArray);
          }
        } catch {
          // CookieManager unavailable — fall back to the document.cookie string
          // captured by loginObserverScript (non-httpOnly cookies only).
        }
        await addAccount({
          providerId: provider.id,
          email: email ?? `${provider.id}@local`,
          cookies: cookiesToSave,
        });
        router.back();
      } finally {
        setSaving(false);
      }
    }

    const sourceUri = phase === "logout" ? provider.logoutUrl : provider.loginUrl;

    return (
      <View
        style={[
          styles.root,
          { backgroundColor: colors.background, paddingTop: insets.top },
        ]}
      >
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.iconBtn,
              { opacity: pressed ? 0.6 : 1 },
            ]}
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
                style={[
                  styles.saveBtnText,
                  {
                    color: detected ? colors.background : colors.textMuted,
                  },
                ]}
              >
                Save
              </Text>
            )}
          </Pressable>
        </View>

        <View style={styles.webWrap}>
          <WebView
            ref={(r) => {
              webRef.current = r;
            }}
            // key forces a full WebView remount when phase changes so the
            // incognito session starts completely fresh for the login URL.
            key={phase}
            source={{ uri: sourceUri }}
            injectedJavaScriptBeforeContentLoaded={
              phase === "login" ? loginObserverScript(provider) : undefined
            }
            onMessage={handleMessage}
            onLoadEnd={handleLoadEnd}
            javaScriptEnabled
            domStorageEnabled
            thirdPartyCookiesEnabled
            // Use the shared OS cookie store (incognito=false) so that after
            // login completes, CookieManager.getAll() can capture ALL cookies
            // including httpOnly session cookies that document.cookie cannot see.
            // Session isolation for the login form is achieved by navigating to
            // the provider's logoutUrl first (the "logout" phase above), which
            // clears the previous session before the login page loads.
            incognito={false}
            sharedCookiesEnabled={true}
            // Disable cache so the logout page is always fetched fresh.
            cacheEnabled={false}
            startInLoadingState
            renderLoading={() => (
              <View
                style={[
                  StyleSheet.absoluteFill,
                  styles.loading,
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
          {phase === "logout" ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                styles.loading,
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
          ) : null}
        </View>

        {phase === "login" ? (
          detected ? (
            <View
              style={[
                styles.footerHint,
                {
                  borderTopColor: colors.border,
                  backgroundColor: colors.elevated,
                  paddingBottom: insets.bottom + 12,
                },
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
                {
                  borderTopColor: colors.border,
                  backgroundColor: colors.elevated,
                  paddingBottom: insets.bottom + 12,
                },
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
    headerCenter: {
      flex: 1,
    },
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
    webWrap: {
      flex: 1,
    },
    loading: { alignItems: "center", justifyContent: "center" },
    loadingText: {
      fontFamily: "Inter_400Regular",
      fontSize: 13,
    },
    footerHint: {
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
