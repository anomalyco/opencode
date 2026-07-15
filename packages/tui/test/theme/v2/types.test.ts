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
  formfield: { default: "$hue.neutral.600", $selected: "$hue.neutral.100" },
  feedback: {
    error: { default: "$hue.red.700", subdued: "$hue.red.600" },
  },
} satisfies TextDefinition

const background = {
  default: "$hue.neutral.100",
  surface: { offset: "$hue.neutral.200", overlay: "$hue.neutral.300" },
  action: {
    primary: { default: "$hue.accent.600", $pressed: "$hue.accent.800" },
    secondary: { default: "$hue.neutral.200" },
    destructive: { default: "$hue.red.600" },
  },
  formfield: { default: "$hue.neutral.100", $selected: "$hue.accent.600" },
  feedback: { error: { default: "$hue.red.100" } },
} satisfies BackgroundDefinition

const definition = {
  hue: {} as ThemeDefinition["hue"],
  text,
  background,
  border: { default: "$hue.neutral.300" },
  "@context:elevated": {
    text: { default: "$hue.neutral.800" },
    background: { default: "$hue.neutral.200" },
  },
  "@context:overlay": { background: { default: "$hue.neutral.300" } },
} satisfies ThemeDefinition

const file = { version: 2, light: definition, dark: definition } satisfies ThemeFile

test("supports property-first definitions, variants, states, and contexts", () => {
  expect(text.action.primary.$pressed).toBe("$hue.neutral.200")
  expect(text.formfield.$selected).toBe("$hue.neutral.100")
  expect(background.action.destructive.default).toBe("$hue.red.600")
  expect(background.surface.offset).toBe("$hue.neutral.200")
  expect(definition["@context:elevated"].text?.default).toBe("$hue.neutral.800")
  expect(definition["@context:overlay"].background?.default).toBe("$hue.neutral.300")
  expect(file.light).toBe(definition)
})
