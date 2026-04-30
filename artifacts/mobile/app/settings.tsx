import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useState } from "react";

import { useApp } from "@/contexts/AppContext";
import { useColors } from "@/hooks/useColors";
import { storage } from "@/lib/storage";
import type { GeminiApiKey } from "@/lib/types";

/** Mask a key as `AIza••••XYZ7` for display in lists. */
function maskKey(k: string): string {
  if (k.length <= 8) return "••••";
  return `${k.slice(0, 4)}••••${k.slice(-4)}`;
}

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    messages,
    accounts,
    summary,
    summaryBlocks,
    geminiKeys,
    activeGeminiKey,
    addGeminiKey,
    removeGeminiKey,
    setActiveGeminiKey,
    clearChat,
    compressIfNeeded,
  } = useApp();
  const [compressing, setCompressing] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newKey, setNewKey] = useState("");
  const [adding, setAdding] = useState(false);

  async function handleCompress() {
    if (compressing) return;
    setCompressing(true);
    try {
      const result = await compressIfNeeded();
      if (result.status === "compressed") {
        Alert.alert(
          "Memory compressed",
          `Summarized ${result.compactedCount} older messages. ${result.remainingCount} recent messages kept verbatim.`,
        );
      } else if (result.status === "not-needed") {
        Alert.alert(
          "Nothing to compress",
          `Compression kicks in once the chat reaches ${result.threshold} messages. You currently have ${result.messageCount}.`,
        );
      } else if (result.status === "no-old") {
        Alert.alert(
          "Nothing to compress",
          "All messages are already in the recent window.",
        );
      } else {
        Alert.alert("Compression failed", result.error);
      }
    } finally {
      setCompressing(false);
    }
  }

  function handleClearChat() {
    Alert.alert(
      "Clear conversation",
      "This deletes the local message history and the compressed memory. Your accounts stay connected.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => clearChat(),
        },
      ],
    );
  }

  function handleLogoutAll() {
    Alert.alert(
      "Log out of everything",
      "This removes all accounts, encrypted session cookies, Gemini keys, and local chat data from this device.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Wipe",
          style: "destructive",
          onPress: async () => {
            await storage.clearAll();
            router.replace("/");
          },
        },
      ],
    );
  }

  async function handleAddKey() {
    if (adding) return;
    const trimmed = newKey.trim();
    if (!trimmed) {
      Alert.alert("Missing key", "Paste a Gemini API key first.");
      return;
    }
    setAdding(true);
    try {
      await addGeminiKey({ label: newLabel, key: trimmed });
      setNewLabel("");
      setNewKey("");
    } catch (e) {
      Alert.alert(
        "Could not add key",
        e instanceof Error ? e.message : "Unknown error",
      );
    } finally {
      setAdding(false);
    }
  }

  function handleRemoveKey(k: GeminiApiKey) {
    Alert.alert(
      "Remove key",
      `Delete "${k.label}"? Summaries will use the next available key, or fall back to the built-in Gemini integration.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => removeGeminiKey(k.id),
        },
      ],
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.iconBtn,
            { opacity: pressed ? 0.6 : 1 },
          ]}
          hitSlop={10}
        >
          <Feather name="chevron-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Settings
        </Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
      >
        <Section title="Overview">
          <Stat
            icon="users"
            label="Connected accounts"
            value={String(accounts.length)}
          />
          <Stat
            icon="message-square"
            label="Local messages"
            value={String(messages.length)}
          />
          <Stat
            icon="archive"
            label="Memory blocks"
            value={String(summaryBlocks.length + (summary ? 1 : 0))}
          />
          <Stat
            icon="key"
            label="Saved Gemini keys"
            value={String(geminiKeys.length)}
          />
        </Section>

        <Section title="Memory">
          <Row
            icon="cpu"
            title={compressing ? "Compressing…" : "Compress now"}
            subtitle="Summarize older messages to keep context lean."
            onPress={handleCompress}
          />
          <Row
            icon="layers"
            title="View summary blocks"
            subtitle={
              summaryBlocks.length === 0
                ? "No summaries yet — they appear here after compressions."
                : `Browse the ${summaryBlocks.length} stored memory block${summaryBlocks.length === 1 ? "" : "s"}.`
            }
            onPress={() => router.push("/summaries")}
          />
          <Row
            icon="trash"
            title="Clear conversation"
            subtitle="Delete local chat history and compressed memory."
            destructive
            onPress={handleClearChat}
          />
        </Section>

        <Section title="Gemini API keys">
          <View
            style={[
              styles.keyHeader,
              { borderBottomColor: colors.border },
            ]}
          >
            <Feather name="info" size={14} color={colors.mutedForeground} />
            <Text style={[styles.keyHeaderText, { color: colors.mutedForeground }]}>
              {activeGeminiKey
                ? `Active: ${activeGeminiKey.label} (${maskKey(activeGeminiKey.key)})`
                : "No key — using built-in Gemini integration."}
            </Text>
          </View>

          {geminiKeys.length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Add a free-tier Gemini API key from Google AI Studio to use your
              own quota for summaries. Without a key, the app falls back to the
              built-in Gemini integration.
            </Text>
          ) : (
            geminiKeys.map((k) => {
              const isActive = activeGeminiKey?.id === k.id;
              return (
                <View
                  key={k.id}
                  style={[styles.keyRow, { borderBottomColor: colors.border }]}
                >
                  <Pressable
                    onPress={() => setActiveGeminiKey(isActive ? null : k.id)}
                    style={({ pressed }) => [
                      styles.keyMain,
                      { opacity: pressed ? 0.7 : 1 },
                    ]}
                  >
                    <View
                      style={[
                        styles.radio,
                        {
                          borderColor: isActive ? colors.primary : colors.border,
                          backgroundColor: isActive
                            ? colors.primary
                            : "transparent",
                        },
                      ]}
                    >
                      {isActive ? (
                        <Feather
                          name="check"
                          size={12}
                          color={colors.primaryForeground}
                        />
                      ) : null}
                    </View>
                    <View style={styles.keyText}>
                      <Text
                        style={[styles.keyLabel, { color: colors.foreground }]}
                        numberOfLines={1}
                      >
                        {k.label}
                      </Text>
                      <Text
                        style={[
                          styles.keyMasked,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        {maskKey(k.key)}
                        {k.lastUsedAt
                          ? ` · used ${new Date(k.lastUsedAt).toLocaleDateString()}`
                          : ""}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable
                    onPress={() => handleRemoveKey(k)}
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.keyDelete,
                      { opacity: pressed ? 0.6 : 1 },
                    ]}
                  >
                    <Feather
                      name="trash-2"
                      size={16}
                      color={colors.destructive}
                    />
                  </Pressable>
                </View>
              );
            })
          )}

          <View style={styles.addKeyForm}>
            <TextInput
              value={newLabel}
              onChangeText={setNewLabel}
              placeholder="Label (e.g. Personal)"
              placeholderTextColor={colors.textMuted}
              style={[
                styles.input,
                {
                  backgroundColor: colors.raised,
                  borderColor: colors.border,
                  color: colors.foreground,
                },
              ]}
              autoCapitalize="none"
            />
            <TextInput
              value={newKey}
              onChangeText={setNewKey}
              placeholder="AIza..."
              placeholderTextColor={colors.textMuted}
              style={[
                styles.input,
                {
                  backgroundColor: colors.raised,
                  borderColor: colors.border,
                  color: colors.foreground,
                },
              ]}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <Pressable
              onPress={handleAddKey}
              disabled={adding}
              style={({ pressed }) => [
                styles.addBtn,
                {
                  backgroundColor: colors.primary,
                  opacity: pressed || adding ? 0.7 : 1,
                },
              ]}
            >
              <Feather
                name="plus"
                size={14}
                color={colors.primaryForeground}
              />
              <Text
                style={[styles.addBtnText, { color: colors.primaryForeground }]}
              >
                {adding ? "Adding…" : "Add Gemini key"}
              </Text>
            </Pressable>
          </View>
        </Section>

        <Section title="Security">
          <Row
            icon="shield"
            title="Storage"
            subtitle="Session cookies and Gemini keys are encrypted in the device keystore. Passwords are never stored."
          />
          <Row
            icon="log-out"
            title="Log out of everything"
            subtitle="Remove all accounts, keys, and wipe local data."
            destructive
            onPress={handleLogoutAll}
          />
        </Section>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.textMuted }]}>
            AI Hub Manager
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
        {title.toUpperCase()}
      </Text>
      <View
        style={[
          styles.sectionInner,
          { backgroundColor: colors.elevated, borderColor: colors.border },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
}) {
  const colors = useColors();
  return (
    <View style={[styles.statRow, { borderBottomColor: colors.border }]}>
      <View style={styles.statLeft}>
        <Feather name={icon} size={16} color={colors.mutedForeground} />
        <Text style={[styles.statLabel, { color: colors.foreground }]}>
          {label}
        </Text>
      </View>
      <Text style={[styles.statValue, { color: colors.foreground }]}>
        {value}
      </Text>
    </View>
  );
}

function Row({
  icon,
  title,
  subtitle,
  destructive,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  subtitle: string;
  destructive?: boolean;
  onPress?: () => void;
}) {
  const colors = useColors();
  const tint = destructive ? colors.destructive : colors.foreground;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.row,
        {
          borderBottomColor: colors.border,
          opacity: pressed && onPress ? 0.7 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.rowIcon,
          {
            backgroundColor: colors.raised,
            borderColor: colors.border,
          },
        ]}
      >
        <Feather name={icon} size={16} color={tint} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: tint }]}>{title}</Text>
        <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
          {subtitle}
        </Text>
      </View>
      {onPress ? (
        <Feather name="chevron-right" size={16} color={colors.textMuted} />
      ) : null}
    </Pressable>
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
  title: {
    flex: 1,
    fontFamily: "Inter_700Bold",
    fontSize: 18,
  },
  scroll: {
    paddingTop: 18,
    paddingHorizontal: 16,
    gap: 24,
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    letterSpacing: 1,
    paddingHorizontal: 4,
  },
  sectionInner: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  statRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  statLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
  },
  statValue: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  rowSubtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 16,
  },
  keyHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  keyHeaderText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    flex: 1,
  },
  emptyText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  keyRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  keyMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  keyText: {
    flex: 1,
    gap: 2,
  },
  keyLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  keyMasked: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
  },
  keyDelete: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  addKeyForm: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
    gap: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: "Inter_400Regular",
    fontSize: 13,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 11,
    borderRadius: 8,
    marginTop: 4,
  },
  addBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  footer: {
    alignItems: "center",
    paddingTop: 18,
  },
  footerText: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    letterSpacing: 0.5,
  },
});
