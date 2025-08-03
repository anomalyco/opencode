import { TextInput, useColorScheme } from "react-native";
import type { StyleProp, TextStyle, TextInputProps } from "react-native";
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";
import { Box, type BoxProps } from "./box";
import { Text } from "./text";
import { useMemo } from "react";

export type TextAreaProps = TextInputProps &
  Omit<BoxProps, "children"> & {
    style?: StyleProp<TextStyle>;
    maxLength?: number;
    mode?: "secondary" | "warning" | "error" | "success" | "disabled";
  };

const TextArea = ({
  style,
  maxLength,
  mode,
  value,
  // Box props
  background,
  p = "md",
  border = "thin",
  shadow,
  rounded = "md",
  direction,
  m,
  mt,
  mb,
  gap,
  // Rest of TextInput props
  ...props
}: TextAreaProps) => {
  const colorScheme = useColorScheme();

  const placeholderTextColor = useMemo(() => {
    const theme = UnistylesRuntime.getTheme();
    return colorScheme === "dark"
      ? theme.colors.text.subtle
      : theme.colors.text.subtle;
  }, [colorScheme]);

  const boxProps = {
    background,
    p,
    border,
    shadow,
    mode,
    rounded,
    direction,
    m,
    mt,
    mb,
    gap,
  };

  const { remainingChars, counterState } = useMemo(() => {
    const remaining = maxLength ? maxLength - (value?.length || 0) : null;
    const mode: "error" | "warning" | undefined =
      remaining !== null
        ? remaining === 0
          ? "error"
          : remaining <= 10
          ? "warning"
          : undefined
        : undefined;

    return { remainingChars: remaining, counterState: mode };
  }, [maxLength, value]);

  return (
    <Box {...boxProps} style={{ minHeight: 120 }}>
      <TextInput
        style={[styles.input, style]}
        multiline
        textAlignVertical="top"
        maxLength={maxLength}
        value={value}
        placeholderTextColor={placeholderTextColor}
        editable={mode !== "disabled"}
        {...props}
      />
      {maxLength && (
        <Text size="xs" style={styles.counter} mode={counterState}>
          {remainingChars}
        </Text>
      )}
    </Box>
  );
};

export default TextArea;

const styles = StyleSheet.create((theme) => ({
  input: {
    flex: 1,
    fontFamily: theme.typography.family.mono,
    fontSize: theme.typography.size.md,
    color: theme.colors.text.default,
    padding: 0,
    margin: 0,
  },
  counter: {
    position: "absolute",
    bottom: theme.spacing.xs,
    right: theme.spacing.xs,
    variants: {
      mode: {
        secondary: {
          color: theme.colors.secondary[500],
        },
        warning: {
          color: theme.colors.warning[500],
        },
        error: {
          color: theme.colors.error[500],
        },
        success: {
          color: theme.colors.success[500],
        },
      },
    },
  },
}));
