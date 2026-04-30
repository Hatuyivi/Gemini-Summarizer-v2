import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  WebView,
  type WebViewMessageEvent,
} from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApp } from "@/contexts/AppContext";
import { useColors } from "@/hooks/useColors";
import { PROVIDERS, type ProviderId } from "@/lib/providers";
import {
  loginObserverScript,
  selectorPickerScript,
} from "@/lib/webview-scripts";

type Captured = {
  inputSelector?: string;
  inputPreview?: string;
  sendButtonSelector?: string;
  sendPreview?: string;
  responseSelector?: string;
  responsePreview?: string;
};

export default function TrainerScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { providerId } = useLocalSearchParams<{ providerId: ProviderId }>();
  const provider = providerId ? PROVIDERS[providerId] : null;
  const { selectors, setCustomSelector, clearCustomSelectors } = useApp();

  const [captured, setCaptured] = useState<Captured>(() => ({
    inputSelector: selectors[providerId ?? ""]?.inputSelector,
    sendButtonSelector: selectors[providerId ?? ""]?.sendButtonSelector,
    responseSelector: selectors[providerId ?? ""]?.responseSelector,
  }));
  const [pickerActive, setPickerActive] = useState(false);
  const webRef = useRef<WebView | null>(null);

  useEffect(() => {
    if (!provider) router.back();
  }, [provider]);

  if (!provider) return null;

  function startPicker() {
    if (!webRef.current) return;
    setPickerActive(true);
    webRef.current.injectJavaScript(selectorPickerScript());
  }

  function stopPicker() {
    setPickerActive(false);
    webRef.current?.injectJavaScript(
      `(function(){ try { window.__macPickerCleanup && window.__macPickerCleanup(); } catch(e){} })(); true;`,
    );
  }

  function handleMessage(e: WebViewMessageEvent) {
    try {
      const parsed = JSON.parse(e.nativeEvent.data) as {
        type: string;
        payload?: { mode?: string; selector?: string; text?: string };
      };
      if (parsed.type === "selector:picked" && parsed.payload?.selector) {
        const { mode, selector, text } = parsed.payload;
        const preview = (text ?? "").trim().slice(0, 40);
        setCaptured((prev) => {
          if (mode === "input")
            return { ...prev, inputSelector: selector, inputPreview: preview };
          if (mode === "send")
            return { ...prev, sendButtonSelector: selector, sendPreview: preview };
          if (mode === "response")
            return { ...prev, responseSelector: selector, responsePreview: preview };
          return prev;
        });
      } else if (parsed.type === "selector:cancel") {
        setPickerActive(false);
      }
    } catch {
      // ignore
    }
  }

  async function handleSave() {
    if (!provider) return;
    const patch = {
      inputSelector: captured.inputSelector,
      sendButtonSelector: captured.sendButtonSelector,
      responseSelector: captured.responseSelector,
    };
    await setCustomSelector(provider.id, patch);
    Alert.alert("Saved", "Selectors saved. Try sending a message again.");
    router.back();
  }

  async function handleReset() {
    if (!provider) return;
    Alert.alert(
      "Reset",
      "Clear custom selectors for this provider and use defaults?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: async () => {
            await clearCustomSelectors(provider.id);
            setCaptured({});
          },
        },
      ],
    );
  }

  const Status = ({
    label,
    value,
    preview,
  }: {
    label: string;
    value?: string;
    preview?: string;
  }) => (
    <View style={[styles.statusItem, { borderColor: colors.border }]}>
      <View style={styles.statusHeader}>
        <Feather
          name={value ? "check-circle" : "circle"}
          size={14}
          color={value ? colors.success : colors.textMuted}
        />
        <Text style={[styles.statusLabel, { color: colors.foreground }]}>
          {label}
        </Text>
      </View>
      {value ? (
        <Text
          style={[styles.statusPreview, { color: colors.mutedForeground }]}
          numberOfLines={1}
        >
          {preview || value}
        </Text>
      ) : (
        <Text style={[styles.statusPreview, { color: colors.textMuted }]}>
          Not set
        </Text>
      )}
    </View>
  );

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
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Teach {provider.name}
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Tap parts of the page to map them
          </Text>
        </View>
        <Pressable
          onPress={handleSave}
          style={({ pressed }) => [
            styles.saveBtn,
            {
              backgroundColor: colors.foreground,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Text style={[styles.saveBtnText, { color: colors.background }]}>
            Save
          </Text>
        </Pressable>
      </View>

      <View style={styles.statusRow}>
        <Status
          label="Input"
          value={captured.inputSelector}
          preview={captured.inputPreview}
        />
        <Status
          label="Send"
          value={captured.sendButtonSelector}
          preview={captured.sendPreview}
        />
        <Status
          label="Response"
          value={captured.responseSelector}
          preview={captured.responsePreview}
        />
      </View>

      <View style={styles.webWrap}>
        <WebView
          ref={(r) => {
            webRef.current = r;
          }}
          source={{ uri: provider.chatUrl }}
          injectedJavaScriptBeforeContentLoaded={loginObserverScript(provider)}
          onMessage={handleMessage}
          javaScriptEnabled
          domStorageEnabled
          thirdPartyCookiesEnabled
          sharedCookiesEnabled
          cacheEnabled
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

      <View
        style={[
          styles.bottomBar,
          {
            borderTopColor: colors.border,
            backgroundColor: colors.background,
            paddingBottom: insets.bottom + 10,
          },
        ]}
      >
        <Pressable
          onPress={handleReset}
          style={({ pressed }) => [
            styles.resetBtn,
            {
              borderColor: colors.border,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Feather name="rotate-ccw" size={14} color={colors.mutedForeground} />
          <Text style={[styles.resetBtnText, { color: colors.mutedForeground }]}>
            Reset
          </Text>
        </Pressable>
        <Pressable
          onPress={pickerActive ? stopPicker : startPicker}
          style={({ pressed }) => [
            styles.pickBtn,
            {
              backgroundColor: pickerActive ? colors.destructive : colors.foreground,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Feather
            name={pickerActive ? "x-circle" : "crosshair"}
            size={16}
            color={colors.background}
          />
          <Text style={[styles.pickBtnText, { color: colors.background }]}>
            {pickerActive ? "Stop picking" : "Start picking"}
          </Text>
        </Pressable>
      </View>
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
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontFamily: "Inter_700Bold", fontSize: 16 },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    marginTop: 2,
  },
  saveBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
  },
  saveBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  statusRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  statusItem: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 12,
    gap: 4,
  },
  statusHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statusLabel: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  statusPreview: { fontFamily: "Inter_400Regular", fontSize: 11 },
  webWrap: { flex: 1 },
  loading: { alignItems: "center", justifyContent: "center" },
  bottomBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  resetBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  resetBtnText: { fontFamily: "Inter_500Medium", fontSize: 13 },
  pickBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
  },
  pickBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
});
