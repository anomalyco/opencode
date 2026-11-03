import { expect, test } from "bun:test"
import { App } from "@opencode/core/app"

test("formats app metadata as a user agent", () => {
  expect(App.useragent(App.make({ name: "sdk", version: "1.2.3", channel: "beta" }))).toBe("opencode/beta/1.2.3/sdk")
  expect(App.useragent(App.make({ name: "cli", version: "local", channel: "local" }))).toMatch(
    /^opencode\/local\/\d+\.\d+\.\d+\/cli$/,
  )
  expect(App.useragent(App.make())).toMatch(/^opencode\/latest\/\d+\.\d+\.\d+\/opencode$/)
  expect(App.useragent(App.make({ name: "opencode", version: "unknown", channel: "unknown" }))).toMatch(
    /^opencode\/latest\/\d+\.\d+\.\d+\/opencode$/,
  )
})
