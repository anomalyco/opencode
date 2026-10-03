import { describe, expect, test } from "bun:test"
import { hasExistingAppState } from "./install-state"

const file = (name: string) => ({ name, isDirectory: () => false })
const directory = (name: string) => ({ name, isDirectory: () => true })

describe("hasExistingAppState", () => {
  test("ignores files Electron may create on a fresh install", () => {
    expect(hasExistingAppState([])).toBe(false)
    expect(hasExistingAppState([file("Local State"), directory("Crashpad")])).toBe(false)
    expect(hasExistingAppState([file("unrelated.dat")])).toBe(false)
    expect(hasExistingAppState([directory("opencode.global.dat")])).toBe(false)
  })

  test("recognizes state written by an earlier OpenCode launch", () => {
    expect(hasExistingAppState([file("opencode.settings")])).toBe(true)
    expect(hasExistingAppState([file("default.dat")])).toBe(true)
    expect(hasExistingAppState([file("opencode.settings.dat")])).toBe(true)
    expect(hasExistingAppState([file("opencode.global.dat")])).toBe(true)
    expect(hasExistingAppState([file("opencode.workspace.project.hash.dat")])).toBe(true)
    expect(hasExistingAppState([file("opencode.draft.session.hash.dat")])).toBe(true)
    expect(hasExistingAppState([file("opencode.window.main.dat")])).toBe(true)
    expect(hasExistingAppState([file("window-state-abc.json")])).toBe(true)
    expect(hasExistingAppState([directory("opencode")])).toBe(true)
  })
})
