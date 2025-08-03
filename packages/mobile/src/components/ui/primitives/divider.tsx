import { View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";

export type DividerProps = {
  style?: StyleProp<ViewStyle>;
  direction?: "horizontal" | "vertical";
  size?: "extraThin" | "thin" | "medium" | "thick";
  variant?: "solid" | "dashed" | "dotted";
  color?: "subtle" | "strong" | "inverse";
  m?: "sm" | "md" | "lg";
  mt?: "sm" | "md" | "lg";
  mb?: "sm" | "md" | "lg";
};

const Divider = ({
  style,
  direction = "horizontal",
  size = "thin",
  variant = "solid",
  color,
  m,
  mt,
  mb,
}: DividerProps) => {
  styles.useVariants({
    direction,
    size,
    variant,
    color,
    m,
    mt,
    mb,
  });

  return <View style={[styles.base, style]} />;
};

export { Divider };

const styles = StyleSheet.create((theme) => ({
  base: {
    alignSelf: "stretch",
    variants: {
      direction: {
        horizontal: {
          alignSelf: "stretch",
          height: 1,
        },
        vertical: {
          width: 1,
          alignSelf: "stretch",
        },
      },
      size: {
        extraThin: {
          borderWidth: 0.3,
        },
        thin: {
          borderWidth: 1,
        },
        medium: {
          borderWidth: 2,
        },
        thick: {
          borderWidth: 3,
        },
      },
      variant: {
        solid: {
          borderStyle: "solid",
        },
        dashed: {
          borderStyle: "dashed",
          borderWidth: 1,
        },
        dotted: {
          borderStyle: "dotted",
          borderWidth: 1,
        },
      },
      color: {
        default: {
          borderColor: theme.colors.border.default,
        },
        subtle: {
          borderColor: theme.colors.border.subtle,
        },
        strong: {
          borderColor: theme.colors.border.strong,
        },
        inverse: {
          borderColor: theme.colors.text.default,
        },
      },
      m: {
        sm: { margin: theme.spacing.sm },
        md: { margin: theme.spacing.md },
        lg: { margin: theme.spacing.lg },
      },
      mt: {
        sm: { marginTop: theme.spacing.sm },
        md: { marginTop: theme.spacing.md },
        lg: { marginTop: theme.spacing.lg },
      },
      mb: {
        sm: { marginBottom: theme.spacing.sm },
        md: { marginBottom: theme.spacing.md },
        lg: { marginBottom: theme.spacing.lg },
      },
    },
  },
}));
