import React from "react";
import { Pressable, useColorScheme } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import {
  triggerHaptic,
  type HapticFeedbackType,
  type HapticConfig,
} from "@/components/utils/haptics";

export type SwitchSize = "sm" | "md" | "lg";
export type SwitchMode =
  | "primary"
  | "secondary"
  | "warning"
  | "error"
  | "success";

type SwitchProps = {
  value: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  duration?: number;
  size?: SwitchSize;
  mode?: SwitchMode;
  disabled?: boolean;
  haptics?: HapticFeedbackType | HapticConfig;
};

export const Switch = ({
  value,
  onPress,
  style,
  duration = 400,
  size = "md",
  mode = "primary",
  disabled,
  haptics = "selection",
}: SwitchProps) => {
  const colorScheme = useColorScheme();
  const height = useSharedValue(0);
  const width = useSharedValue(0);

  const theme = React.useMemo(() => {
    return UnistylesRuntime.getTheme();
  }, [colorScheme]);

  styles.useVariants({
    size,
    mode,
    disabled,
  });

  const handlePress = () => {
    // Handle both string and object configurations
    if (typeof haptics === "string") {
      triggerHaptic(haptics, disabled);
    } else if (haptics.in) {
      triggerHaptic(haptics.in, disabled);

      // Only trigger out haptic if it's configured
      if (haptics.out) {
        setTimeout(() => triggerHaptic(haptics.out!, disabled), duration);
      }
    }

    onPress();
  };

  const trackAnimatedStyle = useAnimatedStyle(() => {
    const onColor = theme.colors[mode][500];
    const offColor = theme.colors.border.default;

    const color = interpolateColor(Number(value), [0, 1], [offColor, onColor]);
    const colorValue = withTiming(color, { duration });

    return {
      backgroundColor: colorValue,
      borderRadius: height.value / 2,
    };
  }, [value, theme, mode]);

  const thumbAnimatedStyle = useAnimatedStyle(() => {
    const moveValue = interpolate(
      Number(value),
      [0, 1],
      [0, width.value - height.value]
    );
    const translateValue = withTiming(moveValue, { duration });

    return {
      transform: [{ translateX: translateValue }],
      borderRadius: height.value / 2,
    };
  }, [value]);

  return (
    <Pressable onPress={handlePress} disabled={disabled}>
      <Animated.View
        onLayout={(e) => {
          height.value = e.nativeEvent.layout.height;
          width.value = e.nativeEvent.layout.width;
        }}
        style={[styles.track, style, trackAnimatedStyle]}
      >
        <Animated.View
          style={[styles.thumb, thumbAnimatedStyle]}
        ></Animated.View>
      </Animated.View>
    </Pressable>
  );
};

const styles = StyleSheet.create((theme) => ({
  track: {
    alignItems: "flex-start",
    borderWidth: 1,
    borderColor: "transparent",
    overflow: "hidden",
    variants: {
      size: {
        sm: {
          width: 48,
          height: 24,
        },
        md: {
          width: 64,
          height: 32,
        },
        lg: {
          width: 80,
          height: 36,
        },
      },
      mode: {
        primary: {},
        secondary: {},
        warning: {},
        error: {},
        success: {},
      },
      disabled: {
        true: {
          opacity: 0.5,
        },
      },
    },
  },
  thumb: {
    height: "100%",
    aspectRatio: 1,
    backgroundColor: theme.colors.background.dim,
    borderRadius: 100,
    overflow: "hidden",
  },
}));
