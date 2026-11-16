import { describe, expect, test } from "bun:test"
import { LATER_DURATION, majorUpdateAutoOpen, majorUpdateOffered, majorUpdateVisible } from "./major-update"

describe("major update offer", () => {
  const now = Date.UTC(2026, 10, 13)

  test("shows only once OpenCode 2 is downloaded", () => {
    expect(majorUpdateVisible("unavailable", undefined, now)).toBe(false)
    expect(majorUpdateVisible("downloading", undefined, now)).toBe(false)
    expect(majorUpdateVisible("ready", undefined, now)).toBe(true)
  })

  test("stays hidden for a week after Later, then returns", () => {
    const laterUntil = now + LATER_DURATION

    expect(majorUpdateVisible("ready", laterUntil, now)).toBe(false)
    expect(majorUpdateVisible("ready", laterUntil, laterUntil - 1)).toBe(false)
    expect(majorUpdateVisible("ready", laterUntil, laterUntil)).toBe(true)
  })

  test("shows nothing once the user chose to upgrade", () => {
    expect(majorUpdateVisible("scheduling", undefined, now)).toBe(false)
    expect(majorUpdateVisible("scheduled", undefined, now)).toBe(false)
    expect(majorUpdateVisible("installing", undefined, now)).toBe(false)
  })

  test("can be opened from the moment OpenCode 2 is downloaded, whatever the user chose", () => {
    expect(majorUpdateOffered("unavailable")).toBe(false)
    expect(majorUpdateOffered("downloading")).toBe(false)
    expect(majorUpdateOffered("ready")).toBe(true)
    expect(majorUpdateOffered("scheduling")).toBe(true)
    expect(majorUpdateOffered("scheduled")).toBe(true)
    expect(majorUpdateOffered("installing")).toBe(true)
  })
})

describe("major update offer opening by itself", () => {
  const launch = { prompt: "launch" as const, visible: true, notes: false, dialog: false }

  test("opens in the window the app picked right after launch", () => {
    expect(majorUpdateAutoOpen(launch)).toBe(true)
  })

  test("stays closed in every window the app did not pick", () => {
    expect(majorUpdateAutoOpen({ ...launch, prompt: undefined })).toBe(false)
  })

  test("stays closed after Later", () => {
    expect(majorUpdateAutoOpen({ ...launch, visible: false })).toBe(false)
  })

  test("gives way to release notes for an OpenCode 1 update", () => {
    expect(majorUpdateAutoOpen({ ...launch, notes: true })).toBe(false)
  })

  test("never replaces a dialog that is already open", () => {
    expect(majorUpdateAutoOpen({ ...launch, dialog: true })).toBe(false)
  })

  test("always opens when the user asked for it", () => {
    expect(majorUpdateAutoOpen({ prompt: "asked", visible: false, notes: true, dialog: true })).toBe(true)
  })
})
