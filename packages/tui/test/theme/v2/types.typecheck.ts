import { DEFAULT_THEME, selectTheme } from "@opencode/theme/tui"
import type { BackgroundDefinition, TextDefinition, ThemeDefinition, ThemeDocument } from "@opencode/theme/tui"

const text = {
  default: "$hue.neutral.900",
  subdued: "$hue.neutral.600",
  action: {
    primary: {
      default: "$hue.neutral.100",
      $hovered: "$hue.neutral.200",
      $pressed: "$hue.neutral.300",
    },
    destructive: { default: "$hue.red.100", $disabled: "$hue.neutral.500" },
  },
  formfield: { default: "$hue.neutral.600", $selected: "$hue.neutral.100" },
  feedback: {
    error: { default: "$hue.red.700", subdued: "$hue.red.600" },
  },
} satisfies TextDefinition

const background = {
  default: "$hue.neutral.100",
  raised: { base: "$hue.neutral.200", high: "$hue.neutral.300", max: "$hue.neutral.400" },
  action: {
    primary: {
      default: "$hue.interactive.600",
      $hovered: "$hue.interactive.700",
      $pressed: "$hue.interactive.800",
      $selected: "$hue.interactive.700",
    },
    destructive: { default: "$hue.red.600" },
  },
  formfield: {
    default: "$hue.neutral.100",
    $hovered: "$hue.neutral.200",
    $selected: "$hue.interactive.600",
  },
  feedback: { error: { default: "$hue.red.100" } },
} satisfies BackgroundDefinition

const definition = {
  ...selectTheme(DEFAULT_THEME, "light"),
  "@dialog": { background: { default: "$background.raised.base" } },
} satisfies ThemeDefinition

export const document = {
  version: 2,
  base: DEFAULT_THEME.base,
  light: { hue: definition.hue },
  dark: definition,
} satisfies ThemeDocument
export const lightOnly = { version: 2, base: DEFAULT_THEME.base, light: { hue: definition.hue } } satisfies ThemeDocument
export const darkOnly = { version: 2, base: DEFAULT_THEME.base, dark: definition } satisfies ThemeDocument
// @ts-expect-error A theme document must provide at least one mode.
export const empty = { version: 2 } satisfies ThemeDocument
// @ts-expect-error A base mode must be complete; partial tokens are only valid under @dialog.
export const partial = { version: 2, base: { text, background }, light: { hue: definition.hue } } satisfies ThemeDocument
