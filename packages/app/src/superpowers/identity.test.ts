import { expect, test } from "bun:test"
import { createExecutionScope, runKey, scopeKey } from "./identity"
import type { NativeRecord } from "./native-types"

test("server and owner location are identity boundaries", () => {
  const a = { serverKey: "wsl", ownerDirectory: "/root/git/a", rootSessionID: "root" }
  expect(scopeKey(a)).not.toBe(scopeKey({ ...a, serverKey: "other" }))
  expect(scopeKey(a)).not.toBe(scopeKey({ ...a, ownerDirectory: "/root/git/b" }))
  expect(runKey(a, "run-1")).not.toBe(runKey(a, "run-2"))
})

test("delimiter-containing directory names cannot collide", () => {
  const left = { serverKey: "server", ownerDirectory: "/root/git/b", rootSessionID: "c/d" }
  const right = { serverKey: "server", ownerDirectory: "/root/git/b/c", rootSessionID: "d" }
  expect(scopeKey(left)).not.toBe(scopeKey(right))
  expect(runKey(left, "run")).not.toBe(runKey(right, "run"))
  const quoted = { serverKey: "server", ownerDirectory: '/root/git/","shared', rootSessionID: "root" }
  expect(scopeKey(quoted)).not.toBe(scopeKey({ ...quoted, ownerDirectory: '/root/git/"' }))
})

test("the adapter boundary rejects empty or missing scope identity", () => {
  expect(
    createExecutionScope({ serverKey: "server", ownerDirectory: "/root/git/a", rootSessionID: "" }),
  ).toBeUndefined()
  expect(
    createExecutionScope({ serverKey: "server", ownerDirectory: "/root/git/a", rootSessionID: "   " }),
  ).toBeUndefined()
  expect(
    createExecutionScope({ serverKey: "server", ownerDirectory: "/root/git/a", rootSessionID: undefined }),
  ).toBeUndefined()
  expect(
    createExecutionScope({ serverKey: "", ownerDirectory: "/root/git/a", rootSessionID: "root" }),
  ).toBeUndefined()
  expect(
    createExecutionScope({ serverKey: "server", ownerDirectory: "", rootSessionID: "root" }),
  ).toBeUndefined()
  expect(createExecutionScope({ serverKey: "server", ownerDirectory: "/root/git/a", rootSessionID: "root" })).toEqual({
    serverKey: "server",
    ownerDirectory: "/root/git/a",
    rootSessionID: "root",
  })
})

test("identical root IDs on two authenticated servers never share a key", () => {
  const first = { serverKey: "server-a", ownerDirectory: "/root/git/shared", rootSessionID: "root" }
  const second = { serverKey: "server-b", ownerDirectory: "/root/git/shared", rootSessionID: "root" }
  expect(scopeKey(first)).not.toBe(scopeKey(second))
  expect(runKey(first, "run-1")).not.toBe(runKey(second, "run-1"))
  expect(runKey(first, "root")).not.toBe(runKey(second, "root"))
})

test("native records expose an explicit unknown status", () => {
  const record: NativeRecord = {
    id: "child",
    parentID: "root",
    title: "Child",
    directory: "/root/git/a",
    status: "unknown",
    needsInput: false,
  }
  expect(record.status).toBe("unknown")
})
