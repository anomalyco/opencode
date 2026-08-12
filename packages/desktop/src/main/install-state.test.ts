import { describe, expect, test } from "bun:test"
import { hasExistingAppState, hasExistingAppStateAny } from "./install-state"

const file = (name: string) => ({ name, isDirectory: () => false })
const directory = (name: string) => ({ name, isDirectory: () => true })

describe("hasExistingAppState", () => {
  test("ignores files Electron may create on a fresh install", () => {
    expect(hasExistingAppState([])).toBe(false)
    expect(hasExistingAppState([file("Local State"), directory("Crashpad")])).toBe(false)
  })

  test("recognizes state written by an earlier OpenCode launch", () => {
    expect(hasExistingAppState([file("opencode.settings")])).toBe(true)
    expect(hasExistingAppState([file("opencode.global.dat")])).toBe(true)
    expect(hasExistingAppState([file("window-state-abc.json")])).toBe(true)
    expect(hasExistingAppState([directory("opencode")])).toBe(true)
  })
})

describe("hasExistingAppStateAny", () => {
  test("recognizes state in any of the provided directories", () => {
    expect(hasExistingAppStateAny([file("Local State")], [file("opencode.settings")])).toBe(true)
    expect(hasExistingAppStateAny([file("Local State")], [file("opencode.global.dat")])).toBe(true)
    expect(hasExistingAppStateAny([file("Local State")], [file("window-state-abc.json")])).toBe(true)
    expect(hasExistingAppStateAny([file("Local State")], [directory("opencode")])).toBe(true)
  })

  test("returns false when no directory has existing state", () => {
    expect(hasExistingAppStateAny([file("Local State"), directory("Crashpad")], [])).toBe(false)
  })
})
