import { describe, expect, test } from "bun:test"
import { updaterPill } from "./action"

describe("updater pill", () => {
  test("shows nothing before a check finds an update", () => {
    expect(updaterPill(undefined)).toBeUndefined()
    expect(updaterPill({ status: "idle" })).toBeUndefined()
    expect(updaterPill({ status: "checking" })).toBeUndefined()
    expect(updaterPill({ status: "up-to-date" })).toBeUndefined()
    expect(updaterPill({ status: "error", message: "boom" })).toBeUndefined()
    expect(updaterPill({ status: "disabled" })).toBeUndefined()
  })

  // A check that finds a release downloads it at once, so this is the first state a user can see. It used to be the only
  // one with no pill, which left the whole download with no sign of an update anywhere in the window.
  test("a download shows busy and does not install yet", () => {
    expect(updaterPill({ status: "downloading", version: "2.4.1" })).toEqual({
      label: "action.downloading",
      busy: true,
      install: false,
    })
  })

  test("a downloaded update offers the restart", () => {
    expect(updaterPill({ status: "ready", version: "2.4.1" })).toEqual({
      label: "action.installRestart",
      busy: false,
      install: true,
    })
  })

  test("an update with its own installer offers the download", () => {
    expect(updaterPill({ status: "download-required", version: "2.4.1" })).toEqual({
      label: "action.download",
      busy: false,
      install: true,
    })
  })

  test("installing stays busy until the app restarts", () => {
    expect(updaterPill({ status: "installing", version: "2.4.1" })).toEqual({
      label: "action.installing",
      busy: true,
      install: true,
    })
  })

  test("the window's own install shows on a ready update before main reports it", () => {
    expect(updaterPill({ status: "ready", version: "2.4.1" }, { status: "installing", attempt: 2 })).toEqual({
      label: "action.installing",
      busy: false,
      install: true,
    })
  })
})
