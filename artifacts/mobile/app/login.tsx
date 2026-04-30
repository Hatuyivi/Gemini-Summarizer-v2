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
  const webRef = useRef<WebView | null>(null);

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

  async function handleSave() {
    if (!cookies || saving || !provider) return;
    setSaving(true);
    try {
      await addAccount({
        providerId: provider.id,
        email: email ?? `${provider.id}@local`,
        cookies,
      });
      router.back();
    } finally {
      setSaving(false);
    }
  }

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
                  backgroundColor: detected ? colors.success : colors.textMuted,
                },
              ]}
            />
            <Text style={[styles.statusText, { color: colors.mutedForeground }]}>
              {detected
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
          source={{ uri: provider.loginUrl }}
          injectedJavaScriptBeforeContentLoaded={loginObserverScript(provider)}
          onMessage={handleMessage}
          javaScriptEnabled
          domStorageEnabled
          thirdPartyCookiesEnabled
          sharedCookiesEnabled
          cacheEnabled
          incognito={false}
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
      </View>

      {detected ? (
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
      )}
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
