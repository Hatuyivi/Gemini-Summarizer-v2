import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { useColors } from "@/hooks/useColors";

function Dot({ delay, color }: { delay: number; color: string }) {
  const o = useSharedValue(0.25);
  useEffect(() => {
    o.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 360, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.25, { duration: 360, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [delay, o]);

  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View
      style={[
        styles.dot,
        { backgroundColor: color },
        style,
      ]}
    />
  );
}

export function TypingIndicator() {
  const colors = useColors();
  return (
    <View style={styles.row}>
      <View
        style={[
          styles.bubble,
          { backgroundColor: colors.elevated, borderColor: colors.border },
        ]}
      >
        <Dot delay={0} color={colors.mutedForeground} />
        <Dot delay={120} color={colors.mutedForeground} />
        <Dot delay={240} color={colors.mutedForeground} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 16,
    marginVertical: 6,
    flexDirection: "row",
  },
  bubble: {
    flexDirection: "row",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    gap: 6,
    alignItems: "center",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
