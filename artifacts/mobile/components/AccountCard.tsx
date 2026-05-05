import { Feather } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import { PROVIDERS } from "@/lib/providers";
import type { AIAccount } from "@/lib/types";

interface Props {
  account: AIAccount;
  isActive: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onRefreshSession?: () => void;
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "now";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, "0")}s`;
  return `${s}s`;
}

function useCountdown(target: number | undefined): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    // Tick every second so the seconds digit updates smoothly. Cheap —
    // single setInterval per visible card.
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [target]);
  if (!target) return null;
  return formatCountdown(target - now);
}

export function AccountCard({ account, isActive, onSelect, onRemove, onRefreshSession }: Props) {
  const colors = useColors();
  const provider = PROVIDERS[account.providerId];
  const usagePct = Math.min(
    1,
    account.messagesUsedToday / Math.max(1, account.estimatedDailyLimit),
  );
  const remaining = Math.max(
    0,
    account.estimatedDailyLimit - account.messagesUsedToday,
  );

  // Monochrome status indicator: white = active, dim grey = limited,
  // muted red only when the account is properly broken (expired/disabled).
  // Keeps the whole card on the black/white axis like Claude.
  const statusColor =
    account.status === "active"
      ? colors.foreground
      : account.status === "limit"
      ? colors.textMuted
      : colors.destructive;
  const statusLabel =
    account.status === "active"
      ? "Connected"
      : account.status === "limit"
      ? "Limit reached"
      : account.status === "expired"
      ? "Session expired"
      : "Disabled";

  const countdown = useCountdown(
    account.status === "limit" ? account.limitResetAt : undefined,
  );

  return (
    <Pressable
      onPress={onSelect}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.elevated,
          borderColor: isActive ? colors.foreground : colors.border,
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <View style={[styles.providerBadge, { borderColor: colors.borderStrong }]}>
            <Text
              style={[styles.providerInitial, { color: colors.foreground }]}
            >
              {provider.name.charAt(0)}
            </Text>
          </View>
          <View style={styles.headerText}>
            <Text style={[styles.providerName, { color: colors.foreground }]}>
              {provider.name}
            </Text>
            <Text
              style={[styles.email, { color: colors.mutedForeground }]}
              numberOfLines={1}
            >
              {account.email}
            </Text>
          </View>
        </View>
        <Pressable
          onPress={onRemove}
          hitSlop={10}
          style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}
        >
          <Feather name="trash-2" size={16} color={colors.textMuted} />
        </Pressable>
      </View>

      <View style={styles.metaRow}>
        <View style={styles.statusPill}>
          <View style={[styles.dot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusText, { color: colors.mutedForeground }]}>
            {statusLabel}
          </Text>
        </View>
        <Text style={[styles.timeText, { color: colors.textMuted }]}>
          {formatRelative(account.lastActiveAt)}
        </Text>
      </View>

      <View style={styles.usageRow}>
        <View
          style={[
            styles.usageTrack,
            { backgroundColor: colors.raised, borderColor: colors.border },
          ]}
        >
          <View
            style={[
              styles.usageFill,
              {
                width: `${usagePct * 100}%`,
                backgroundColor: colors.foreground,
                opacity: usagePct >= 0.95 ? 0.4 : usagePct >= 0.7 ? 0.7 : 1,
              },
            ]}
          />
        </View>
        <Text style={[styles.usageLabel, { color: colors.mutedForeground }]}>
          ~{remaining} left
        </Text>
      </View>

      {countdown ? (
        <View style={[styles.countdownRow, { borderTopColor: colors.border }]}>
          <Feather name="clock" size={12} color={colors.mutedForeground} />
          <Text
            style={[styles.countdownText, { color: colors.mutedForeground }]}
          >
            Resets in {countdown}
          </Text>
        </View>
      ) : null}

      {isActive ? (
        <View style={styles.activeRow}>
          <Feather name="check" size={12} color={colors.foreground} />
          <Text
            style={[styles.activeLabel, { color: colors.foreground }]}
          >
            Active
          </Text>
        </View>
      ) : null}

      {account.status === "expired" && onRefreshSession ? (
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            onRefreshSession();
          }}
          style={({ pressed }) => [
            styles.refreshBtn,
            {
              backgroundColor: colors.raised,
              borderColor: colors.destructive + "55",
              opacity: pressed ? 0.75 : 1,
            },
          ]}
        >
          <Feather name="refresh-cw" size={13} color={colors.destructive} />
          <Text style={[styles.refreshBtnText, { color: colors.destructive }]}>
            Refresh session
          </Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  headerText: {
    flex: 1,
  },
  providerBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  providerInitial: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
  },
  providerName: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
  },
  email: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    marginTop: 2,
    maxWidth: 220,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
  },
  timeText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
  },
  usageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  usageTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    borderWidth: 1,
  },
  usageFill: {
    height: "100%",
    borderRadius: 3,
  },
  usageLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    minWidth: 56,
    textAlign: "right",
  },
  countdownRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  countdownText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
  },
  activeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  activeLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
  },
  refreshBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
});
