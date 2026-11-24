import { expect, test } from "bun:test"
import { siteSettingsSchema } from "~/component/site/settings"
import defaults from "~/component/site/settings-defaults.json"

// Production renders these instead of parsing with the schema (settings.ts), so they must be exactly
// what the schema gives, in the same order. Regenerate with `bun script/settings-defaults.ts`.
test("settings-defaults.json matches the settings schema's defaults", () => {
  expect(JSON.stringify(defaults)).toBe(JSON.stringify(siteSettingsSchema().parse({})))
})
