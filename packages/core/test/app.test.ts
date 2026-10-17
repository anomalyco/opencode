import { expect, test } from "bun:test"
import { App } from "@opencode/core/app"

test("formats app metadata as a user agent", () => {
  expect(App.useragent(App.make({ name: "sdk", version: "1.2.3", channel: "beta" }))).toBe("opencode/beta/1.2.3/sdk")
})

test("preserves the embedded server metadata", () => {
  expect(
    App.make({
      server: { url: "http://127.0.0.1:4096", password: "secret" },
    }).server,
  ).toEqual({ url: "http://127.0.0.1:4096", password: "secret" })
})
