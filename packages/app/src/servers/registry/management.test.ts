import { describe, expect, test } from "bun:test"
import type { ServerProbeResult } from "@/runtime/server/health-machine"
import { ServerConnection } from "@/runtime/server/registry"
import { createServerHealthPreview, replaceServerConnection, type ServerFormValues } from "./management"

function deferred<T>() {
  let resolve!: (value: T) => void

  const promise = new Promise<T>((done) => {
    resolve = done
  })

  return { promise, resolve }
}

const values = (url: string): ServerFormValues => ({ url, name: "", password: "" })

describe("createServerHealthPreview", () => {
  test.each(["", "secret"])("previews a server with only its password (%s)", async (password) => {
    const requests: ServerConnection.HttpBase[] = []

    const preview = createServerHealthPreview(async (http) => {
      requests.push(http)

      return { type: "healthy" }
    })

    await preview.preview({ ...values("server.example.com"), password }, () => {})

    const expected: ServerConnection.HttpBase = { url: "http://server.example.com" }

    if (password) expected.password = password
    expect(requests).toEqual([expected])
  })

  test("ignores an older response that resolves after the latest response", async () => {
    const first = deferred<ServerProbeResult>()
    const second = deferred<ServerProbeResult>()
    const requests = [first, second]
    const status: Array<boolean | undefined> = []
    const preview = createServerHealthPreview(() => requests.shift()!.promise)

    const older = preview.preview(values("old.example.com"), (value) => status.push(value))
    const latest = preview.preview(values("new.example.com"), (value) => status.push(value))
    second.resolve({ type: "healthy" })
    await latest
    first.resolve({ type: "unreachable" })
    await older

    expect(status).toEqual([undefined, undefined, true])
  })

  test("an incomplete value invalidates an in-flight response", async () => {
    const request = deferred<ServerProbeResult>()
    const status: Array<boolean | undefined> = []
    const preview = createServerHealthPreview(() => request.promise)

    const pending = preview.preview(values("server.example.com"), (value) => status.push(value))
    await preview.preview(values("server"), (value) => status.push(value))
    request.resolve({ type: "healthy" })
    await pending

    expect(status).toEqual([undefined, undefined])
  })

  test("cancellation prevents an in-flight response from updating status", async () => {
    const request = deferred<ServerProbeResult>()
    const status: Array<boolean | undefined> = []
    const preview = createServerHealthPreview(() => request.promise)

    const pending = preview.preview(values("server.example.com"), (value) => status.push(value))
    preview.cancel()
    request.resolve({ type: "healthy" })
    await pending

    expect(status).toEqual([undefined])
  })
})

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
