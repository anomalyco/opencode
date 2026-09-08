import { expect, test } from "bun:test"
import { Schema } from "effect"
import { z } from "zod"
import { createLifecycle } from "../src/desktop/lifecycle"
import { decode, encode } from "../src/desktop/rpc"
import { resolveSlots } from "../src/slots"

test("extension teardown cancels work and disposes every resource in reverse order", () => {
  const scope = createLifecycle()
  const called: string[] = []
  scope.signal.addEventListener("abort", () => called.push("abort"))
  scope.own(() => called.push("first"))
  scope.own(() => {
    called.push("second")
    throw new Error("cleanup")
  })
  expect(() => scope.dispose()).toThrow(AggregateError)
  expect(called).toEqual(["abort", "second", "first"])
  scope.dispose()
  scope.own(() => called.push("late"))
  expect(called).toEqual(["abort", "second", "first", "late"])
})

test("main RPC codecs transfer bytes and reject incompatible values", async () => {
  const schema = Schema.Struct({ bytes: Schema.Uint8ArrayFromBase64 })
  const input = { bytes: new Uint8Array([0, 1, 127, 255]) }
  expect(await decode(schema, await encode(schema, input))).toEqual(input)
  await expect(decode(schema, { bytes: 17 })).rejects.toThrow()
  await expect(encode(schema, { bytes: "wrong" })).rejects.toThrow()
})

test("main RPC accepts Standard Schema and JSON Schema contracts", async () => {
  expect(await decode(z.object({ name: z.string().min(1) }), { name: "inspector" })).toEqual({ name: "inspector" })
  await expect(decode({ type: "integer", minimum: 1 }, 0)).rejects.toThrow()
  expect(await decode({ type: "integer", minimum: 1 }, 2)).toBe(2)
})

test("shared TUI/Desktop slots compose replacements and preserve neighboring contributions", () => {
  const result = resolveSlots({
    paths: new Set(["app", "app.panel"]),
    claims: [
      { key: "a", plugin: "one", placement: { kind: "append", target: "app.panel" }, render: "A" },
      { key: "b", plugin: "two", placement: { kind: "replace", target: "app.panel" }, render: "B" },
      { key: "c", plugin: "three", placement: { kind: "after", target: "app.panel" }, render: "C" },
    ],
  })
  expect(result.slotted.get("app.panel")?.replace?.render).toBe("B")
  expect(result.slotted.get("app.panel")?.after.map((claim) => claim.render)).toEqual(["C"])
  expect(result.suppressed.map((item) => item.claim.key)).toEqual(["a"])
})
