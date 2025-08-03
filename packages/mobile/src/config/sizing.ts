export const sizing = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  mega: 28,
  giga: 32,
  tera: 36,
  peta: 40,
  exa: 44,
} as const

export const spacing = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 40,
  mega: 48,
  giga: 56,
  tera: 64,
} as const

export const radius = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 20,
  mega: 24,
  giga: 28,
  tera: 32,
  peta: 36,
  exa: 40,
  full: 9999,
} as const

export const typography = {
  size: {
    xs: 10,
    sm: 12,
    md: 14,
    lg: 16,
    xl: 18,
    xxl: 20,
    mega: 24,
    giga: 36,
    tera: 48,
    peta: 60,
  },
  leading: {
    none: 1,
    tight: 1.25,
    snug: 1.375,
    normal: 1.5,
    relaxed: 1.625,
    loose: 2,
  },
  weight: {
    thin: "400",
    light: "400",
    regular: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
    heavy: "700",
  },
  family: {
    sans: undefined, // We'll set these when we add custom fonts
    mono: "BerkeleyMonoVariable-Regular",
  },
} as const

// Layout constraints
export const layout = {
  maxWidth: {
    xs: 320,
    sm: 384,
    md: 448,
    lg: 512,
    xl: 576,
    xxl: 672,
    mega: 768,
    giga: 896,
    tera: 1024,
    peta: 1152,
    exa: 1280,
  },
} as const
