import { expect, test } from "bun:test"
import { App } from "@opencode-ai/core/app"

test("formats app metadata as a user agent", () => {
  expect(App.useragent(App.make({ name: "sdk", version: "1.2.3", channel: "beta" }))).toBe(
    "opencode/beta/1.2.3/sdk",
  )
})
