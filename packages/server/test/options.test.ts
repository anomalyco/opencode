import { expect, test } from "bun:test"
import { ServerOptions } from "@opencode/server/options"
import { Option, Schema } from "effect"

const decode = Schema.decodeUnknownOption(ServerOptions)

test("accepts ephemeral port zero", () => {
  expect(Option.isSome(decode({ port: 0 }))).toBe(true)
})

test("rejects ports outside the valid range", () => {
  expect(Option.isNone(decode({ port: -1 }))).toBe(true)
  expect(Option.isNone(decode({ port: 65_536 }))).toBe(true)
})

test("accepts optional app metadata", () => {
  expect(Option.getOrThrow(decode({ app: { name: "sdk", version: "1.2.3", channel: "beta" } })).app).toEqual({
    name: "sdk",
    version: "1.2.3",
    channel: "beta",
  })
})

test("accepts durable event persistence configuration", () => {
  expect(Option.getOrThrow(decode({ events: { persist: true } })).events).toEqual({ persist: true })
})

test("validates host-owned shell sandbox settings", () => {
  const sandbox = {
    enabled: true,
    approval: "never",
    fullDiskRead: true,
    readableRoots: ["/opt/toolchain"],
    writableRoots: [],
  } satisfies NonNullable<ServerOptions["sandbox"]>
  expect(Option.getOrThrow(decode({ sandbox })).sandbox).toEqual(sandbox)
  expect(Option.isNone(decode({ sandbox: { enabled: "unsupported" } }))).toBe(true)
  expect(Option.isNone(decode({ sandbox: { approval: "always" } }))).toBe(true)
  expect(Option.isNone(decode({ sandbox: { readableRoots: "/opt/toolchain" } }))).toBe(true)
  expect(Option.isNone(decode({ sandbox: { fullDiskRead: "true" } }))).toBe(true)
  expect(Option.getOrThrow(decode({ sandbox: {} })).sandbox?.fullDiskRead).toBeUndefined()
  expect(Option.getOrThrow(decode({ sandbox: { fullDiskRead: false } })).sandbox?.fullDiskRead).toBe(false)
})

test("accepts an optional CORS allowlist", () => {
  expect(Option.getOrThrow(decode({})).cors).toBeUndefined()
  expect(Option.getOrThrow(decode({ cors: [] })).cors).toEqual([])
  expect(Option.getOrThrow(decode({ cors: ["http://192.168.1.10:3001", "https://example.com"] })).cors).toEqual([
    "http://192.168.1.10:3001",
    "https://example.com",
  ])
  expect(Option.isNone(decode({ cors: "http://192.168.1.10:3001" }))).toBe(true)
})
