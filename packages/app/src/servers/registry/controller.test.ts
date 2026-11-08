import { describe, expect, test } from "bun:test"
import { ServerConnection } from "@/runtime/server/registry"
import { sortServerConnections } from "./controller"

const server = (url: string): ServerConnection.Http => ({ type: "http", http: { url } })

describe("sortServerConnections", () => {
  test("orders by health and preserves insertion ordering", () => {
    const first = server("http://first")
    const offline = server("http://offline")
    const unknown = server("http://unknown")
    // A tunnel that just moved is still being checked, not failed.
    const checking = server("http://checking")

    const result = sortServerConnections({
      servers: [first, offline, unknown, checking],
      health: {
        [ServerConnection.key(first)]: { type: "healthy" },
        [ServerConnection.key(offline)]: { type: "unreachable" },
        [ServerConnection.key(checking)]: { type: "checking", managed: true },
      },
    })

    expect(result).toEqual([first, unknown, checking, offline])
  })
})
