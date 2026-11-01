import { describe, expect, test } from "bun:test"
import { ServerConnection } from "@/runtime/server/registry"
import { tabKey, type Tab } from "@/shell/tabs/tabs"
import { orderTabsByServer, serverGroupHeaders } from "./tab-groups"

const local = ServerConnection.Key.make("local\nhttp://127.0.0.1:4096")

const remote = ServerConnection.Key.make("remote\nhttp://127.0.0.1:4097")

function tab(server: ServerConnection.Key, sessionId: string): Tab {
  return { type: "session", server, sessionId }
}

describe("orderTabsByServer", () => {
  test("keeps tabs of a server the app no longer lists at the end, in their existing order", () => {
    const missing = ServerConnection.Key.make("gone\nhttp://127.0.0.1:4098")
    const tabs = [tab(missing, "x1"), tab(local, "a1"), tab(missing, "x2")]

    expect(orderTabsByServer(tabs, [local]).map(tabKey)).toEqual([
      tabKey(tabs[1]),
      tabKey(tabs[0]),
      tabKey(tabs[2]),
    ])
  })
})

describe("serverGroupHeaders", () => {
  const labels = new Map([
    [local, "This computer"],
    [remote, "build-box"],
  ])

  test("skips hidden tabs so a header never floats above an undrawn row", () => {
    const tabs = [tab(local, "a1"), tab(local, "a2"), tab(remote, "b1")]
    const headers = serverGroupHeaders(tabs, (item) => tabKey(item) !== tabKey(tabs[0]), labels)

    expect(headers.has(tabKey(tabs[0]))).toBe(false)
    expect(headers.get(tabKey(tabs[1]))).toBe("This computer")
    expect(headers.get(tabKey(tabs[2]))).toBe("build-box")
  })

  test("falls back to the server key when no label is known", () => {
    const tabs = [tab(remote, "b1")]
    const headers = serverGroupHeaders(tabs, () => true, new Map())

    expect(headers.get(tabKey(tabs[0]))).toBe(remote)
  })
})
