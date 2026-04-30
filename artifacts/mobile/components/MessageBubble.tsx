import { Image } from "expo-image";
import { memo } from "react";
import { StyleSheet, View } from "react-native";
import Markdown from "react-native-markdown-display";

import { useColors } from "@/hooks/useColors";
import { PROVIDERS } from "@/lib/providers";
import type { ChatMessage } from "@/lib/types";

interface Props {
  message: ChatMessage;
}

function MessageBubbleInner({ message }: Props) {
  const colors = useColors();

  if (message.role === "summary") {
    return (
      <View style={styles.summaryWrapper}>
        <View
          style={[
            styles.summary,
            { borderColor: colors.border, backgroundColor: colors.elevated },
          ]}
        >
          <Markdown
            style={{
              body: {
                color: colors.mutedForeground,
                fontSize: 13,
                fontFamily: "Inter_400Regular",
              },
              em: { color: colors.mutedForeground, fontStyle: "italic" },
              strong: {
                color: colors.foreground,
                fontFamily: "Inter_600SemiBold",
              },
            }}
          >
            {`*Compressed memory*\n\n${message.content}`}
          </Markdown>
        </View>
      </View>
    );
  }

  const isUser = message.role === "user";
  const provider = message.providerId ? PROVIDERS[message.providerId] : null;

  return (
    <View
      style={[
        styles.row,
        { justifyContent: isUser ? "flex-end" : "flex-start" },
      ]}
    >
      <View
        style={[
          styles.bubble,
          isUser
            ? {
                backgroundColor: colors.elevated,
                borderColor: colors.border,
              }
            : {
                backgroundColor: "transparent",
                borderColor: "transparent",
                paddingHorizontal: 0,
                maxWidth: "100%",
              },
        ]}
      >
        {message.imageUri ? (
          <Image
            source={{ uri: message.imageUri }}
            style={styles.image}
            contentFit="cover"
            transition={150}
          />
        ) : null}
        {!isUser && provider ? (
          <View style={styles.providerTag}>
            <View
              style={[
                styles.providerDot,
                {
                  backgroundColor:
                    message.status === "error"
                      ? colors.destructive
                      : colors.success,
                },
              ]}
            />
          </View>
        ) : null}
        <Markdown
          style={{
            body: {
              color: colors.foreground,
              fontFamily: "Inter_400Regular",
              fontSize: 15,
              lineHeight: 22,
            },
            paragraph: {
              marginTop: 0,
              marginBottom: 8,
              color: colors.foreground,
            },
            strong: {
              color: colors.foreground,
              fontFamily: "Inter_600SemiBold",
            },
            em: { color: colors.foreground, fontStyle: "italic" },
            heading1: {
              color: colors.foreground,
              fontFamily: "Inter_700Bold",
              fontSize: 22,
              marginTop: 8,
            },
            heading2: {
              color: colors.foreground,
              fontFamily: "Inter_700Bold",
              fontSize: 19,
              marginTop: 8,
            },
            heading3: {
              color: colors.foreground,
              fontFamily: "Inter_600SemiBold",
              fontSize: 17,
              marginTop: 8,
            },
            bullet_list: { marginVertical: 4 },
            ordered_list: { marginVertical: 4 },
            list_item: { color: colors.foreground, marginBottom: 2 },
            code_inline: {
              backgroundColor: colors.raised,
              color: colors.foreground,
              borderRadius: 4,
              paddingHorizontal: 6,
              paddingVertical: 2,
              fontSize: 13,
              fontFamily: "monospace",
            },
            code_block: {
              backgroundColor: colors.raised,
              color: colors.foreground,
              borderRadius: 10,
              padding: 12,
              fontFamily: "monospace",
              fontSize: 13,
              borderWidth: 1,
              borderColor: colors.border,
            },
            fence: {
              backgroundColor: colors.raised,
              color: colors.foreground,
              borderRadius: 10,
              padding: 12,
              fontFamily: "monospace",
              fontSize: 13,
              borderWidth: 1,
              borderColor: colors.border,
              marginVertical: 6,
            },
            blockquote: {
              backgroundColor: colors.elevated,
              borderLeftColor: colors.borderStrong,
              borderLeftWidth: 3,
              paddingHorizontal: 10,
              paddingVertical: 6,
              color: colors.mutedForeground,
              marginVertical: 6,
            },
            link: {
              color: colors.foreground,
              textDecorationLine: "underline",
            },
            hr: {
              backgroundColor: colors.border,
              height: 1,
              marginVertical: 12,
            },
            table: {
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: 8,
            },
            th: {
              color: colors.foreground,
              padding: 6,
              fontFamily: "Inter_600SemiBold",
            },
            td: { color: colors.foreground, padding: 6 },
          }}
        >
          {message.content || (message.status === "error"
            ? `_${message.errorMessage ?? "Failed to get response"}_`
            : "")}
        </Markdown>
      </View>
    </View>
  );
}

export const MessageBubble = memo(MessageBubbleInner);

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    paddingHorizontal: 16,
    marginVertical: 6,
  },
  bubble: {
    maxWidth: "85%",
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  providerTag: {
    position: "absolute",
    left: -2,
    top: -2,
  },
  providerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  summaryWrapper: {
    paddingHorizontal: 16,
    marginVertical: 10,
    alignItems: "center",
  },
  summary: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    width: "100%",
  },
  image: {
    width: 220,
    height: 220,
    borderRadius: 12,
    marginBottom: 6,
  },
});
