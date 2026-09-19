import { selectTheme } from "@opencode/theme/tui"
import type { BackgroundDefinition, TextDefinition, ThemeDefinition, ThemeDocument } from "@opencode/theme/tui"
import { getOpenCodeTheme } from "../../../src/theme"

const text = {
  base: "$hue.neutral.900",
  muted: "$hue.neutral.600",
  action: {
    primary: {
      base: "$hue.neutral.100",
      $hovered: "$hue.neutral.200",
      $pressed: "$hue.neutral.300",
    },
    destructive: { base: "$hue.red.100", $disabled: "$hue.neutral.500" },
  },
  formfield: { base: "$hue.neutral.600", $selected: "$hue.neutral.100" },
  feedback: {
    error: { base: "$hue.red.700", muted: "$hue.red.600" },
  },
} satisfies TextDefinition

const background = {
  base: "$hue.neutral.100",
  raised: { base: "$hue.neutral.200", high: "$hue.neutral.300", max: "$hue.neutral.400" },
  action: {
    primary: {
      base: "$hue.interactive.600",
      $hovered: "$hue.interactive.700",
      $pressed: "$hue.interactive.800",
      $selected: "$hue.interactive.700",
    },
    destructive: { base: "$hue.red.600" },
  },
  formfield: {
    base: "$hue.neutral.100",
    $hovered: "$hue.neutral.200",
    $selected: "$hue.interactive.600",
  },
  feedback: { error: { base: "$hue.red.100" } },
} satisfies BackgroundDefinition

const definition = {
  ...selectTheme(getOpenCodeTheme(), "light"),
  "@dialog": { background: { base: "$background.raised.base" } },
} satisfies ThemeDefinition

export const document = {
  base: getOpenCodeTheme().base,
  light: { hue: definition.hue },
  dark: definition,
} satisfies ThemeDocument
export const lightOnly = { base: getOpenCodeTheme().base, light: { hue: definition.hue } } satisfies ThemeDocument
export const darkOnly = { base: getOpenCodeTheme().base, dark: definition } satisfies ThemeDocument
// @ts-expect-error A theme document must provide at least one mode.
export const empty = {} satisfies ThemeDocument
// @ts-expect-error A base mode must be complete; partial tokens are only valid under @dialog.
export const partial = { base: { text, background }, light: { hue: definition.hue } } satisfies ThemeDocument
