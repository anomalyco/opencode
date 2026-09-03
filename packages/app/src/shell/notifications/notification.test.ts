import { expect, test } from "bun:test"
import { Schema } from "effect"
import type { ServerConnection } from "@/runtime/server/registry"
import type { Tab } from "@/shell/tabs/tabs"
import { NotificationStore, openNotificationSession, type Notification } from "./notification"
import { Persistence } from "@/runtime/persistence/schema"

test("notification persistence validates and salvages individual notifications", () => {
  const valid: Notification[] = [
    { type: "turn-complete", time: 123, viewed: false, session: "session-1" },
    { type: "error", time: 124, viewed: true, error: { type: "api", message: "failed", status: 500 } },
  ]
  const decode = Schema.decodeUnknownSync(Persistence.withInitial(NotificationStore, { list: [] }))
  const store = decode({
    list: [valid[0], null, { type: "unknown", time: 123, viewed: false }, { ...valid[1], error: "invalid" }, valid[1]],
  })
  expect(store.list).toEqual(valid)
  expect(decode({})).toEqual({ list: [] })
  expect(decode({ list: {} })).toEqual({ list: [] })
  expect(decode(Schema.encodeSync(NotificationStore)(store))).toEqual(store)
})

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
