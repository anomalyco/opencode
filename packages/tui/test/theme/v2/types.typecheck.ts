import type { BackgroundDefinition, TextDefinition, ThemeDefinition, ThemeDocument } from "@opencode-ai/theme/tui"

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
  surface: { offset: "$hue.neutral.200", overlay: "$hue.neutral.300" },
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
  hue: {} as ThemeDefinition["hue"],
  categorical: ["blue", "accent"],
  text,
  background,
  border: { default: "$hue.neutral.300" },
  "@context:elevated": {
    text: { default: "$hue.neutral.800" },
    background: { default: "$hue.neutral.200" },
  },
  "@context:overlay": { background: { default: "$hue.neutral.300" } },
} satisfies ThemeDefinition

export const document = { version: 2, light: definition, dark: definition } satisfies ThemeDocument
export const lightOnly = { version: 2, light: definition } satisfies ThemeDocument
export const darkOnly = { version: 2, dark: definition } satisfies ThemeDocument
// @ts-expect-error A theme document must provide at least one mode.
export const empty = { version: 2 } satisfies ThemeDocument
