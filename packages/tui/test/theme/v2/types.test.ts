import { expect, test } from "bun:test"
import type { BackgroundDefinition, TextDefinition, ThemeDefinition, ThemeFile } from "../../../src/theme/v2"

const text = {
  default: "$hue.neutral.900",
  subdued: "$hue.neutral.600",
  action: {
    primary: { default: "$hue.neutral.100", $pressed: "$hue.neutral.200" },
    secondary: { default: "$hue.neutral.900" },
    destructive: { default: "$hue.red.100", $disabled: "$hue.neutral.500" },
  },
  feedback: {
    error: { default: "$hue.red.700", subdued: "$hue.red.600" },
  },
} satisfies TextDefinition

const background = {
  default: "$hue.neutral.100",
  action: {
    primary: { default: "$hue.accent.600", $pressed: "$hue.accent.800" },
    secondary: { default: "$hue.neutral.200" },
    destructive: { default: "$hue.red.600" },
  },
  feedback: { error: { default: "$hue.red.100" } },
} satisfies BackgroundDefinition

const definition = {
  hue: {} as ThemeDefinition["hue"],
  color: { text, background, border: { default: "$hue.neutral.300" } },
  "@context:elevated": {
    color: {
      text: { default: "$hue.neutral.800" },
      background: { default: "$hue.neutral.200" },
    },
  },
  "@context:overlay": { color: { background: { default: "$hue.neutral.300" } } },
} satisfies ThemeDefinition

const file = { version: 2, light: definition, dark: definition } satisfies ThemeFile

test("supports property-first definitions, variants, states, and contexts", () => {
  expect(text.action.primary.$pressed).toBe("$hue.neutral.200")
  expect(background.action.destructive.default).toBe("$hue.red.600")
  expect(definition["@context:elevated"].color?.text?.default).toBe("$hue.neutral.800")
  expect(definition["@context:overlay"].color?.background?.default).toBe("$hue.neutral.300")
  expect(file.light).toBe(definition)
})
