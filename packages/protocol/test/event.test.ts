import { expect, test } from "bun:test"
import { Schema } from "effect"
import { isOpenCodeEvent, OpenCodeEvent, type OpenCodeEventEncoded } from "../src/groups/event.js"

type JsonShape<Value> = Value extends string | number | boolean | null
  ? Value
  : Value extends undefined
    ? never
    : Value extends ReadonlyArray<infer Item>
      ? ReadonlyArray<JsonShape<Item>>
      : Value extends object
        ? {
            readonly [Key in keyof Value as undefined extends Value[Key] ? never : Key]: JsonShape<Value[Key]>
          } & {
            readonly [Key in keyof Value as undefined extends Value[Key] ? Key : never]?: JsonShape<
              Exclude<Value[Key], undefined>
            >
          }
        : Value

// JSON.stringify omits undefined object properties, so normalize them before
// requiring every runtime event shape to fit its encoded wire contract.
const wireReady: [JsonShape<OpenCodeEvent>] extends [JsonShape<OpenCodeEventEncoded>] ? true : false = true

// This fails to compile if the dynamic RPC branch absorbs native discriminants.
const nativeDataNarrows = (event: OpenCodeEvent) => {
  if (event.type !== "session.created") return
  const sessionID: string = event.data.sessionID
  return sessionID
}

test("classifies public events by type", () => {
  expect(isOpenCodeEvent({ type: "server.connected" })).toBe(true)
  expect(isOpenCodeEvent({ type: "mcp.status.changed" })).toBe(true)
  expect(isOpenCodeEvent({ type: "mcp.resources.changed" })).toBe(true)
  expect(isOpenCodeEvent({ type: "mcp.tools.changed" })).toBe(false)
  expect(isOpenCodeEvent({ type: "rpc.acme.updated" })).toBe(true)
  expect(isOpenCodeEvent({ type: "acme.updated" })).toBe(false)
})

test("decodes direct plugin RPC events", () => {
  const event = {
    id: "evt_rpc",
    created: 1,
    type: "rpc.acme.updated",
    location: { directory: "/project" },
    data: { itemID: "item-1", text: "hello" },
  }
  expect(Schema.decodeUnknownSync(OpenCodeEvent)(event)).toMatchObject(event)
  expect(() => Schema.decodeUnknownSync(OpenCodeEvent)({ ...event, location: undefined })).toThrow()
  expect(() => Schema.decodeUnknownSync(OpenCodeEvent)({ ...event, type: "acme.updated" })).toThrow()
  expect(() => Schema.decodeUnknownSync(OpenCodeEvent)({ ...event, data: "value" })).toThrow()
  expect(() => Schema.decodeUnknownSync(OpenCodeEvent)({ ...event, data: [] })).toThrow()
  expect(() => Schema.decodeUnknownSync(OpenCodeEvent)({ ...event, data: null })).toThrow()
})

test("keeps native event data discriminated by type", () => {
  expect(nativeDataNarrows).toBeFunction()
})

test("keeps public event runtime values within the encoded contract", () => {
  expect(wireReady).toBe(true)
})
