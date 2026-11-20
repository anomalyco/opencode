import { describe, expect, test } from "bun:test"
import type { Storage } from "@opencode/plugin/gui/main"
import {
  clipboardWrite,
  createSitePermissions,
  originOf,
  permissionKinds,
  requesterOrigin,
  decisionKey,
  decisionLife,
  siteAnswer,
  trustworthy,
  type DecisionScope,
  type PermissionKind,
} from "./site-permissions"

const top = { origin: "https://meet.example", top: "https://meet.example", mainFrame: true, agentDriven: false }

const undecided = { kept: () => undefined, visit: () => undefined }

const allowed = { kept: () => "allow" as const, visit: () => undefined }

describe("what a page's permission request gets before anyone is asked", () => {
  test("asks for the features it lists, and denies every other one without asking", () => {
    expect(permissionKinds("media", ["video", "audio"])).toEqual(["camera", "microphone"])
    expect(permissionKinds("geolocation")).toEqual(["location"])

    for (const permission of ["usb", "hid", "serial", "midiSysex", "display-capture", "openExternal", "media"])
      expect(siteAnswer({ ...top, kinds: permissionKinds(permission) }, undecided)).toBe("block")
    expect(siteAnswer({ ...top, kinds: ["camera"] }, undecided)).toBe("ask")
  })

  test("follows the decision for each feature: all allowed allows, any blocked blocks", () => {
    const decided = (settings: Partial<Record<PermissionKind, "allow" | "block">>) => ({ kept: (kind: PermissionKind) => settings[kind], visit: () => undefined })

    expect(siteAnswer({ ...top, kinds: ["camera", "microphone"] }, decided({ camera: "allow", microphone: "allow" }))).toBe("allow")
    expect(siteAnswer({ ...top, kinds: ["camera", "microphone"] }, decided({ camera: "allow" }))).toBe("ask")
    expect(siteAnswer({ ...top, kinds: ["camera", "microphone"] }, decided({ camera: "allow", microphone: "block" }))).toBe("block")
  })

  test("denies an embedded page of another origin even when the top site is allowed", () => {

    expect(siteAnswer({ origin: "https://ads.example", top: "https://meet.example", mainFrame: false, agentDriven: false, kinds: ["camera"] }, allowed)).toBe("block")
    expect(siteAnswer({ origin: "https://meet.example", top: "https://meet.example", mainFrame: false, agentDriven: false, kinds: ["camera"] }, allowed)).toBe("allow")
    expect(siteAnswer({ origin: "null", top: "https://meet.example", mainFrame: false, agentDriven: false, kinds: ["camera"] }, allowed)).toBe("block")
  })

  test("needs a secure context, as Chromium counts one", () => {
    for (const origin of ["https://a.example", "http://localhost:3000", "http://app.localhost", "http://127.0.0.1:8080", "http://[::1]:5173", "oc-preview://3f1c"])
      expect(trustworthy(origin)).toBe(true)

    for (const origin of ["http://a.example", "http://192.168.1.4", "ftp://a.example", "null"]) {
      expect(trustworthy(origin)).toBe(false)
      expect(siteAnswer({ origin, top: origin, mainFrame: true, agentDriven: false, kinds: ["notifications"] }, allowed)).toBe("block")
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

    expect(siteAnswer({ origin: "null", top: "null", mainFrame: true, agentDriven: false, kinds: ["notifications"] }, allowed)).toBe("block")
    expect(siteAnswer({ origin: "https://bank.example", top: "null", mainFrame: true, agentDriven: false, kinds: ["notifications"] }, allowed)).toBe("block")
    expect(clipboardWrite({ origin: "https://bank.example", top: "null", mainFrame: true }, false)).toBe(false)
  })

  test("keys a site by the origin Chromium gives it, a local preview's included", () => {
    expect(originOf("http://127.0.0.1:7821/")).toBe("http://127.0.0.1:7821")
    expect(originOf("oc-preview://3f1c/C:/repo/page.html")).toBe("oc-preview://3f1c")
    expect(originOf("data:text/html,x")).toBe("null")
  })
})

describe("whose decisions apply to a request", () => {
  const meet = { origin: "https://meet.example", top: "https://meet.example", mainFrame: true, kinds: ["microphone"] as const }
  const profile = { kind: "profile" } as const
  const server = { kind: "server", partition: "opencode-remote-a" } as const
  const other = { kind: "server", partition: "opencode-remote-b" } as const

  // A store keyed only by decisionKey, as createSitePermissions keys a server's decisions.
  const store = (decisions: [DecisionScope, string, PermissionKind, "allow" | "block"][]) => {
    const kept = new Map(decisions.map(([scope, origin, kind, setting]) => [decisionKey(scope, origin, kind), setting]))

    return (scope: DecisionScope, visit: Partial<Record<PermissionKind, "allow" | "block">> = {}) => ({
      kept: (kind: PermissionKind) => kept.get(decisionKey(scope, meet.origin, kind)),
      visit: (kind: PermissionKind) => visit[kind],
    })
  }

  test("an allow the user gave applies only in a tab the user drives", () => {
    const decided = store([[profile, meet.origin, "microphone", "allow"]])

    expect(siteAnswer({ ...meet, agentDriven: false }, decided(profile))).toBe("allow")
    expect(siteAnswer({ ...meet, agentDriven: true }, decided(profile))).toBe("ask")
    // This visit's allow too: the agent's script asks again.
    expect(siteAnswer({ ...meet, agentDriven: true }, store([])(profile, { microphone: "allow" }))).toBe("ask")
  })

  test("a block, kept or for the visit, blocks whoever drives the tab", () => {
    for (const agentDriven of [false, true]) {
      expect(siteAnswer({ ...meet, agentDriven }, store([[profile, meet.origin, "microphone", "block"]])(profile, { microphone: "allow" }))).toBe("block")
      expect(siteAnswer({ ...meet, agentDriven }, store([[profile, meet.origin, "microphone", "allow"]])(profile, { microphone: "block" }))).toBe("block")
    }
  })

  test("a decision stays in the partition it was made in, both ways and between servers", () => {
    const decided = store([
      [profile, meet.origin, "microphone", "allow"],
      [server, meet.origin, "camera", "allow"],
    ])

    expect(siteAnswer({ ...meet, agentDriven: false }, decided(server))).toBe("ask")
    expect(siteAnswer({ ...meet, kinds: ["camera"], agentDriven: false }, decided(profile))).toBe("ask")
    expect(siteAnswer({ ...meet, kinds: ["camera"], agentDriven: false }, decided(server))).toBe("allow")
    expect(siteAnswer({ ...meet, kinds: ["camera"], agentDriven: false }, decided(other))).toBe("ask")
  })

  test("a decision outlives its visit in the profile, for a server's run, and never for a preview", () => {
    expect(decisionLife(profile, "https://meet.example")).toBe("kept")
    expect(decisionLife(profile, "http://localhost:3000")).toBe("kept")
    // A server's localhost is another computer: its decisions are its own, never this desktop's.
    expect(decisionLife(server, "http://localhost:3000")).toBe("session")
    expect(decisionLife(server, "https://meet.example")).toBe("session")
    expect(decisionLife(profile, "oc-preview://3f1c")).toBe("visit")
    expect(decisionKey(server, "https://meet.example", "camera")).not.toBe(decisionKey(profile, "https://meet.example", "camera"))
    expect(decisionKey(server, "https://meet.example", "camera")).not.toBe(decisionKey(other, "https://meet.example", "camera"))
  })
})

describe("the decisions the user kept", () => {
  test("keeps one decision per site and feature, never a preview's, and changes only kept ones", () => {
    const values = new Map<string, unknown>()
    let changes = 0

    // SAFETY: the site permissions read only `store` and its `value` and `set`.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
    const storage = {
      store: (key: string, options: { initial: unknown }) => ({
        get value() {
          return values.has(key) ? values.get(key) : options.initial
        },
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- see SAFETY above
        set: (next: unknown) => values.set(key, next),
      }),
    } as unknown as Storage

    const sites = createSitePermissions(storage, () => changes++)
    const profile = { kind: "profile" } as const
    const server = { kind: "server", partition: "opencode-remote-a" } as const

    sites.keep(profile, { origin: "https://meet.example", permission: "camera", setting: "allow" })
    sites.keep(profile, { origin: "https://meet.example", permission: "camera", setting: "block" })
    sites.keep(profile, { origin: "oc-preview://3f1c", permission: "camera", setting: "allow" })
    sites.set({ origin: "https://other.example", permission: "camera", setting: "allow" })
    expect(sites.list()).toEqual([{ origin: "https://meet.example", permission: "camera", setting: "block" }])
    expect(sites.get(profile, "https://meet.example", "camera")).toBe("block")

    // A server's decision is kept in memory for it alone, and Settings never lists it.
    sites.keep(server, { origin: "https://meet.example", permission: "microphone", setting: "allow" })
    expect(sites.get(server, "https://meet.example", "microphone")).toBe("allow")
    expect(sites.get(profile, "https://meet.example", "microphone")).toBeUndefined()
    expect(sites.get(server, "https://meet.example", "camera")).toBeUndefined()
    expect(sites.list()).toHaveLength(1)

    sites.set({ origin: "https://meet.example", permission: "camera", setting: "allow" })
    expect(sites.get(profile, "https://meet.example", "camera")).toBe("allow")
    sites.remove({ origin: "https://meet.example", permission: "camera" })
    expect(sites.list()).toEqual([])
    expect(changes).toBe(4)
  })
})
