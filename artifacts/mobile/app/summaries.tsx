import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApp } from "@/contexts/AppContext";
import { useColors } from "@/hooks/useColors";
import type { SummaryBlock } from "@/lib/types";

function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString()} · ${d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

export default function SummariesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { summaryBlocks, clearSummaryBlocks } = useApp();

  function handleClear() {
    if (summaryBlocks.length === 0) return;
    Alert.alert(
      "Clear summary blocks",
      `Delete all ${summaryBlocks.length} stored memory blocks? The live rolling memory used during chats is unaffected.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => clearSummaryBlocks(),
        },
      ],
    );
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
          <Feather name="chevron-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Memory blocks
        </Text>
        <Pressable
          onPress={handleClear}
          disabled={summaryBlocks.length === 0}
          style={({ pressed }) => [
            styles.iconBtn,
            { opacity: summaryBlocks.length === 0 ? 0.3 : pressed ? 0.6 : 1 },
          ]}
          hitSlop={10}
        >
          <Feather name="trash-2" size={18} color={colors.destructive} />
        </Pressable>
      </View>

      {summaryBlocks.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Feather name="layers" size={28} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            No memory blocks yet
          </Text>
          <Text
            style={[styles.emptyText, { color: colors.mutedForeground }]}
          >
            A block is created every time the chat is compressed — either
            automatically when switching accounts, or manually from Settings →
            Compress now.
          </Text>
        </View>
      ) : (
        <FlatList
          data={summaryBlocks}
          keyExtractor={(b) => b.id}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + 24 },
          ]}
          renderItem={({ item }) => <BlockCard block={item} />}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        />
      )}
    </View>
  );
}

function BlockCard({ block }: { block: SummaryBlock }) {
  const colors = useColors();
  const sourceLabel =
    block.source === "user-key" ? "your Gemini key" : "built-in Gemini";
  const sourceColor =
    block.source === "user-key" ? colors.primary : colors.warning;
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.elevated, borderColor: colors.border },
      ]}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <Feather name="archive" size={14} color={colors.mutedForeground} />
          <Text
            style={[styles.cardDate, { color: colors.mutedForeground }]}
          >
            {formatTime(block.createdAt)}
          </Text>
        </View>
        <View
          style={[
            styles.sourceBadge,
            { borderColor: sourceColor },
          ]}
        >
          <Text style={[styles.sourceText, { color: sourceColor }]}>
            via {sourceLabel}
          </Text>
        </View>
      </View>

      <View style={styles.statsRow}>
        <Stat
          icon="git-merge"
          value={String(block.compactedCount)}
          label="compacted"
        />
        <Stat
          icon="message-square"
          value={String(block.remainingCount)}
          label="kept"
        />
        {block.tone ? (
          <Stat icon="smile" value={block.tone} label="tone" wide />
        ) : null}
      </View>

      <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>
        SUMMARY
      </Text>
      <Text style={[styles.summaryBody, { color: colors.foreground }]}>
        {block.summary}
      </Text>

      {block.important_data.length > 0 ? (
        <>
          <Text
            style={[
              styles.summaryLabel,
              { color: colors.mutedForeground, marginTop: 12 },
            ]}
          >
            IMPORTANT DATA
          </Text>
          <View style={styles.bulletList}>
            {block.important_data.map((d, i) => (
              <View key={i} style={styles.bulletRow}>
                <View
                  style={[
                    styles.bullet,
                    { backgroundColor: colors.mutedForeground },
                  ]}
                />
                <Text
                  style={[styles.bulletText, { color: colors.foreground }]}
                >
                  {d}
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

function Stat({
  icon,
  value,
  label,
  wide,
}: {
  icon: keyof typeof Feather.glyphMap;
  value: string;
  label: string;
  wide?: boolean;
}) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.stat,
        wide ? { flex: 1 } : null,
        { backgroundColor: colors.raised, borderColor: colors.border },
      ]}
    >
      <Feather name={icon} size={12} color={colors.mutedForeground} />
      <View style={styles.statText}>
        <Text
          style={[styles.statValue, { color: colors.foreground }]}
          numberOfLines={1}
        >
          {value}
        </Text>
        <Text
          style={[styles.statLabel, { color: colors.mutedForeground }]}
        >
          {label}
        </Text>
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
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 8,
  },
  emptyTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
    marginTop: 8,
  },
  emptyText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
  },
  list: {
    padding: 16,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 8,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  cardDate: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
  },
  sourceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  sourceText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 10,
    letterSpacing: 0.3,
  },
  statsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
    marginBottom: 4,
  },
  stat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  statText: { flexShrink: 1 },
  statValue: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
  },
  statLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 10,
  },
  summaryLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 10,
    letterSpacing: 1,
    marginTop: 6,
  },
  summaryBody: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  bulletList: {
    marginTop: 4,
    gap: 4,
  },
  bulletRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
  },
  bullet: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 7,
  },
  bulletText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 17,
  },
});
