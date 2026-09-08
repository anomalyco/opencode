import { describe, expect, test } from "bun:test"
import { shouldOpenSessionInBackground } from "./home-session-open"

describe("shouldOpenSessionInBackground", () => {
  test("opens middle clicks in the background", () => {
    expect(
      shouldOpenSessionInBackground({ button: 1, mac: true, meta: false, ctrl: false, shift: false, alt: false }),
    ).toBe(true)
    expect(
      shouldOpenSessionInBackground({ button: 2, mac: true, meta: false, ctrl: false, shift: false, alt: false }),
    ).toBe(false)
  })

  test("requires only the platform primary modifier", () => {
    expect(
      shouldOpenSessionInBackground({ button: 0, mac: true, meta: true, ctrl: false, shift: false, alt: false }),
    ).toBe(true)
    expect(
      shouldOpenSessionInBackground({ button: 0, mac: false, meta: false, ctrl: true, shift: false, alt: false }),
    ).toBe(true)
    expect(
      shouldOpenSessionInBackground({ button: 0, mac: true, meta: true, ctrl: false, shift: true, alt: false }),
    ).toBe(false)
    expect(
      shouldOpenSessionInBackground({ button: 0, mac: false, meta: false, ctrl: true, shift: false, alt: true }),
    ).toBe(false)
    expect(
      shouldOpenSessionInBackground({ button: 0, mac: false, meta: true, ctrl: false, shift: false, alt: false }),
    ).toBe(false)
  })
})
