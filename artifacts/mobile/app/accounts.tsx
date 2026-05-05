import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccountCard } from "@/components/AccountCard";
import { useApp } from "@/contexts/AppContext";
import { useColors } from "@/hooks/useColors";
import { PROVIDER_LIST, type ProviderId } from "@/lib/providers";

export default function AccountsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    accounts,
    activeAccount,
    setActiveAccount,
    removeAccount,
  } = useApp();

  const [picker, setPicker] = useState(false);

  function handleAdd(providerId: ProviderId) {
    setPicker(false);
    void Haptics.selectionAsync();
    router.push({ pathname: "/login", params: { providerId } });
  }

  function confirmRemove(id: string, label: string) {
    Alert.alert(
      "Remove account",
      `Remove ${label}? You'll need to log in again to use it.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => removeAccount(id),
        },
      ],
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.6 : 1 }]}
          hitSlop={10}
        >
          <Feather name="chevron-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Accounts
        </Text>
        <Pressable
          onPress={() => setPicker(true)}
          style={({ pressed }) => [
            styles.addBtn,
            {
              backgroundColor: colors.foreground,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Feather name="plus" size={16} color={colors.background} />
        </Pressable>
      </View>

      <FlatList
        data={accounts}
        keyExtractor={(a) => a.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        ListEmptyComponent={<EmptyAccounts onAdd={() => setPicker(true)} />}
        renderItem={({ item }) => (
          <AccountCard
            account={item}
            isActive={activeAccount?.id === item.id}
            onSelect={async () => {
              void Haptics.selectionAsync();
              await setActiveAccount(item.id);
              router.back();
            }}
            onRemove={() => confirmRemove(item.id, item.email)}
            onRefreshSession={() => {
              void Haptics.selectionAsync();
              router.push({
                pathname: "/login",
                params: { providerId: item.providerId },
              });
            }}
          />
        )}
      />

      {picker ? (
        <Animated.View
          entering={FadeIn.duration(180)}
          exiting={FadeOut.duration(150)}
          style={styles.pickerOverlay}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPicker(false)} />
          <View
            style={[
              styles.pickerSheet,
              {
                backgroundColor: colors.elevated,
                borderColor: colors.border,
                paddingBottom: insets.bottom + 16,
              },
            ]}
          >
            <View style={styles.pickerHandle}>
              <View style={[styles.handleBar, { backgroundColor: colors.borderStrong }]} />
            </View>
            <Text style={[styles.pickerTitle, { color: colors.foreground }]}>
              Choose a provider
            </Text>
            <Text style={[styles.pickerSubtitle, { color: colors.mutedForeground }]}>
              You'll log in inside a secure WebView. Only your session cookie
              is stored on this device.
            </Text>
            <View style={{ height: 12 }} />
            {PROVIDER_LIST.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => handleAdd(p.id)}
                style={({ pressed }) => [
                  styles.pickerItem,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.raised,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <View style={[styles.pickerBadge, { borderColor: colors.border }]}>
                  <Text style={[styles.pickerBadgeText, { color: colors.foreground }]}>
                    {p.name.charAt(0)}
                  </Text>
                </View>
                <Text style={[styles.pickerItemName, { color: colors.foreground }]}>
                  {p.name}
                </Text>
                <Feather name="chevron-right" size={16} color={colors.textMuted} />
              </Pressable>
            ))}
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

function EmptyAccounts({ onAdd }: { onAdd: () => void }) {
  const colors = useColors();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyMark, { borderColor: colors.borderStrong }]}>
        <Feather name="user-plus" size={26} color={colors.foreground} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
        No accounts yet
      </Text>
      <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
        Connect ChatGPT, Claude, Gemini or Perplexity. You log in once — we
        keep the session encrypted on your device.
      </Text>
      <Pressable
        onPress={onAdd}
        style={({ pressed }) => [
          styles.cta,
          {
            backgroundColor: colors.foreground,
            opacity: pressed ? 0.9 : 1,
          },
        ]}
      >
        <Feather name="plus" size={16} color={colors.background} />
        <Text style={[styles.ctaText, { color: colors.background }]}>
          Connect account
        </Text>
      </Pressable>
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
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  list: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 80,
    flexGrow: 1,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingTop: 60,
    gap: 14,
  },
  emptyMark: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  emptyTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 20,
    textAlign: "center",
  },
  emptyBody: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 320,
  },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 14,
    marginTop: 6,
  },
  ctaText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  pickerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  pickerSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 8,
  },
  pickerHandle: {
    alignItems: "center",
    paddingVertical: 8,
  },
  handleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  pickerTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 18,
  },
  pickerSubtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 18,
  },
  pickerItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: 14,
    marginBottom: 8,
  },
  pickerBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  pickerBadgeText: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
  },
  pickerItemName: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    flex: 1,
  },
});
