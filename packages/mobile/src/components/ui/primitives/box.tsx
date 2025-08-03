import type { StyleProp, ViewStyle } from "react-native";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

export type BoxProps = {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  background?:
    | "plain"
    | "dim"
    | "subtle"
    | "emphasis"
    | "base"
    | "inverse"
    | "light"
    | "lighter"
    | "lightest"
    | "dark"
    | "darker"
    | "darkest";
  p?: "xs" | "sm" | "md" | "lg";
  pt?: "xs" | "sm" | "md" | "lg";
  pb?: "xs" | "sm" | "md" | "lg";
  pl?: "xs" | "sm" | "md" | "lg";
  pr?: "xs" | "sm" | "md" | "lg";
  border?: "none" | "subtle" | "thin" | "thick";
  shadow?: "none" | "sm" | "md" | "lg";
  mode?: "primary" | "secondary" | "warning" | "error" | "success" | "disabled";
  rounded?: "none" | "sm" | "md" | "lg" | "xl" | "full";
  direction?: "row" | "column";
  m?: "xs" | "sm" | "md" | "lg";
  mt?: "xs" | "sm" | "md" | "lg";
  mb?: "xs" | "sm" | "md" | "lg";
  ml?: "xs" | "sm" | "md" | "lg";
  mr?: "xs" | "sm" | "md" | "lg";
  gap?: "xs" | "sm" | "md" | "lg";
  flex?: boolean;
  center?: boolean;
  safeArea?: boolean;
  safeAreaTop?: boolean;
  safeAreaBottom?: boolean;
  justifyContent?:
    | "flex-start"
    | "center"
    | "flex-end"
    | "space-between"
    | "space-around"
    | "space-evenly";
  alignItems?: "flex-start" | "center" | "flex-end" | "stretch";
};

const Box = ({
  children,
  style,
  background,
  p,
  pt,
  pb,
  pl,
  pr,
  border,
  shadow,
  mode,
  rounded,
  direction,
  m,
  mt,
  mb,
  ml,
  mr,
  gap,
  flex,
  center,
  safeArea,
  safeAreaTop,
  safeAreaBottom,
  justifyContent,
  alignItems,
}: BoxProps) => {
  const { rt } = useUnistyles();
  const isDark = rt.themeName === "dark";
  let shadowNow = shadow;
  let borderNow = border;
  if (isDark && shadow) {
    shadowNow = "none";
  }
  styles.useVariants({
    background,
    p,
    pt,
    pb,
    pl,
    pr,
    border: borderNow,
    shadow: shadowNow,
    mode,
    rounded,
    direction,
    m,
    mt,
    mb,
    ml,
    mr,
    gap,
    flex,
    center,
    safeArea,
    safeAreaTop,
    safeAreaBottom,
    justifyContent,
    alignItems,
  });

  return <View style={[styles.base, style]}>{children}</View>;
};

export { Box };

const styles = StyleSheet.create((theme, rt) => ({
  base: {
    borderCurve: "continuous",
    shadowColor: theme.colors.contrast.base,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
    variants: {
      flex: {
        true: {
          flex: 1,
        },
      },
      justifyContent: {
        "flex-start": {
          justifyContent: "flex-start",
        },
        center: {
          justifyContent: "center",
        },
        "flex-end": {
          justifyContent: "flex-end",
        },
        "space-between": {
          justifyContent: "space-between",
        },
        "space-around": {
          justifyContent: "space-around",
        },
        "space-evenly": {
          justifyContent: "space-evenly",
        },
      },
      alignItems: {
        "flex-start": {
          alignItems: "flex-start",
        },
        center: {
          alignItems: "center",
        },
        "flex-end": {
          alignItems: "flex-end",
        },
        stretch: {
          alignItems: "stretch",
        },
      },
      center: {
        true: {
          justifyContent: "center",
          alignItems: "center",
        },
      },
      background: {
        default: {
          backgroundColor: "transparent",
        },
        plain: {
          backgroundColor: theme.colors.background.plain,
        },
        dim: {
          backgroundColor: theme.colors.background.dim,
        },
        base: {
          backgroundColor: theme.colors.background.default,
        },
        inverse: {
          backgroundColor: theme.colors.background.inverse,
        },
        subtle: {
          backgroundColor: theme.colors.background.subtle,
        },
        emphasis: {
          backgroundColor: theme.colors.background.emphasis,
        },
        light: {
          backgroundColor: theme.colors.background.light,
        },
        lighter: {
          backgroundColor: theme.colors.background.lighter,
        },
        lightest: {
          backgroundColor: theme.colors.background.lightest,
        },
        dark: {
          backgroundColor: theme.colors.background.dark,
        },
        darker: {
          backgroundColor: theme.colors.background.darker,
        },
        darkest: {
          backgroundColor: theme.colors.background.darkest,
        },
      },
      p: {
        xs: {
          padding: theme.spacing.xs,
        },
        sm: {
          padding: theme.spacing.sm,
        },
        md: {
          padding: theme.spacing.md,
        },
        lg: {
          padding: theme.spacing.lg,
        },
      },
      pt: {
        xs: {
          paddingTop: theme.spacing.xs,
        },
        sm: {
          paddingTop: theme.spacing.sm,
        },
        md: {
          paddingTop: theme.spacing.md,
        },
        lg: {
          paddingTop: theme.spacing.lg,
        },
      },
      pb: {
        xs: {
          paddingBottom: theme.spacing.xs,
        },
        sm: {
          paddingBottom: theme.spacing.sm,
        },
        md: {
          paddingBottom: theme.spacing.md,
        },
        lg: {
          paddingBottom: theme.spacing.lg,
        },
      },
      pl: {
        xs: {
          paddingLeft: theme.spacing.xs,
        },
        sm: {
          paddingLeft: theme.spacing.sm,
        },
        md: {
          paddingLeft: theme.spacing.md,
        },
        lg: {
          paddingLeft: theme.spacing.lg,
        },
      },
      pr: {
        xs: {
          paddingRight: theme.spacing.xs,
        },
        sm: {
          paddingRight: theme.spacing.sm,
        },
        md: {
          paddingRight: theme.spacing.md,
        },
        lg: {
          paddingRight: theme.spacing.lg,
        },
      },

      border: {
        default: {
          borderWidth: 0,
        },
        none: {
          borderWidth: 0,
        },
        subtle: {
          borderWidth: 0.5,
          borderColor: theme.colors.border.subtle,
        },
        thin: {
          borderWidth: 1,
          borderColor: theme.colors.border.default,
        },
        thick: {
          borderWidth: 2,
          borderColor: theme.colors.border.default,
        },
      },
      shadow: {
        none: {
          shadowOpacity: 0,
          shadowRadius: 0,
          elevation: 0,
        },
        sm: {
          shadowOpacity: 0.2,
          shadowRadius: 3,
          elevation: 2,
        },
        md: {
          shadowOpacity: 0.4,
          shadowRadius: 8,
          elevation: 4,
        },
        lg: {
          shadowOpacity: 0.5,
          shadowRadius: 16,
          elevation: 8,
        },
      },
      mode: {
        primary: {
          borderColor: theme.colors.primary[500],
          backgroundColor: `${theme.colors.primary[500]}20`,
        },
        secondary: {
          borderColor: theme.colors.secondary[500],
          backgroundColor: `${theme.colors.secondary[500]}20`,
        },
        warning: {
          borderColor: theme.colors.warning[500],
          backgroundColor: `${theme.colors.warning[500]}20`,
        },
        error: {
          borderColor: theme.colors.error[500],
          backgroundColor: `${theme.colors.error[500]}20`,
        },
        success: {
          borderColor: theme.colors.success[500],
          backgroundColor: `${theme.colors.success[500]}20`,
        },
        disabled: {
          opacity: 0.5,
          backgroundColor: theme.colors.background.subtle,
          borderColor: theme.colors.border.subtle,
        },
      },
      rounded: {
        none: {
          borderRadius: theme.radius.none,
        },
        sm: {
          borderRadius: theme.radius.sm,
        },
        md: {
          borderRadius: theme.radius.md,
        },
        lg: {
          borderRadius: theme.radius.lg,
        },
        xl: {
          borderRadius: theme.radius.xl,
        },
        full: {
          borderRadius: theme.radius.full,
        },
      },
      direction: {
        row: {
          flexDirection: "row",
        },
        column: {
          flexDirection: "column",
        },
      },
      m: {
        xs: {
          margin: theme.spacing.xs,
        },
        sm: {
          margin: theme.spacing.sm,
        },
        md: {
          margin: theme.spacing.md,
        },
        lg: {
          margin: theme.spacing.lg,
        },
      },
      mt: {
        xs: {
          marginTop: theme.spacing.xs,
        },
        sm: {
          marginTop: theme.spacing.sm,
        },
        md: {
          marginTop: theme.spacing.md,
        },
        lg: {
          marginTop: theme.spacing.lg,
        },
      },
      mb: {
        xs: {
          marginBottom: theme.spacing.xs,
        },
        sm: {
          marginBottom: theme.spacing.sm,
        },
        md: {
          marginBottom: theme.spacing.md,
        },
        lg: {
          marginBottom: theme.spacing.lg,
        },
      },
      ml: {
        xs: {
          marginLeft: theme.spacing.xs,
        },
        sm: {
          marginLeft: theme.spacing.sm,
        },
        md: {
          marginLeft: theme.spacing.md,
        },
        lg: {
          marginLeft: theme.spacing.lg,
        },
      },
      mr: {
        xs: {
          marginRight: theme.spacing.xs,
        },
        sm: {
          marginRight: theme.spacing.sm,
        },
        md: {
          marginRight: theme.spacing.md,
        },
        lg: {
          marginRight: theme.spacing.lg,
        },
      },
      gap: {
        xs: {
          gap: theme.spacing.xs,
        },
        sm: {
          gap: theme.spacing.sm,
        },
        md: {
          gap: theme.spacing.md,
        },
        lg: {
          gap: theme.spacing.lg,
        },
      },
      safeArea: {
        true: {
          paddingTop: rt.insets.top,
          paddingBottom: rt.insets.bottom,
        },
      },
      safeAreaTop: {
        true: {
          paddingTop: rt.insets.top,
        },
      },
      safeAreaBottom: {
        true: {
          paddingBottom: rt.insets.bottom,
        },
      },
    },
  },
}));
