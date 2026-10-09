import { beforeAll, expect, mock, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import type { Data } from "@opencode/client/solid"
import type { PermissionRequest } from "@opencode/client/promise"
import type { ServerSDK } from "@/runtime/server/client"

let createPermissionAutoApprover: typeof import("../src/session/requests/auto-approve").createPermissionAutoApprover

beforeAll(async () => {
  mock.module("@/settings/model", () => ({
    useSettings: () => ({ permissions: { autoApprove: () => true } }),
  }))
  createPermissionAutoApprover = (await import("../src/session/requests/auto-approve")).createPermissionAutoApprover
})

test("a deferred old reply cannot suppress or clear the current generation's attempt", async () => {
  const [status, setStatus] = createSignal("connected")
  const requests: ((value: { data: PermissionRequest[] }) => void)[] = []
  const replies: { resolve: () => void; reject: (error: Error) => void }[] = []
  const permission = { id: "request", sessionID: "session" } as PermissionRequest
  const sdk = {
    connection: { status },
    event: { on: () => () => {} },
    api: {
      location: { list: async () => [{ directory: "/fixture/loaded" }] },
      session: { active: async () => ({}) },
      permission: {
        request: {
          list: () => new Promise<{ data: PermissionRequest[] }>((resolve) => requests.push(resolve)),
        },
        reply: () => new Promise<void>((resolve, reject) => replies.push({ resolve, reject })),
      },
    },
  } as unknown as ServerSDK
  const data = { session: { list: () => [] } } as unknown as Data
  const dispose = createRoot((dispose) => {
    createPermissionAutoApprover({ sdk, data })
    return dispose
  })
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  }
  try {
    await flush()
    requests[0]({ data: [permission] })
    await flush()
    expect(replies).toHaveLength(1)
    setStatus("reconnecting")
    setStatus("connected")
    await flush()
    requests[1]({ data: [permission] })
    await flush()
    expect(replies).toHaveLength(2)
    replies[0].reject(new Error("old connection failed late"))
    await flush()
    replies[1].resolve()
    await flush()
    setStatus("reconnecting")
    setStatus("connected")
    await flush()
    requests[2]({ data: [permission] })
    await flush()
    expect(replies).toHaveLength(2)
  } finally {
    dispose()
  }
})

test("disconnect invalidates old permission lists and failed reply retries", async () => {
  const [status, setStatus] = createSignal("connected")
  const requests: ((value: { data: PermissionRequest[] }) => void)[] = []
  const replied: string[] = []
  let failReply = false
  const timers: (() => void)[] = []
  const originalTimeout = globalThis.setTimeout
  globalThis.setTimeout = ((callback: () => void) => timers.push(callback)) as unknown as typeof setTimeout
  const permission = { id: "request", sessionID: "session" } as PermissionRequest
  const sdk = {
    connection: { status },
    event: { on: () => () => {} },
    api: {
      location: { list: async () => [{ directory: "/fixture/loaded" }] },
      session: { active: async () => ({}) },
      permission: {
        request: {
          list: () => new Promise<{ data: PermissionRequest[] }>((resolve) => requests.push(resolve)),
        },
        reply: async ({ requestID }: { requestID: string }) => {
          replied.push(requestID)
          if (failReply) throw new Error("transient reply failure")
        },
      },
    },
  } as unknown as ServerSDK
  const data = { session: { list: () => [] } } as unknown as Data
  const dispose = createRoot((dispose) => {
    createPermissionAutoApprover({ sdk, data })
    return dispose
  })
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  }
  try {
    await flush()
    expect(requests).toHaveLength(1)
    setStatus("reconnecting")
    requests[0]({ data: [permission] })
    await flush()
    expect(replied).toEqual([])
    setStatus("connected")
    await flush()
    expect(requests).toHaveLength(2)
    requests[1]({ data: [permission] })
    await flush()
    expect(replied).toEqual([permission.id])
    failReply = true
    setStatus("reconnecting")
    setStatus("connected")
    await flush()
    requests[2]({ data: [{ ...permission, id: "retry" }] })
    await flush()
    expect(timers).toHaveLength(1)
    setStatus("reconnecting")
    setStatus("connected")
    await flush()
    timers.shift()!()
    await flush()
    expect(replied).toEqual([permission.id, "retry"])
  } finally {
    dispose()
    globalThis.setTimeout = originalTimeout
  }
})
