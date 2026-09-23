import { expect, test } from "bun:test"
import { configureStableUpdates } from "./config"

test("stable updates do not install older releases", () => {
  const client = {
    channel: null,
    allowPrerelease: null,
    allowDowngrade: true,
  }

  configureStableUpdates(client)

  expect(client).toEqual({
    channel: "latest",
    allowPrerelease: false,
    allowDowngrade: false,
  })
})
