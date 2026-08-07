import { expect, test } from "bun:test"
import { ServerOptions } from "@opencode-ai/server/options"
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
  expect(
    Option.getOrThrow(decode({ app: { name: "sdk", version: "1.2.3", channel: "beta" } })).app,
  ).toEqual({ name: "sdk", version: "1.2.3", channel: "beta" })
})

test("accepts durable event persistence configuration", () => {
  expect(Option.getOrThrow(decode({ events: { persist: true } })).events).toEqual({ persist: true })
})
