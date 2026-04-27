import { describe, expect, test } from "bun:test"
import { isUpdaterEnabled } from "./updater-support"

describe("updater support", () => {
  test("disables updater for unpackaged or dev builds", () => {
    expect(
      isUpdaterEnabled({
        isPackaged: false,
        channel: "prod",
        platform: "darwin",
        appImage: undefined,
      }),
    ).toBe(false)

    expect(
      isUpdaterEnabled({
        isPackaged: true,
        channel: "dev",
        platform: "darwin",
        appImage: undefined,
      }),
    ).toBe(false)
  })

  test("enables updater on packaged non-linux builds", () => {
    expect(
      isUpdaterEnabled({
        isPackaged: true,
        channel: "prod",
        platform: "win32",
        appImage: undefined,
      }),
    ).toBe(true)
  })

  test("enables linux updater only for AppImage", () => {
    expect(
      isUpdaterEnabled({
        isPackaged: true,
        channel: "prod",
        platform: "linux",
        appImage: undefined,
      }),
    ).toBe(false)

    expect(
      isUpdaterEnabled({
        isPackaged: true,
        channel: "prod",
        platform: "linux",
        appImage: "/tmp/OpenCode.AppImage",
      }),
    ).toBe(true)
  })
})
