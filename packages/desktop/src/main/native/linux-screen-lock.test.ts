import { describe, expect, test } from "bun:test"
import {
  login1Locked,
  parseGdbusBoolean,
  parseLogin1Changed,
  parseLogin1SessionPath,
} from "./linux-screen-lock"

describe("linux screen lock hints", () => {
  test("parses only the login1 session dictionary", () => {
    expect(
      parseLogin1Changed(
        "/org/freedesktop/login1/session/_32: org.freedesktop.DBus.Properties.PropertiesChanged (org.freedesktop.login1.Session, {'LockedHint': <true>, 'Active': <true>}, @as [])",
      ),
    ).toEqual({ locked: true, active: true })

    expect(
      parseLogin1Changed(
        "/org/freedesktop/login1/session/_32: org.freedesktop.DBus.Properties.PropertiesChanged (org.freedesktop.login1.Session, {'LockedHint': <false>}, @as [])",
      ),
    ).toEqual({ locked: false })

    expect(
      parseLogin1Changed(
        "/org/freedesktop/login1/session/_32: org.freedesktop.login1.Session.PropertiesChanged (org.freedesktop.login1.Session, {'Active': <false>}, @as [])",
      ),
    ).toEqual({})
    expect(parseLogin1Changed("IdleHint boolean true")).toEqual({})
  })

  test("ignores an IdleHint on a later line instead of carrying the property across the signal", () => {
    const lines = [
      "/org/freedesktop/login1/session/_32: org.freedesktop.DBus.Properties.PropertiesChanged (org.freedesktop.login1.Session, {'IdleHint': <true>}, @as [])",
      "/org/freedesktop/login1/session/_32: org.freedesktop.login1.Session.Unlock ()",
      "   boolean true",
    ]

    expect(lines.map(parseLogin1Changed)).toEqual([{}, {}, {}])
  })

  test("reads a gdbus Properties.Get boolean reply", () => {
    expect(parseGdbusBoolean("(<true>,)")).toBe(true)
    expect(parseGdbusBoolean("(<false>,)")).toBe(false)
    expect(parseGdbusBoolean("()")).toBeUndefined()
  })

  test("reads lock and active from login1 without treating an unknown lock hint as unlocked", () => {
    expect(login1Locked(true, true)).toBe(true)
    expect(login1Locked(undefined, false)).toBe(true)
    expect(login1Locked(false, true)).toBe(false)
    expect(login1Locked(undefined, true)).toBeUndefined()
    expect(login1Locked(undefined, undefined)).toBeUndefined()
  })

  test("reads a login1 session path from PID lookup or the user display fallback", () => {
    expect(parseLogin1SessionPath("(objectpath '/org/freedesktop/login1/session/_32',)")).toBe(
      "/org/freedesktop/login1/session/_32",
    )
    expect(parseLogin1SessionPath("(objectpath '/org/freedesktop/login1/session/c2',)")).toBe(
      "/org/freedesktop/login1/session/c2",
    )
    expect(parseLogin1SessionPath("()")).toBeUndefined()
  })
})

