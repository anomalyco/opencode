import Color from "color"
import { UnistylesRuntime } from "react-native-unistyles"
import { generateColorTheme } from "./colors"
import { layout, radius, sizing, spacing, typography } from "./sizing"

const theme = generateColorTheme({
  base: {
    light: {
      // primary: "#007AFF",
      primary: "#0d0f12",
      brand: "#4285f4",
      secondary: "#8B5CF6",
      success: "#16A34A",
      warning: "#FF9500",
      error: "#FF3B30",
      neutral: "#6B7280",
      contrast: "#000000",
      disabled: "#D1D1D6",
    },
    dark: {
      // primary: "#5856D6",
      primary: "#f1f3f7",
      brand: "#4285f4",
      secondary: "#A855F7",
      success: "#16A34A",
      warning: "#FF9F0A",
      error: "#FF453A",
      neutral: "#98989D",
      contrast: "#FFFFFF",
      disabled: "#D1D1D6",
    },
  },
  text: {
    light: {
      default: "#202329",
    },
    dark: {
      default: "#fafafa",
    },
  },
  surfaces: {
    light: {
      background: "#EFF1F5",
      border: "#6B7280",
    },
    dark: {
      background: "#0d0f12",
      border: "#98989D",
    },
  },
})

export const lightTheme = {
  ...theme.light,
  sizing,
  spacing,
  radius,
  typography,
  layout,
}

export const darkTheme = {
  ...theme.dark,
  sizing,
  spacing,
  radius,
  typography,
  layout,
}

export function getContrastColor(backgroundColor: string) {
  const color = Color(backgroundColor)
  // Using WCAG relative luminance calculation to determine contrast
  return color.isLight() ? "#000000" : "#FFFFFF"
}

export const getIconSize = (size: "sm" | "md" | "lg" | "auto") => {
  const theme = UnistylesRuntime.getTheme()
  switch (size) {
    case "sm":
      return theme.sizing.lg
    case "md":
      return theme.sizing.xl
    case "lg":
      return theme.sizing.xxl
    case "auto":
      return theme.sizing.lg
  }
}
