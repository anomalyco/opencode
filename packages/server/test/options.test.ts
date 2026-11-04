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

test("accepts an optional CORS allowlist", () => {
  expect(Option.getOrThrow(decode({})).cors).toBeUndefined()
  expect(Option.getOrThrow(decode({ cors: [] })).cors).toEqual([])
  expect(Option.getOrThrow(decode({ cors: ["http://192.168.1.10:3001", "https://example.com"] })).cors).toEqual([
    "http://192.168.1.10:3001",
    "https://example.com",
  ])
  expect(Option.isNone(decode({ cors: "http://192.168.1.10:3001" }))).toBe(true)
})

test("accepts an embedder fetch and rejects other values", () => {
  const fetch = () => Promise.resolve(new Response())
  expect(Option.getOrThrow(decode({ fetch })).fetch).toBe(fetch)
  expect(Option.isNone(decode({ fetch: "https://example.com" }))).toBe(true)
})

test("accepts Console options", () => {
  expect(Option.getOrThrow(decode({ console: { poll: false } })).console).toEqual({ poll: false })
  expect(Option.getOrThrow(decode({ console: { required: true } })).console).toEqual({ required: true })
  expect(Option.isNone(decode({ console: { poll: "no" } }))).toBe(true)
  expect(Option.isNone(decode({ console: { required: "yes" } }))).toBe(true)
})
