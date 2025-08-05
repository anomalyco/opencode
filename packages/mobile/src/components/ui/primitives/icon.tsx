import { useMemo } from "react"
import type { StyleProp, ViewStyle } from "react-native"
import { useColorScheme, View } from "react-native"
import { UnistylesRuntime, useUnistyles } from "react-native-unistyles"

export type IconProps = {
  icon: React.ComponentType<any>
  name: string
  style?: StyleProp<ViewStyle>
  size?: "sm" | "md" | "lg" | number
  color?: string | "primary" | "brand" | "secondary" | "success" | "warning" | "error" | "neutral" | "muted"
  mode?: "error" | "success" | "disabled"
}

const getIconSize = (size: IconProps["size"] = "md") => {
  const theme = UnistylesRuntime.getTheme()
  if (typeof size === "number") return size
  switch (size) {
    case "sm":
      return theme.spacing.xs
    case "md":
      return theme.spacing.sm
    case "lg":
      return theme.spacing.md
  }
}

const getIconColor = (color: IconProps["color"], mode?: IconProps["mode"]) => {
  const theme = UnistylesRuntime.getTheme()

  if (mode === "disabled") return theme.colors.text.subtle
  if (mode === "error") return theme.colors.error[500]
  if (mode === "success") return theme.colors.success[500]

  if (typeof color === "string") {
    switch (color) {
      case "primary":
        return theme.colors.primary[500]
      case "brand":
        return theme.colors.brand[500]
      case "secondary":
        return theme.colors.secondary[500]
      case "success":
        return theme.colors.success[500]
      case "warning":
        return theme.colors.warning[500]
      case "error":
        return theme.colors.error[500]
      case "neutral":
        return theme.colors.neutral[500]
      case "muted":
        return theme.colors.text.subtle
      default:
        return color // Direct color value
    }
  }

  return theme.colors.primary[500] // Default color
}

const Icon: React.FC<IconProps> = ({ icon: IconComponent, name, style, size = "md", color = "primary", mode }) => {
  const { rt } = useUnistyles()
  const iconColor = useMemo(() => getIconColor(color, mode), [color, mode, rt.themeName])
  const iconSize = useMemo(() => getIconSize(size), [size])

  return (
    <View style={[{ alignItems: "center", justifyContent: "center" }, style]}>
      <IconComponent name={name} size={iconSize} color={iconColor} />
    </View>
  )
}

export { Icon }
