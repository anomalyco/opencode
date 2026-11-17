import { describe, expect, test } from "bun:test"
import { ServerConnection } from "@/runtime/server/registry"
import { replaceServerConnection } from "./management"

describe("replaceServerConnection", () => {
  const original: ServerConnection.Http = { type: "http", http: { url: "https://old.example.com" } }
  const next: ServerConnection.Http = { type: "http", http: { url: "https://new.example.com" } }

  test("moves active selection after adding the replacement and removes the original", () => {
    const calls: string[] = []

    replaceServerConnection(ServerConnection.key(original), next, {
      removeTabs: (key) => calls.push(`tabs:${key}`),
      add: (server) => {
        calls.push(`add:${ServerConnection.key(server)}`)

        return server
      },
      remove: (key) => calls.push(`remove:${key}`),
    })

    expect(calls).toEqual([
      "tabs:https://old.example.com",
      "add:https://new.example.com",
      "remove:https://old.example.com",
    ])
  })

  test("keeps the original when the replacement cannot be added", () => {
    const removed: ServerConnection.Key[] = []

    replaceServerConnection(ServerConnection.key(original), next, {
      removeTabs: () => {},
      add: () => undefined,
      remove: (key) => removed.push(key),
    })

    expect(removed).toEqual([])
  })
})
