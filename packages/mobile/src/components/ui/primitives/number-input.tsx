import React, { useRef, useState } from "react";
import {
  Animated,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Text } from "./text";

export type NumberInputProps = Omit<
  TextInputProps,
  "value" | "onChangeText"
> & {
  value?: string;
  onChangeText?: (value: string) => void;
  style?: StyleProp<TextStyle>;
  size?: "sm" | "md" | "lg" | "xl" | "xxl" | "mega" | "giga" | "tera";
  placeholder?: string;
  prefix?: string;
  suffix?: string;
  maxLength?: number;
  allowDecimals?: boolean;
  allowNegative?: boolean;
};

const NumberInput: React.FC<NumberInputProps> = ({
  value = "",
  onChangeText,
  style,
  size = "xxl",
  placeholder = "0",
  prefix,
  suffix,
  maxLength,
  allowDecimals = true,
  allowNegative = false,
  ...props
}) => {
  const { theme } = useUnistyles();
  const [isFocused, setIsFocused] = useState(false);
  const scaleValue = useRef(new Animated.Value(1)).current;
  const inputRef = useRef<TextInput>(null);

  const formatNumber = (text: string): string => {
    // Remove all non-numeric characters except decimal point and minus
    let cleaned = text.replace(/[^\d.-]/g, "");

    // Handle negative sign
    if (!allowNegative) {
      cleaned = cleaned.replace("-", "");
    } else if (cleaned.includes("-")) {
      // Ensure minus is only at the beginning
      const hasNegative = cleaned.startsWith("-");
      cleaned = cleaned.replace(/-/g, "");
      if (hasNegative) cleaned = "-" + cleaned;
    }

    // Handle decimal points
    if (!allowDecimals) {
      cleaned = cleaned.replace(".", "");
    } else {
      // Ensure only one decimal point
      const parts = cleaned.split(".");
      if (parts.length > 2) {
        cleaned = parts[0] + "." + parts.slice(1).join("");
      }
    }

    return cleaned;
  };

  const handleChangeText = (text: string) => {
    const formattedText = formatNumber(text);
    onChangeText?.(formattedText);
  };

  const handleFocus = () => {
    setIsFocused(true);
    Animated.spring(scaleValue, {
      toValue: 1.01,
      useNativeDriver: true,
    }).start();
  };

  const handleBlur = () => {
    setIsFocused(false);
    Animated.spring(scaleValue, {
      toValue: 1,
      useNativeDriver: true,
    }).start();
  };

  const handleContainerPress = () => {
    inputRef.current?.focus();
  };

  const textColor = isFocused
    ? theme.colors.text.default
    : value
    ? theme.colors.text.default
    : theme.colors.text.subtle;

  const fontSize = theme.typography.size[size];

  // Use a more stable width that doesn't change based on content
  const inputWidth = fontSize * 4; // Fixed width to prevent flicker

  return (
    <Animated.View
      style={[styles.container, { transform: [{ scale: scaleValue }] }]}
    >
      <View style={styles.inputContainer} onTouchEnd={handleContainerPress}>
        <View style={styles.contentContainer}>
          {prefix && (
            <Text
              size={size}
              weight="medium"
              style={[styles.prefix, { color: textColor }]}
            >
              {prefix}
            </Text>
          )}
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={handleChangeText}
            onFocus={handleFocus}
            onBlur={handleBlur}
            style={[
              styles.input,
              {
                fontSize,
                color: textColor,
                fontWeight: theme.typography.weight.medium,
                width: inputWidth,
              },
              style,
            ]}
            placeholder={placeholder}
            placeholderTextColor={theme.colors.text.subtle}
            keyboardType="numeric"
            textAlign="center"
            selectionColor={theme.colors.brand[500]}
            maxLength={maxLength}
            {...props}
          />
          {suffix && (
            <Text
              size={size}
              weight="medium"
              style={[styles.suffix, { color: textColor }]}
            >
              {suffix}
            </Text>
          )}
        </View>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create((theme) => ({
  container: {
    width: "100%",
  },
  inputContainer: {
    minHeight: 60,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    backgroundColor: "transparent",
  },
  contentContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 1,
  },
  input: {
    textAlign: "center",
    backgroundColor: "transparent",
    borderWidth: 0,
    outline: "none",
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: 0,
    flexShrink: 1,
  },
  prefix: {
    marginRight: theme.spacing.xs,
    flexShrink: 0,
  },
  suffix: {
    marginLeft: theme.spacing.xs,
    flexShrink: 0,
  },
}));

export { NumberInput };
