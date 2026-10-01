import { expect, test } from "bun:test"
import type { ServerConnection } from "@/runtime/server/registry"
import type { Tab } from "@/shell/tabs/tabs"
import { openNotificationSession } from "./notification"

test("opens notification sessions through the tab router", () => {
  const server = "local\nhttp://localhost:4096" as ServerConnection.Key
  const tab = { type: "session" as const, server, sessionId: "session-1" }
  const calls: string[] = []
  const tabs = {
    addSessionTab: (input: Omit<typeof tab, "type">) => {
      calls.push(`add:${input.sessionId}`)
      return tab
    },
    rememberSessionRoute: (_tab: typeof tab, sessionID: string) => {
      calls.push(`route:${sessionID}`)
    },
    select: (input: Tab) => {
      calls.push(`select:${input.type === "session" ? input.sessionId : input.draftID}`)
    },
  }

  openNotificationSession(tabs, server, "session-1")

  expect(calls).toEqual(["add:session-1", "route:session-1", "select:session-1"])
})
