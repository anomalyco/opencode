import Color from "color"

interface ColorVariations {
  // Base shades (keeping existing for compatibility)
  50: string
  100: string
  200: string
  300: string
  400: string
  500: string
  600: string
  700: string
  800: string
  900: string
  // Semantic shades (new intuitive names)
  lightest: string
  lighter: string
  light: string
  base: string
  dark: string
  darker: string
  darkest: string
  // States and variations
  contrast: string
  hover: string
  pressed: string
}

interface SurfaceColors {
  plain: string
  default: string
  dim: string
  subtle: string
  hover: string
  pressed: string
  emphasis: string
  // Semantic shades for backgrounds
  lightest: string
  lighter: string
  light: string
  base: string
  dark: string
  darker: string
  darkest: string
  inverse: string
}

interface BorderColors {
  default: string
  subtle: string
  strong: string
  focus: string
}

interface TextColors {
  default: string
  subtle: string
  emphasis: string
}

interface BaseColors {
  primary: string
  brand: string
  secondary: string
  success: string
  warning: string
  error: string
  neutral: string
  contrast: string
  disabled: string
}

interface ThemeColors {
  light: BaseColors
  dark: BaseColors
}

function generateTextColors(baseColor: string): TextColors {
  const color = Color(baseColor)
  return {
    default: baseColor,
    subtle: color.alpha(0.65).toString(),
    emphasis: color.isDark() ? color.lighten(0.2).hex() : color.darken(0.2).hex(),
  }
}

export function generateColorTheme(colors: {
  base: ThemeColors
  text: {
    light: { default: string }
    dark: { default: string }
  }
  surfaces: {
    light: { background: string; border: string }
    dark: { background: string; border: string }
  }
}) {
  function generateBaseVariations(baseColor: string): ColorVariations {
    const color = Color(baseColor)
    const luminance = color.luminosity()
    const isPrimary = baseColor === colors.base.light.primary || baseColor === colors.base.dark.primary

    // Very dark color (near black)
    if (luminance < 0.08 && !isPrimary) {
      // Generate gray scale for near-black colors
      return {
        50: "#f2f2f2",
        100: "#e6e6e6",
        200: "#cccccc",
        300: "#b3b3b3",
        400: "#999999",
        500: "#808080",
        600: "#666666",
        700: "#4d4d4d",
        800: "#333333",
        900: baseColor, // Keep the original color as the darkest
        // Semantic shades
        lightest: "#808080",
        lighter: "#666666",
        light: "#4d4d4d",
        base: baseColor,
        dark: baseColor,
        darker: baseColor,
        darkest: baseColor,
        contrast: "#FFFFFF",
        hover: "#333333",
        pressed: "#4d4d4d",
      }
    }

    // Very light color (near white)
    if (luminance > 0.92 && !isPrimary) {
      // Generate gray scale for near-white colors
      return {
        50: baseColor, // Keep the original color as the lightest
        100: "#f7f7f7",
        200: "#e6e6e6",
        300: "#d6d6d6",
        400: "#c2c2c2",
        500: "#b8b8b8",
        600: "#a3a3a3",
        700: "#8f8f8f",
        800: "#666666",
        900: "#333333",
        // Semantic shades
        lightest: baseColor,
        lighter: baseColor,
        light: baseColor,
        base: baseColor,
        dark: "#f2f2f2",
        darker: "#e6e6e6",
        darkest: "#d6d6d6",
        contrast: "#000000",
        hover: "#f2f2f2",
        pressed: "#e6e6e6",
      }
    }

    // For primary colors or colors that aren't extremely light/dark
    if (isPrimary) {
      // For white or very light primary
      if (luminance > 0.92) {
        return {
          50: baseColor,
          100: baseColor,
          200: color.darken(0.02).hex(),
          300: color.darken(0.04).hex(),
          400: color.darken(0.06).hex(),
          500: baseColor,
          600: color.darken(0.05).hex(),
          700: color.darken(0.1).hex(),
          800: color.darken(0.15).hex(),
          900: color.darken(0.2).hex(),
          // Semantic shades
          lightest: baseColor,
          lighter: baseColor,
          light: baseColor,
          base: baseColor,
          dark: color.darken(0.05).hex(),
          darker: color.darken(0.1).hex(),
          darkest: color.darken(0.15).hex(),
          contrast: "#000000",
          hover: color.darken(0.05).hex(),
          pressed: color.darken(0.1).hex(),
        }
      }

      // For black or very dark primary
      if (luminance < 0.08) {
        return {
          50: color.lighten(0.8).hex(),
          100: color.lighten(0.7).hex(),
          200: color.lighten(0.6).hex(),
          300: color.lighten(0.5).hex(),
          400: color.lighten(0.3).hex(),
          500: baseColor,
          600: baseColor,
          700: baseColor,
          800: baseColor,
          900: baseColor,
          // Semantic shades
          lightest: color.lighten(0.5).hex(),
          lighter: color.lighten(0.3).hex(),
          light: color.lighten(0.15).hex(),
          base: baseColor,
          dark: baseColor,
          darker: baseColor,
          darkest: baseColor,
          contrast: "#FFFFFF",
          hover: color.lighten(0.1).hex(),
          pressed: color.lighten(0.15).hex(),
        }
      }
    }

    return {
      50: color.lighten(0.4).hex(),
      100: color.lighten(0.3).hex(),
      200: color.lighten(0.2).hex(),
      300: color.lighten(0.1).hex(),
      400: color.lighten(0.05).hex(),
      500: baseColor,
      600: color.darken(0.05).hex(),
      700: color.darken(0.1).hex(),
      800: color.darken(0.2).hex(),
      900: color.darken(0.3).hex(),
      // Semantic shades
      lightest: color.lighten(0.5).hex(),
      lighter: color.lighten(0.3).hex(),
      light: color.lighten(0.15).hex(),
      base: baseColor,
      dark: color.darken(0.15).hex(),
      darker: color.darken(0.3).hex(),
      darkest: color.darken(0.5).hex(),
      contrast: color.isLight() ? "#000000" : "#FFFFFF",
      hover: color.darken(0.1).hex(),
      pressed: color.darken(0.15).hex(),
    }
  }

  function generateBackgroundColors(baseColor: string, inverseBaseColor?: string): SurfaceColors {
    const color = Color(baseColor)
    const luminance = color.luminosity()

    // Determine if we're working with a light or dark theme based on luminance
    const isDarkTheme = luminance < 0.5

    if (isDarkTheme) {
      // Dark theme - pure neutral grays
      return {
        plain: "#000000", // Black
        default: baseColor,
        dim: "#0A0A0A", // Very dark gray
        subtle: "#171717", // Dark gray
        hover: "#262626", // Medium dark gray
        pressed: "#404040", // Lighter dark gray
        emphasis: "#525252", // Even lighter gray
        // Semantic shades based on the base background color
        lightest: color.lighten(0.5).hex(),
        lighter: color.lighten(0.3).hex(),
        light: color.lighten(0.15).hex(),
        base: baseColor,
        dark: color.darken(0.15).hex(),
        darker: color.darken(0.3).hex(),
        darkest: color.darken(0.5).hex(),
        inverse: inverseBaseColor || "#FFFFFF",
      }
    } else {
      // Light theme - pure neutral grays
      return {
        plain: "#FFFFFF", // White
        default: baseColor,
        dim: "#FAFAFA", // Very light gray
        subtle: "#F5F5F5", // Light gray
        hover: "#F0F0F0", // Medium light gray
        pressed: "#E5E5E5", // Darker light gray
        emphasis: "#D4D4D4", // Even darker gray
        // Semantic shades based on the base background color
        lightest: color.lighten(0.5).hex(),
        lighter: color.lighten(0.3).hex(),
        light: color.lighten(0.15).hex(),
        base: baseColor,
        dark: color.darken(0.15).hex(),
        darker: color.darken(0.3).hex(),
        darkest: color.darken(0.5).hex(),
        inverse: inverseBaseColor || "#000000",
      }
    }
  }

  function generateBorderColors(baseColor: string): BorderColors {
    const color = Color(baseColor)
    const luminance = color.luminosity()

    // Determine if we're working with a light or dark theme
    const isDarkTheme = luminance < 0.5

    if (isDarkTheme) {
      // Dark theme - generate borders based on the base color
      return {
        default: color.alpha(0.3).toString(), // Base color with transparency
        subtle: color.alpha(0.15).toString(), // More subtle
        strong: color.alpha(0.6).toString(), // Stronger border
        focus: color.lighten(0.2).alpha(0.8).toString(), // Lighter and more opaque for focus
      }
    } else {
      // Light theme - generate borders based on the base color
      return {
        default: color.alpha(0.4).toString(), // Base color with transparency
        subtle: color.alpha(0.2).toString(), // More subtle
        strong: color.alpha(0.7).toString(), // Stronger border
        focus: color.darken(0.2).alpha(0.8).toString(), // Darker and more opaque for focus
      }
    }
  }

  return {
    light: {
      colors: {
        // Base color variations
        ...Object.entries(colors.base.light).reduce<Record<keyof BaseColors, ColorVariations>>(
          (acc, [key, value]) => ({
            ...acc,
            [key]: generateBaseVariations(value),
          }),
          {} as Record<keyof BaseColors, ColorVariations>,
        ),
        // Surface colors
        background: generateBackgroundColors(colors.surfaces.light.background, colors.surfaces.dark.background),
        border: generateBorderColors(colors.surfaces.light.border),
        // Text colors
        text: generateTextColors(colors.text.light.default),
      },
    },
    dark: {
      colors: {
        // Base color variations
        ...Object.entries(colors.base.dark).reduce<Record<keyof BaseColors, ColorVariations>>(
          (acc, [key, value]) => ({
            ...acc,
            [key]: generateBaseVariations(value),
          }),
          {} as Record<keyof BaseColors, ColorVariations>,
        ),
        // Surface colors
        background: generateBackgroundColors(colors.surfaces.dark.background, colors.surfaces.light.background),
        border: generateBorderColors(colors.surfaces.dark.border),
        // Text colors
        text: generateTextColors(colors.text.dark.default),
      },
    },
  }
}
