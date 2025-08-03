import { forwardRef } from "react";
import type {
  TextProps as RNTextProps,
  StyleProp,
  TextStyle,
} from "react-native";
import { Text as RNText } from "react-native";
import { StyleSheet } from "react-native-unistyles";

export type TextProps = {
  children?: React.ReactNode;
  style?: StyleProp<TextStyle>;
  capitalize?: boolean;
  size?:
    | "xs"
    | "sm"
    | "md"
    | "lg"
    | "xl"
    | "xxl"
    | "mega"
    | "giga"
    | "tera"
    | "auto";
  weight?:
    | "thin"
    | "light"
    | "regular"
    | "medium"
    | "semibold"
    | "bold"
    | "heavy";
  leading?: "none" | "tight" | "snug" | "normal" | "relaxed" | "loose";
  mode?: "warning" | "error" | "success" | "disabled" | "subtle" | "brand";
  numberOfLines?: number;
  inverse?: boolean;
} & RNTextProps;

const Text = forwardRef<RNText, TextProps>(
  (
    { children, style, size, weight, leading, mode, inverse, ...props },
    ref
  ) => {
    styles.useVariants({ size, weight, leading, mode, inverse });

    return (
      <RNText ref={ref} style={[styles.base, style]} {...props}>
        {children}
      </RNText>
    );
  }
);

Text.displayName = "Text";

export { Text };

const styles = StyleSheet.create((theme, rt) => ({
  base: {
    color: theme.colors.text.default,
    fontSize: theme.typography.size.md,
    fontFamily: theme.typography.family.mono,
    lineHeight: theme.typography.size.md * theme.typography.leading.normal,
    variants: {
      size: {
        default: {
          fontSize: theme.typography.size.sm,
          lineHeight:
            theme.typography.size.sm * theme.typography.leading.normal,
        },
        xs: {
          fontSize: theme.typography.size.xs,
          lineHeight:
            theme.typography.size.xs * theme.typography.leading.normal,
        },
        sm: {
          fontSize: theme.typography.size.sm,
          lineHeight:
            theme.typography.size.sm * theme.typography.leading.normal,
        },
        md: {
          fontSize: theme.typography.size.md,
          lineHeight:
            theme.typography.size.md * theme.typography.leading.normal,
        },
        lg: {
          fontSize: theme.typography.size.lg,
          lineHeight:
            theme.typography.size.lg * theme.typography.leading.normal,
        },
        xl: {
          fontSize: theme.typography.size.xl,
          lineHeight:
            theme.typography.size.xl * theme.typography.leading.normal,
        },
        xxl: {
          fontSize: theme.typography.size.xxl,
          lineHeight:
            theme.typography.size.xxl * theme.typography.leading.normal,
        },
        mega: {
          fontSize: theme.typography.size.mega,
          lineHeight:
            theme.typography.size.mega * theme.typography.leading.normal,
        },
        giga: {
          fontSize: theme.typography.size.giga,
          lineHeight:
            theme.typography.size.giga * theme.typography.leading.normal,
        },
        tera: {
          fontSize: theme.typography.size.tera,
          lineHeight:
            theme.typography.size.tera * theme.typography.leading.normal,
        },
        auto: {
          // fontSize: "auto",
          // lineHeight: "auto",
        },
      },
      weight: {
        default: { fontWeight: theme.typography.weight.regular },
        thin: { fontWeight: theme.typography.weight.thin },
        light: { fontWeight: theme.typography.weight.light },
        regular: { fontWeight: theme.typography.weight.regular },
        medium: { fontWeight: theme.typography.weight.medium },
        semibold: { fontWeight: theme.typography.weight.semibold },
        bold: { fontWeight: theme.typography.weight.bold },
        heavy: { fontWeight: theme.typography.weight.heavy },
      },
      leading: {
        none: {
          lineHeight: theme.typography.size.md * theme.typography.leading.none,
        },
        tight: {
          lineHeight: theme.typography.size.md * theme.typography.leading.tight,
        },
        snug: {
          lineHeight: theme.typography.size.md * theme.typography.leading.snug,
        },
        normal: {
          lineHeight:
            theme.typography.size.md * theme.typography.leading.normal,
        },
        relaxed: {
          lineHeight:
            theme.typography.size.md * theme.typography.leading.relaxed,
        },
        loose: {
          lineHeight: theme.typography.size.md * theme.typography.leading.loose,
        },
      },
      inverse: {
        true: {
          color: theme.colors.background.default,
        },
        false: {
          color: theme.colors.text.default,
        },
      },
      mode: {
        error: {
          color: theme.colors.error[500],
        },
        success: {
          color: theme.colors.success[500],
        },
        disabled: {
          color: theme.colors.text.subtle,
        },
        warning: {
          color: theme.colors.warning[500],
        },
        subtle: {
          color: theme.colors.text.subtle,
        },
        brand: {
          color: theme.colors.brand[500],
        },
      },
    },
  },
}));
