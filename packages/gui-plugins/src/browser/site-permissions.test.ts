import { describe, expect, test } from "bun:test"
import type { Storage } from "@opencode/plugin/gui/main"
import {
  clipboardWrite,
  createSitePermissions,
  originOf,
  permissionKinds,
  requesterOrigin,
  keptApplies,
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

  test("takes the asking frame's own origin, so a sandboxed or opaque document never borrows the page's", () => {
    // What Electron 44 passes, measured live: isMainFrame and requestingUrl only, for every non-media permission.
    const page = { url: "https://bank.example/probe", origin: "https://bank.example" }
    const frames = [
      page,
      { url: "https://bank.example/upload.html", origin: "null" },
      { url: "about:srcdoc", origin: "https://bank.example" },
      { url: "about:blank", origin: "https://bank.example" },
      { url: "blob:https://bank.example/0b6f", origin: "https://bank.example" },
      { url: "data:text/html,x", origin: "null" },
    ]
    const asked = (requestingUrl: string, mainFrame = false) =>
      requesterOrigin({ mainFrame, requestingUrl, main: page, frames })

    expect(asked("https://bank.example/upload.html")).toBe("null")
    expect(asked("about:srcdoc")).toBe("https://bank.example")
    expect(asked("blob:https://bank.example/0b6f")).toBe("https://bank.example")
    expect(asked("data:text/html,x")).toBe("null")
    expect(asked("https://other.example/gone")).toBe("null")
    expect(requesterOrigin({ mainFrame: true, requestingUrl: "https://bank.example/upload.html", main: { url: page.url, origin: "null" }, frames })).toBe("null")
    // Two frames at one address with different origins cannot be told apart.
    expect(requesterOrigin({ mainFrame: false, requestingUrl: "about:blank", main: page, frames: [...frames, { url: "about:blank", origin: "https://ads.example" }] })).toBe("null")
  })

  test("denies a page whose own origin is opaque, as a CSP sandbox makes it, even when its address names an allowed site", () => {
    const allowed = () => "allow" as const

    expect(siteAnswer({ origin: "null", top: "null", mainFrame: true, kinds: ["notifications"] }, allowed)).toBe("block")
    expect(siteAnswer({ origin: "https://bank.example", top: "null", mainFrame: true, kinds: ["notifications"] }, allowed)).toBe("block")
    expect(clipboardWrite({ origin: "https://bank.example", top: "null", mainFrame: true }, false)).toBe(false)
  })

  test("keys a site by the origin Chromium gives it, a local preview's included", () => {
    expect(originOf("http://127.0.0.1:7821/")).toBe("http://127.0.0.1:7821")
    expect(originOf("oc-preview://3f1c/C:/repo/page.html")).toBe("oc-preview://3f1c")
    expect(originOf("data:text/html,x")).toBe("null")
  })

  test("keeps a remote server's own machine apart from this desktop's, for reading and writing", () => {
    // Its localhost is another computer, over any scheme.
    for (const origin of ["http://localhost:3000", "https://localhost:3000", "https://127.0.0.1:8443", "https://app.localhost"])
      expect(keptApplies(origin, true)).toBe(false)
    // Through its network only TLS proves the same site; plain HTTP to a public name is not a secure context anyway.
    expect(keptApplies("https://meet.example", true)).toBe(true)
    expect(keptApplies("http://meet.example", true)).toBe(false)
    expect(keptApplies("http://localhost:3000", false)).toBe(true)
    expect(keptApplies("oc-preview://3f1c", false)).toBe(false)
  })
})

describe("the decisions the user kept", () => {
  test("keeps one decision per site and feature, never a preview's, and changes only kept ones", () => {
    const values = new Map<string, unknown>()
    let changes = 0
    // SAFETY: the site permissions read only `store` and its `value` and `set`.
    const storage = {
      store: (key: string, options: { initial: unknown }) => ({
        get value() {
          return values.has(key) ? values.get(key) : options.initial
        },
        set: (next: unknown) => values.set(key, next),
      }),
    } as unknown as Storage
    const sites = createSitePermissions(storage, () => changes++)

    sites.keep({ origin: "https://meet.example", permission: "camera", setting: "allow" })
    sites.keep({ origin: "https://meet.example", permission: "camera", setting: "block" })
    sites.keep({ origin: "oc-preview://3f1c", permission: "camera", setting: "allow" })
    sites.set({ origin: "https://other.example", permission: "camera", setting: "allow" })
    expect(sites.list()).toEqual([{ origin: "https://meet.example", permission: "camera", setting: "block" }])
    expect(sites.get("https://meet.example", "camera")).toBe("block")

    sites.set({ origin: "https://meet.example", permission: "camera", setting: "allow" })
    expect(sites.get("https://meet.example", "camera")).toBe("allow")
    sites.remove({ origin: "https://meet.example", permission: "camera" })
    expect(sites.list()).toEqual([])
    expect(changes).toBe(4)
  })
})
