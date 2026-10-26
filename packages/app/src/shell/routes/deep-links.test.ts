import { describe, expect, test } from "bun:test"
import { ServerConnection } from "@/runtime/server/registry"
import type { Tab } from "@/shell/tabs/tabs"
import { parseAppDeepLink, resolveDeepLinkServer, routeAppDeepLink } from "./deep-links"

const sidecar: ServerConnection.Sidecar = {
  type: "sidecar",
  variant: "base",
  http: { url: "http://127.0.0.1:4096" },
}

const remote: ServerConnection.Http = {
  type: "http",
  http: { url: "https://studio.taila8e7c7.ts.net:4096" },
}

describe("app deep-link routing", () => {
  test("parses session, draft, and last-session deep links and rejects invalid targets", () => {
    expect(
      parseAppDeepLink(
        "opencode://session/ses_newer?dir=%2Fwork%2Fapp&project=prj_app&server=a1b2c3d4e5f6&url=https%3A%2F%2Fstudio.taila8e7c7.ts.net%3A4096",
      ),
    ).toEqual({
      type: "session",
      sessionID: "ses_newer",
      directory: "/work/app",
      projectID: "prj_app",
      serverKey: "a1b2c3d4e5f6",
      machineHost: undefined,
      serverURLs: ["https://studio.taila8e7c7.ts.net:4096"],
    })

    expect(parseAppDeepLink("opencode://new-session?dir=%2Fwork%2Fdocs")).toEqual({
      type: "draft",
      directory: "/work/docs",
      projectID: undefined,
      serverKey: undefined,
    })

    expect(parseAppDeepLink("opencode://last-session")).toEqual({
      type: "last-session",
      serverKey: undefined,
    })

    expect(parseAppDeepLink("opencode://session/not_a_session")).toBeUndefined()
    expect(parseAppDeepLink("opencode://console/authorized?window=1")).toBeUndefined()
    expect(parseAppDeepLink("https://example.com/session/ses_1")).toBeUndefined()
  })

  test("resolves matching remote server by origin or falls back to the local sidecar", () => {
    const remoteLink = parseAppDeepLink(
      "opencode://session/ses_newer?url=https%3A%2F%2Fstudio.taila8e7c7.ts.net%3A4096",
    )!
    expect(resolveDeepLinkServer(remoteLink, [sidecar, remote], [])).toBe(ServerConnection.key(remote))

    const handoffFromPhone = parseAppDeepLink("opencode://session/ses_local?url=http%3A%2F%2F100.84.220.87%3A4096")!
    expect(resolveDeepLinkServer(handoffFromPhone, [sidecar], [])).toBe(ServerConnection.key(sidecar))
  })

  test("opens the project worktree and selects the session tab when routing a session deep link", () => {
    const calls: string[] = []
    const serverKey = ServerConnection.key(sidecar)
    const sessionTab: Tab = { type: "session", server: serverKey, sessionId: "ses_handoff" }

    const handled = routeAppDeepLink("opencode://session/ses_handoff?dir=%2FUsers%2Fkit%2Fcode%2Fopencode", {
      servers: {
        list: [sidecar],
        projects: {
          forServer: (key) => ({
            list: () => [],
            open: (dir) => calls.push(`open:${key}:${dir}`),
            last: () => undefined,
            touch: (dir) => calls.push(`touch:${key}:${dir}`),
          }),
        },
      },
      tabs: {
        store: [],
        addSessionTab: (input) => {
          calls.push(`add:${input.server}:${input.sessionId}`)
          return sessionTab
        },
        rememberSessionRoute: (_tab, sessionID) => {
          calls.push(`route:${sessionID}`)
        },
        select: (tab) => {
          calls.push(`select:${tab.type === "session" ? tab.sessionId : tab.draftID}`)
        },
        newDraft: async () => {
          throw new Error("unexpected")
        },
      },
    })

    expect(handled).toBe(true)
    expect(calls).toEqual([
      "open:sidecar:/Users/kit/code/opencode",
      "touch:sidecar:/Users/kit/code/opencode",
      "add:sidecar:ses_handoff",
      "route:ses_handoff",
      "select:ses_handoff",
    ])
  })
})
