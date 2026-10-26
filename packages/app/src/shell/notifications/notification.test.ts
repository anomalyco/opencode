import { expect, test } from "bun:test"
import { ServerConnection } from "@/runtime/server/registry"
import type { Tab } from "@/shell/tabs/tabs"
import { openNotificationSession } from "./notification"

test("opens notification sessions through the tab router, leaving a subagent the tab showed", () => {
  const server = ServerConnection.Key.make("local\nhttp://localhost:4096")
  const tab = { type: "session" as const, server, sessionId: "session-1", routeSessionId: "child" }
  const calls: string[] = []

  const tabs = {
    addSessionTab: (input: { sessionId: string; routeSessionId?: string }) => {
      calls.push(`add:${input.sessionId}>${input.routeSessionId}`)

      return tab
    },
    rememberSessionRoute: (_tab: typeof tab, sessionID: string) => {
      calls.push(`route:${sessionID}`)
    },
    select: (input: Tab) => {
      calls.push(`select:${input.type === "session" ? `${input.sessionId}>${input.routeSessionId}` : input.draftID}`)
    },
  }

  openNotificationSession(tabs, server, "session-1")

  expect(calls).toEqual(["add:session-1>undefined", "route:session-1", "select:session-1>undefined"])
})

test("opens a child session inside its root session's tab, routed from the moment the tab is added", () => {
  const server = ServerConnection.Key.make("sidecar")
  const tab = { type: "session" as const, server, sessionId: "root" }
  const calls: string[] = []

  const tabs = {
    addSessionTab: (input: { sessionId: string; routeSessionId?: string }) => {
      calls.push(`add:${input.sessionId}>${input.routeSessionId}`)

      return tab
    },
    rememberSessionRoute: (_tab: typeof tab, sessionID: string, parentID?: string) => {
      calls.push(`route:${sessionID}:${parentID}`)
    },
    select: (input: Tab) => {
      calls.push(`select:${input.type === "session" ? `${input.sessionId}>${input.routeSessionId}` : input.draftID}`)
    },
  }

  openNotificationSession(tabs, server, "root", { id: "child", parentID: "root" })

  expect(calls).toEqual(["add:root>child", "route:child:root", "select:root>child"])
})
