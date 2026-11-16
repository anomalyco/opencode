import { describe, expect, test } from "bun:test"
import {
  clipboardWrite,
  originOf,
  permissionKinds,
  rememberable,
  siteAnswer,
  trustworthy,
  type PermissionKind,
} from "./site-permissions"

const top = { origin: "https://meet.example", top: "https://meet.example", mainFrame: true }

const undecided = () => undefined

describe("what a page's permission request gets before anyone is asked", () => {
  test("asks for the features it lists, and denies every other one without asking", () => {
    expect(permissionKinds("media", ["video", "audio"])).toEqual(["camera", "microphone"])
    expect(permissionKinds("geolocation")).toEqual(["location"])

    for (const permission of ["usb", "hid", "serial", "midiSysex", "display-capture", "openExternal", "media"])
      expect(siteAnswer({ ...top, kinds: permissionKinds(permission) }, undecided)).toBe("block")
    expect(siteAnswer({ ...top, kinds: ["camera"] }, undecided)).toBe("ask")
  })

  test("follows the decision for each feature: all allowed allows, any blocked blocks", () => {
    const decided = (settings: Partial<Record<PermissionKind, "allow" | "block">>) => (kind: PermissionKind) => settings[kind]

    expect(siteAnswer({ ...top, kinds: ["camera", "microphone"] }, decided({ camera: "allow", microphone: "allow" }))).toBe("allow")
    expect(siteAnswer({ ...top, kinds: ["camera", "microphone"] }, decided({ camera: "allow" }))).toBe("ask")
    expect(siteAnswer({ ...top, kinds: ["camera", "microphone"] }, decided({ camera: "allow", microphone: "block" }))).toBe("block")
  })

  test("denies an embedded page of another origin even when the top site is allowed", () => {
    const allowed = () => "allow" as const

    expect(siteAnswer({ origin: "https://ads.example", top: "https://meet.example", mainFrame: false, kinds: ["camera"] }, allowed)).toBe("block")
    expect(siteAnswer({ origin: "https://meet.example", top: "https://meet.example", mainFrame: false, kinds: ["camera"] }, allowed)).toBe("allow")
    expect(siteAnswer({ origin: "null", top: "https://meet.example", mainFrame: false, kinds: ["camera"] }, allowed)).toBe("block")
  })

  test("needs a secure context, as Chromium counts one", () => {
    for (const origin of ["https://a.example", "http://localhost:3000", "http://app.localhost", "http://127.0.0.1:8080", "http://[::1]:5173", "oc-preview://3f1c"])
      expect(trustworthy(origin)).toBe(true)

    for (const origin of ["http://a.example", "http://192.168.1.4", "ftp://a.example", "null"]) {
      expect(trustworthy(origin)).toBe(false)
      expect(siteAnswer({ origin, top: origin, mainFrame: true, kinds: ["notifications"] }, () => "allow")).toBe("block")
    }
  })

  test("lets a secure page write the clipboard as Chrome does, but not while the agent drives the tab", () => {
    expect(clipboardWrite(top, false)).toBe(true)
    expect(clipboardWrite(top, true)).toBe(false)
    expect(clipboardWrite({ ...top, origin: "http://a.example", top: "http://a.example" }, false)).toBe(false)
  })

  test("keys a site by the origin Chromium gives it, a local preview's included", () => {
    expect(originOf("http://127.0.0.1:7821/")).toBe("http://127.0.0.1:7821")
    expect(originOf("oc-preview://3f1c/C:/repo/page.html")).toBe("oc-preview://3f1c")
    expect(originOf("data:text/html,x")).toBe("null")
  })

  test("keeps no decision for a local preview, nor for a remote server's own machine", () => {
    expect(rememberable("oc-preview://3f1c", false)).toBe(false)
    expect(rememberable("http://localhost:3000", true)).toBe(false)
    expect(rememberable("http://localhost:3000", false)).toBe(true)
    expect(rememberable("https://meet.example", true)).toBe(true)
  })
})
