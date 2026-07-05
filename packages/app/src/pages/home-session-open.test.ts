import { describe, expect, test } from "bun:test"
import { shouldOpenSessionInBackground } from "./home-session-open"

describe("shouldOpenSessionInBackground", () => {
  test("requires only the platform primary modifier", () => {
    expect(shouldOpenSessionInBackground({ mac: true, meta: true, ctrl: false, shift: false, alt: false })).toBe(true)
    expect(shouldOpenSessionInBackground({ mac: false, meta: false, ctrl: true, shift: false, alt: false })).toBe(true)
    expect(shouldOpenSessionInBackground({ mac: true, meta: true, ctrl: false, shift: true, alt: false })).toBe(false)
    expect(shouldOpenSessionInBackground({ mac: false, meta: false, ctrl: true, shift: false, alt: true })).toBe(false)
    expect(shouldOpenSessionInBackground({ mac: false, meta: true, ctrl: false, shift: false, alt: false })).toBe(false)
  })
})
