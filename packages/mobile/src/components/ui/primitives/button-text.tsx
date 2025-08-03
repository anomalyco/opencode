import { Text as RNText } from "react-native";
import type {
  TextStyle,
  StyleProp,
  TextProps as RNTextProps,
} from "react-native";
import { useUnistyles } from "react-native-unistyles";
import { forwardRef, useMemo } from "react";
import type { TextProps } from "./text";

export type ButtonTextProps = TextProps & {
  color?: string;
};

const ButtonText = forwardRef<RNText, ButtonTextProps>(
  (
    {
      children,
      style,
      size = "md",
      weight = "regular",
      leading = "normal",
      mode,
      inverse,
      color,
      ...props
    },
    ref
  ) => {
    const { theme } = useUnistyles();

    const textStyle = useMemo(() => {
      const sizeMap = {
        xs: theme.typography.size.xs,
        sm: theme.typography.size.sm,
        md: theme.typography.size.md,
        lg: theme.typography.size.lg,
        xl: theme.typography.size.xl,
        xxl: theme.typography.size.xxl,
        mega: theme.typography.size.mega,
        giga: theme.typography.size.giga,
        tera: theme.typography.size.tera,
        auto: theme.typography.size.md,
      };

      const weightMap = {
        thin: theme.typography.weight.thin,
        light: theme.typography.weight.light,
        regular: theme.typography.weight.regular,
        medium: theme.typography.weight.medium,
        semibold: theme.typography.weight.semibold,
        bold: theme.typography.weight.bold,
        heavy: theme.typography.weight.heavy,
      };

      const leadingMap = {
        none: theme.typography.leading.none,
        tight: theme.typography.leading.tight,
        snug: theme.typography.leading.snug,
        normal: theme.typography.leading.normal,
        relaxed: theme.typography.leading.relaxed,
        loose: theme.typography.leading.loose,
      };

      // Determine color based on props
      let textColor = color || theme.colors.text.default;

      if (mode === "error") textColor = theme.colors.error[500];
      else if (mode === "success") textColor = theme.colors.success[500];
      else if (mode === "warning") textColor = theme.colors.warning[500];
      else if (mode === "disabled") textColor = theme.colors.text.subtle;
      else if (mode === "subtle") textColor = theme.colors.text.subtle;
      else if (inverse === true) textColor = theme.colors.background.default;
      else if (inverse === false) textColor = theme.colors.text.default;

      // If color prop is provided, it takes precedence
      if (color) textColor = color;

      return {
        fontFamily: theme.typography.family.mono,
        fontSize: sizeMap[size],
        fontWeight: weightMap[weight],
        lineHeight: sizeMap[size] * leadingMap[leading],
        color: textColor,
      };
    }, [size, weight, leading, mode, inverse, color, theme]);

    return (
      <RNText ref={ref} style={[textStyle, style]} {...props}>
        {children}
      </RNText>
    );
  }
);

ButtonText.displayName = "ButtonText";

export { ButtonText };
