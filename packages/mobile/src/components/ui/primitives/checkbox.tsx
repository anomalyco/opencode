import { Pressable, useColorScheme } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";
import { Feather } from "@expo/vector-icons";
import { Icon } from "./icon";
import { useMemo, useState } from "react";
import { getContrastColor, getIconSize } from "@/utils/theme";

export type CheckboxProps = {
  style?: StyleProp<ViewStyle>;
  size?: "sm" | "md" | "lg";
  mode?: "primary" | "secondary" | "warning" | "error" | "success" | "disabled";
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
};

const Checkbox = ({
  style,
  size = "sm",
  mode,
  checked: controlledChecked,
  defaultChecked,
  onChange,
}: CheckboxProps) => {
  const [internalChecked, setInternalChecked] = useState(
    defaultChecked || false
  );
  const theme = UnistylesRuntime.getTheme();
  const colorScheme = useColorScheme();
  const isChecked =
    controlledChecked !== undefined ? controlledChecked : internalChecked;
  const isDisabled = mode === "disabled";

  const handlePress = () => {
    if (isDisabled) return;
    if (controlledChecked === undefined) {
      setInternalChecked(!internalChecked);
    }
    onChange?.(!isChecked);
  };

  styles.useVariants({
    size,
    mode,
    isChecked,
  });

  const iconColor = useMemo(() => {
    const theme = UnistylesRuntime.getTheme();

    const backgroundColor = theme.colors[mode || "primary"][500];
    return getContrastColor(backgroundColor);
  }, [mode, colorScheme]);

  return (
    <Pressable
      style={[styles.container, style]}
      onPress={handlePress}
      disabled={isDisabled}
    >
      {isChecked && (
        <Icon
          icon={Feather}
          name="check"
          size={getIconSize(size)}
          color={iconColor}
        />
      )}
    </Pressable>
  );
};

export default Checkbox;

const styles = StyleSheet.create((theme) => ({
  container: {
    borderWidth: 2,
    borderRadius: theme.radius.sm,
    borderColor: theme.colors.border.default,
    backgroundColor: "transparent",
    justifyContent: "center",
    alignItems: "center",
    variants: {
      size: {
        sm: {
          width: theme.spacing.lg,
          height: theme.spacing.lg,
        },
        md: {
          width: theme.spacing.xl,
          height: theme.spacing.xl,
        },
        lg: {
          width: theme.spacing.xxl,
          height: theme.spacing.xxl,
        },
      },
      mode: {
        default: {},
        primary: {
          borderColor: theme.colors.primary[500],
        },
        secondary: {
          borderColor: theme.colors.secondary[500],
        },
        warning: {
          borderColor: theme.colors.warning[500],
        },
        error: {
          borderColor: theme.colors.error[500],
        },
        success: {
          backgroundColor: theme.colors.success[500],
          borderColor: theme.colors.success[500],
        },
        disabled: {
          borderColor: theme.colors.border.subtle,
          opacity: 0.7,
        },
      },

      isChecked: {
        true: {
          backgroundColor: theme.colors.primary[500],
          borderColor: theme.colors.text.subtle,
        },
        false: {
          backgroundColor: "transparent",
        },
      },
    },
    compoundVariants: [
      {
        isChecked: true,
        mode: "error",
        styles: {
          backgroundColor: theme.colors.error[500],
        },
      },
      {
        isChecked: true,
        mode: "success",
        styles: {
          backgroundColor: theme.colors.success[500],
        },
      },
      {
        isChecked: true,
        mode: "primary",
        styles: {
          backgroundColor: theme.colors.primary[500],
        },
      },
      {
        isChecked: true,
        mode: "secondary",
        styles: {
          backgroundColor: theme.colors.secondary[500],
        },
      },
      {
        isChecked: true,
        mode: "warning",
        styles: {
          backgroundColor: theme.colors.warning[500],
        },
      },
    ],
  },
}));
