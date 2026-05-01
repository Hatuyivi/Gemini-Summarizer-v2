import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MessageBubble } from "@/components/MessageBubble";
import { TypingIndicator } from "@/components/TypingIndicator";
import {
  AutomationWebView,
  type AutomationEvent,
  type AutomationHandle,
} from "@/components/AutomationWebView";
import { useApp } from "@/contexts/AppContext";
import { useColors } from "@/hooks/useColors";
import { PROVIDERS } from "@/lib/providers";
import { storage } from "@/lib/storage";
import type { ChatMessage } from "@/lib/types";

const LIVE_VIEW_HEIGHT = 220;

export default function ChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    ready,
    accounts,
    activeAccount,
    messages,
    isAssistantTyping,
    appendMessage,
    updateMessage,
    bumpAccountUsage,
    markAccountStatus,
    rotateToNextAvailable,
    setAssistantTyping,
    compressIfNeeded,
    getResolvedProvider,
    chatUrls,
    setChatUrl,
    consumePendingContextSeed,
  } = useApp();

  const [input, setInput] = useState("");
  const [attachedImage, setAttachedImage] = useState<{
    uri: string;
    base64: string;
    mime: string;
  } | null>(null);
  const [activeCookies, setActiveCookies] = useState<string | null>(null);
  const [liveView, setLiveView] = useState(false);
  const automationRef = useRef<AutomationHandle | null>(null);
  const pendingAssistantId = useRef<string | null>(null);
  const pendingFallbackPrompt = useRef<string | null>(null);
  const pendingFallbackImage = useRef<string | null>(null);
  // Queued prompt that must be sent AFTER an account-rotation completes
  // (i.e. once the new account's WebView has remounted with cookies loaded).
  const [pendingSend, setPendingSend] = useState<{
    prompt: string;
    imageDataUrl: string | null;
    forAccountId: string;
    placeholderId: string;
  } | null>(null);

  // Reverse for inverted list — newest at index 0
  const inverted = useMemo(() => [...messages].reverse(), [messages]);

  // Lock the composer while a reply is in-flight (typing, streaming, or
  // mid-rotation). Prevents queuing overlapping prompts that would race
  // each other inside the WebView.
  const isBusy = isAssistantTyping || pendingSend !== null;

  // IMPORTANT: depend on `activeAccount?.id`, not the object reference.
  // `accounts` is mutated on every `bumpAccountUsage` (after every reply),
  // which produces a new `activeAccount` object even though the id is
  // unchanged. Keying on the object would unmount the WebView and reload
  // the chat URL — opening a NEW chat in the bot for each message.
  useEffect(() => {
    const id = activeAccount?.id;
    if (!id) {
      setActiveCookies(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const c = await storage.loadCookies(id);
      if (!cancelled) setActiveCookies(c);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeAccount?.id]);

  const handleAutomationEvent = useCallback(
    async (e: AutomationEvent) => {
      const id = pendingAssistantId.current;
      if (e.type === "stage") return;
      if (e.type === "log") return;

      if (e.type === "response" && id) {
        updateMessage(id, {
          content: e.text ?? "",
          status: "sent",
        });
        pendingAssistantId.current = null;
        pendingFallbackPrompt.current = null;
        setAssistantTyping(false);
        if (activeAccount) await bumpAccountUsage(activeAccount.id);
        await compressIfNeeded();
        return;
      }

      if (e.type === "limit" && id) {
        if (activeAccount)
          await markAccountStatus(activeAccount.id, "limit", e.resetAtMs);
        const promptToReplay = pendingFallbackPrompt.current;
        const imageToReplay = pendingFallbackImage.current;
        const next = await rotateToNextAvailable();
        if (next && promptToReplay) {
          // Re-attribute the placeholder bubble to the new account/provider
          // so the in-app history shows the response under the right bot.
          updateMessage(id, {
            content: `_Switching to ${PROVIDERS[next.providerId].name} — ${next.email}…_`,
            status: "sending",
            providerId: next.providerId,
            accountId: next.id,
          });
          // Clear pending state — the rotation effect below will re-arm it
          // once the new WebView is mounted and its cookies are loaded.
          pendingAssistantId.current = null;
          pendingFallbackPrompt.current = null;
          pendingFallbackImage.current = null;
          setPendingSend({
            prompt: promptToReplay,
            imageDataUrl: imageToReplay,
            forAccountId: next.id,
            placeholderId: id,
          });
        } else {
          updateMessage(id, {
            content: "",
            status: "error",
            errorMessage: "All accounts have reached their limit.",
          });
          pendingAssistantId.current = null;
          pendingFallbackPrompt.current = null;
          setAssistantTyping(false);
        }
        return;
      }

      if (e.type === "error" && id) {
        const msg =
          e.reason === "input_not_found"
            ? "Couldn't reach the chat input. The session may have expired — re-login from Accounts."
            : e.reason === "timeout"
            ? "The assistant didn't respond in time."
            : "Something went wrong.";
        if (e.reason === "input_not_found" && activeAccount) {
          await markAccountStatus(activeAccount.id, "expired");
        }
        updateMessage(id, {
          content: "",
          status: "error",
          errorMessage: msg,
        });
        pendingAssistantId.current = null;
        pendingFallbackPrompt.current = null;
        setAssistantTyping(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeAccount, updateMessage, setAssistantTyping],
  );

  const sendPrompt = useCallback(
    async (prompt: string, imageDataUrl: string | null) => {
      if (!activeAccount) return;

      // SOFT auto-rotation: if our local counter says this account is
      // already exhausted (or it's flagged as `limit` with an unexpired
      // timer), proactively switch BEFORE wasting a prompt that would
      // bounce off the site's own limit error. The chat-screen
      // pendingSend effect handles the actual handoff once the new
      // WebView mounts.
      const softLimited =
        activeAccount.messagesUsedToday >= activeAccount.estimatedDailyLimit ||
        (activeAccount.status === "limit" &&
          typeof activeAccount.limitResetAt === "number" &&
          Date.now() < activeAccount.limitResetAt);

      if (softLimited) {
        await markAccountStatus(activeAccount.id, "limit");
        const next = await rotateToNextAvailable();
        if (next) {
          // Placeholder is attributed to the NEW account so the eventual
          // response shows up under the right provider in history.
          const placeholder = appendMessage({
            role: "assistant",
            content: `_Switching to ${PROVIDERS[next.providerId].name} — ${next.email}…_`,
            providerId: next.providerId,
            accountId: next.id,
            status: "sending",
          });
          setAssistantTyping(true);
          setPendingSend({
            prompt,
            imageDataUrl,
            forAccountId: next.id,
            placeholderId: placeholder.id,
          });
          return;
        }
        // No fallback account → surface the limit to the user instead of
        // silently sending into a dead account.
        appendMessage({
          role: "assistant",
          content: "",
          providerId: activeAccount.providerId,
          accountId: activeAccount.id,
          status: "error",
          errorMessage: "All accounts have reached their limit.",
        });
        setAssistantTyping(false);
        return;
      }

      const placeholder = appendMessage({
        role: "assistant",
        content: "",
        providerId: activeAccount.providerId,
        accountId: activeAccount.id,
        status: "sending",
      });
      pendingAssistantId.current = placeholder.id;
      pendingFallbackPrompt.current = prompt;
      pendingFallbackImage.current = imageDataUrl;
      setAssistantTyping(true);

      // ONE-TIME context handoff after an account switch: prepend the
      // previous-conversation summary to the very first message on the
      // new account so the new bot understands what we were doing.
      // Subsequent messages on the same account go straight through —
      // the bot is already in the running conversation.
      const seed = consumePendingContextSeed(activeAccount.id);
      const ctx = seed
        ? `Context from my previous conversation with another assistant:\n${seed}\n\n---\n\n${prompt}`
        : prompt;

      automationRef.current
        ?.send(ctx, imageDataUrl)
        .catch(() =>
          handleAutomationEvent({ type: "error", reason: "send_failed" }),
        );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      activeAccount,
      appendMessage,
      setAssistantTyping,
      consumePendingContextSeed,
      markAccountStatus,
      rotateToNextAvailable,
    ],
  );

  // After an account rotation, replay the in-flight prompt against the
  // newly active account ONCE its WebView has remounted with cookies.
  // The AutomationWebView will internally queue the prompt until its
  // page finishes loading, so we don't need a brittle setTimeout race.
  useEffect(() => {
    if (!pendingSend) return;
    if (!activeAccount || activeAccount.id !== pendingSend.forAccountId) return;
    if (activeCookies === null) return;  // null = still loading; empty string = no JS-readable cookies (HttpOnly only)
    // Re-arm the response handler against the same placeholder bubble so
    // the next response/limit/error event updates the correct message.
    pendingAssistantId.current = pendingSend.placeholderId;
    pendingFallbackPrompt.current = pendingSend.prompt;
    setAssistantTyping(true);

    // Same context-seed logic as the normal send path: if the auto-rotation
    // produced a handoff summary for this new account, prepend it once.
    const seed = consumePendingContextSeed(activeAccount.id);
    const ctx = seed
      ? `Context from my previous conversation with another assistant:\n${seed}\n\n---\n\n${pendingSend.prompt}`
      : pendingSend.prompt;

    automationRef.current
      ?.send(ctx, pendingSend.imageDataUrl)
      .catch(() =>
        handleAutomationEvent({ type: "error", reason: "send_failed" }),
      );
    pendingFallbackPrompt.current = pendingSend.prompt;
    pendingFallbackImage.current = pendingSend.imageDataUrl;
    setPendingSend(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSend, activeAccount?.id, activeCookies]);

  async function pickImage() {
    void Haptics.selectionAsync();
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      base64: true,
      allowsEditing: false,
    });
    if (res.canceled || !res.assets?.[0]?.base64) return;
    const a = res.assets[0];
    const mime = a.mimeType || "image/jpeg";
    setAttachedImage({
      uri: a.uri,
      base64: a.base64 ?? "",
      mime,
    });
  }

  function handleSubmit() {
    const text = input.trim();
    const img = attachedImage;
    if (!text && !img) return;
    if (!activeAccount) {
      router.push("/accounts");
      return;
    }
    void Haptics.selectionAsync();
    appendMessage({
      role: "user",
      content: text,
      status: "sent",
      imageUri: img?.uri,
    });
    setInput("");
    setAttachedImage(null);
    const dataUrl = img ? `data:${img.mime};base64,${img.base64}` : null;
    sendPrompt(text || "What's in this image?", dataUrl);
  }

  const headerProvider = activeAccount ? PROVIDERS[activeAccount.providerId] : null;

  if (!ready) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.foreground} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Automation WebView for the active account */}
      {activeAccount && activeCookies !== null ? (
        <View
          style={
            liveView
              ? [
                  styles.liveWrap,
                  {
                    height: LIVE_VIEW_HEIGHT,
                    borderColor: colors.border,
                    backgroundColor: colors.elevated,
                  },
                ]
              : styles.offscreen
          }
          pointerEvents={liveView ? "auto" : "none"}
        >
          <AutomationWebView
            key={activeAccount.id}
            ref={automationRef}
            provider={getResolvedProvider(activeAccount.providerId)}
            cookies={activeCookies}
            onEvent={handleAutomationEvent}
            visible={liveView}
            resumeUrl={chatUrls[activeAccount.id] ?? null}
            onUrlChange={(url) => setChatUrl(activeAccount.id, url)}
          />
        </View>
      ) : null}

      {/* Top bar */}
      <View style={[styles.topBar, { borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => router.push("/accounts")}
          style={({ pressed }) => [
            styles.iconBtn,
            { opacity: pressed ? 0.6 : 1 },
          ]}
          hitSlop={10}
        >
          <Feather name="users" size={20} color={colors.foreground} />
        </Pressable>

        <Pressable
          onPress={() => router.push("/accounts")}
          style={({ pressed }) => [
            styles.providerSwitcher,
            {
              backgroundColor: colors.elevated,
              borderColor: colors.border,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          {headerProvider ? (
            <>
              <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
              <Text style={[styles.providerName, { color: colors.foreground }]}>
                {headerProvider.name}
              </Text>
              <Text
                style={[styles.providerEmail, { color: colors.mutedForeground }]}
                numberOfLines={1}
              >
                {activeAccount?.email}
              </Text>
              <Feather
                name="chevron-down"
                size={14}
                color={colors.mutedForeground}
              />
            </>
          ) : (
            <>
              <Feather name="plus-circle" size={14} color={colors.foreground} />
              <Text style={[styles.providerName, { color: colors.foreground }]}>
                Add account
              </Text>
            </>
          )}
        </Pressable>

        {activeAccount ? (
          <Pressable
            onPress={() => setLiveView((v) => !v)}
            style={({ pressed }) => [
              styles.iconBtn,
              {
                opacity: pressed ? 0.6 : 1,
                backgroundColor: liveView ? colors.elevated : "transparent",
                borderRadius: 18,
              },
            ]}
            hitSlop={10}
          >
            <Feather
              name={liveView ? "eye-off" : "eye"}
              size={18}
              color={liveView ? colors.foreground : colors.mutedForeground}
            />
          </Pressable>
        ) : null}

        {activeAccount ? (
          <Pressable
            onPress={() =>
              router.push({
                pathname: "/trainer",
                params: { providerId: activeAccount.providerId },
              })
            }
            style={({ pressed }) => [
              styles.iconBtn,
              { opacity: pressed ? 0.6 : 1 },
            ]}
            hitSlop={10}
          >
            <Feather name="crosshair" size={18} color={colors.mutedForeground} />
          </Pressable>
        ) : null}

        <Pressable
          onPress={() => router.push("/settings")}
          style={({ pressed }) => [
            styles.iconBtn,
            { opacity: pressed ? 0.6 : 1 },
          ]}
          hitSlop={10}
        >
          <Feather name="more-horizontal" size={20} color={colors.foreground} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        behavior="padding"
        style={{ flex: 1 }}
        keyboardVerticalOffset={0}
      >
        <View style={{ flex: 1 }}>
          {messages.length === 0 ? (
            <EmptyChat />
          ) : (
            <FlatList<ChatMessage>
              data={inverted}
              inverted
              keyExtractor={(m) => m.id}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              contentContainerStyle={{ paddingTop: 12, paddingBottom: 12 }}
              ListHeaderComponent={
                isAssistantTyping ? <TypingIndicator /> : null
              }
              renderItem={({ item }) => <MessageBubble message={item} />}
            />
          )}
        </View>

        <View
          style={[
            styles.composer,
            {
              backgroundColor: colors.background,
              borderTopColor: colors.border,
              paddingBottom: insets.bottom > 0 ? insets.bottom : 12,
            },
          ]}
        >
            {attachedImage ? (
              <View
                style={[
                  styles.attachPreview,
                  {
                    backgroundColor: colors.elevated,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Image
                  source={{ uri: attachedImage.uri }}
                  style={styles.attachThumb}
                  contentFit="cover"
                />
                <Text
                  style={[styles.attachLabel, { color: colors.mutedForeground }]}
                  numberOfLines={1}
                >
                  Photo attached
                </Text>
                <Pressable
                  onPress={() => setAttachedImage(null)}
                  hitSlop={10}
                  style={({ pressed }) => [
                    styles.attachClose,
                    { opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <Feather name="x" size={14} color={colors.foreground} />
                </Pressable>
              </View>
            ) : null}
            <View
              style={[
                styles.inputWrap,
                {
                  backgroundColor: colors.elevated,
                  borderColor: colors.border,
                },
              ]}
            >
              <Pressable
                onPress={pickImage}
                disabled={!activeAccount || isBusy}
                hitSlop={6}
                style={({ pressed }) => [
                  styles.attachBtn,
                  {
                    opacity: pressed
                      ? 0.6
                      : activeAccount && !isBusy
                      ? 1
                      : 0.4,
                  },
                ]}
              >
                <Feather
                  name="paperclip"
                  size={18}
                  color={colors.mutedForeground}
                />
              </Pressable>
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder={
                  isBusy
                    ? "Waiting for reply…"
                    : activeAccount
                    ? "Message…"
                    : "Add an account to begin"
                }
                placeholderTextColor={colors.textMuted}
                multiline
                style={[
                  styles.input,
                  {
                    color: colors.foreground,
                    fontFamily: "Inter_400Regular",
                  },
                ]}
                editable={!!activeAccount && !isBusy}
              />
              <Pressable
                onPress={handleSubmit}
                disabled={
                  isBusy ||
                  (!input.trim() && !attachedImage) ||
                  !activeAccount
                }
                style={({ pressed }) => [
                  styles.sendBtn,
                  {
                    backgroundColor:
                      !isBusy &&
                      (input.trim() || attachedImage) &&
                      activeAccount
                        ? colors.foreground
                        : colors.raised,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                {isBusy ? (
                  <ActivityIndicator size="small" color={colors.mutedForeground} />
                ) : (
                  <Feather
                    name="arrow-up"
                    size={18}
                    color={
                      (input.trim() || attachedImage) && activeAccount
                        ? colors.background
                        : colors.textMuted
                    }
                  />
                )}
              </Pressable>
            </View>
            {accounts.length === 0 ? (
              <Pressable
                onPress={() => router.push("/accounts")}
                style={styles.addInline}
              >
                <Feather name="plus" size={14} color={colors.mutedForeground} />
                <Text style={[styles.addInlineText, { color: colors.mutedForeground }]}>
                  Connect an account to start chatting
                </Text>
              </Pressable>
            ) : null}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function EmptyChat() {
  const colors = useColors();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyMark, { borderColor: colors.borderStrong }]}>
        <Feather name="message-circle" size={28} color={colors.foreground} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
        One conversation. Every model.
      </Text>
      <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
        Connect your AI accounts and chat through one unified interface.
        Context follows you when you switch.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  liveWrap: {
    marginHorizontal: 12,
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 14,
    overflow: "hidden",
  },
  offscreen: {
    position: "absolute",
    width: 360,
    height: 640,
    left: -10000,
    top: -10000,
    opacity: 0,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  providerSwitcher: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  providerName: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  providerEmail: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    flex: 1,
  },
  composer: {
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderRadius: 22,
    borderWidth: 1,
    paddingLeft: 6,
    paddingRight: 6,
    paddingVertical: 6,
    gap: 6,
  },
  attachBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  attachPreview: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
  },
  attachThumb: {
    width: 40,
    height: 40,
    borderRadius: 8,
  },
  attachLabel: {
    flex: 1,
    fontFamily: "Inter_500Medium",
    fontSize: 13,
  },
  attachClose: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  input: {
    flex: 1,
    paddingTop: 8,
    paddingBottom: 8,
    fontSize: 15,
    maxHeight: 140,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  addInline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingTop: 8,
  },
  addInlineText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 14,
  },
  emptyMark: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  emptyTitle: {
    fontFamily: "Inter_600SemiBold",
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
});
