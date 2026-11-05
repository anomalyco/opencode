import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import type { Types } from "effect"
import { Rpc } from "../src/rpc.js"

type Assert<T extends true> = T

const Dragon = Rpc.define({
  id: "dragon",
  methods: {
    vibrate: {},
    status: {
      output: Schema.toStandardSchemaV1(Schema.Struct({ ok: Schema.Boolean })),
    },
    notify: {
      input: Schema.toStandardSchemaV1(Schema.Struct({ text: Schema.String })),
    },
    rawStatus: {
      output: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
    },
  },
})

export type Checks = [
  Assert<Types.Equals<Rpc.MethodInput<typeof Dragon.methods.vibrate>, undefined>>,
  Assert<Types.Equals<Rpc.HandlerInput<typeof Dragon.methods.vibrate>, undefined>>,
  Assert<Types.Equals<Rpc.MethodOutput<typeof Dragon.methods.vibrate>, void>>,
  Assert<Types.Equals<Rpc.MethodHandlerOutput<typeof Dragon.methods.vibrate>, void>>,
  Assert<Types.Equals<Rpc.MethodInput<typeof Dragon.methods.status>, undefined>>,
  Assert<Types.Equals<Rpc.HandlerInput<typeof Dragon.methods.status>, undefined>>,
  Assert<Types.Equals<Rpc.MethodOutput<typeof Dragon.methods.status>, { readonly ok: boolean }>>,
  Assert<Types.Equals<Rpc.MethodHandlerOutput<typeof Dragon.methods.status>, { readonly ok: boolean }>>,
  Assert<Types.Equals<Rpc.MethodInput<typeof Dragon.methods.notify>, { readonly text: string }>>,
  Assert<Types.Equals<Rpc.HandlerInput<typeof Dragon.methods.notify>, { readonly text: string }>>,
  Assert<Types.Equals<Rpc.MethodOutput<typeof Dragon.methods.notify>, void>>,
  Assert<Types.Equals<Rpc.MethodHandlerOutput<typeof Dragon.methods.notify>, void>>,
  Assert<Types.Equals<Rpc.MethodInput<typeof Dragon.methods.rawStatus>, undefined>>,
  Assert<Types.Equals<Rpc.MethodOutput<typeof Dragon.methods.rawStatus>, unknown>>,
  Assert<Types.Equals<Rpc.EventName<typeof Dragon>, never>>,
  Assert<Types.Equals<Rpc.EventInput<typeof Dragon>, never>>,
]

describe("Rpc.define", () => {
  test("preserves methods that omit input, output, or events and still rejects reserved rpc.* error names", () => {
    expect(Dragon.id).toBe("dragon")
    expect(Object.keys(Dragon.methods)).toEqual(["vibrate", "status", "notify", "rawStatus"])
    expect(() =>
      Rpc.define({
        id: "dragon",
        methods: {
          vibrate: {
            // @ts-expect-error Error names starting with rpc. are reserved.
            errors: { "rpc.internal": { type: "object" } },
          },
        },
      }),
    ).toThrow('RPC error names starting with "rpc." are reserved: rpc.internal')
  })
})
