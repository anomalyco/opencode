import { describe, expect, test } from "bun:test"
import { hasExistingAppState } from "./install-state"

const file = (name: string) => ({ name, directory: false })

const directory = (name: string) => ({ name, directory: true })

describe("hasExistingAppState", () => {
  test("recognizes state from an earlier OpenCode launch but not files Electron creates on a fresh install", () => {
    expect(hasExistingAppState([])).toBe(false)
    expect(hasExistingAppState([file("Local State"), directory("Crashpad")])).toBe(false)
  })

  test("recognizes state written by an earlier Bolt launch", () => {
    expect(hasExistingAppState([file("bolt.settings")])).toBe(true)
    expect(hasExistingAppState([file("bolt.global.dat")])).toBe(true)
    expect(hasExistingAppState([file("window-state-abc.json")])).toBe(true)
    expect(hasExistingAppState([directory("bolt")])).toBe(true)
  })
})
