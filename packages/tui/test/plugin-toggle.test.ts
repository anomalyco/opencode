import { expect, test } from "bun:test"
import { ConfigPlugin } from "../src/config"

test("plugin toggles replace exact directives without disturbing source declarations", () => {
  const source = { package: "/tmp/recap.ts", options: { compact: true } }
  const config = { plugins: [source, "kit.session-recap", "-kit.session-recap", "other"] }

  ConfigPlugin.setEnabled(config, "kit.session-recap", false)
  expect(config.plugins).toEqual([source, "other", "-kit.session-recap"])

  ConfigPlugin.setEnabled(config, "kit.session-recap", true)
  expect(config.plugins).toEqual([source, "other", "kit.session-recap"])
})
