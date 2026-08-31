import { Rpc } from "@opencode-ai/plugin/rpc"
import { Schema } from "effect"
import type { Types } from "effect"
import { z } from "zod"

export const Acme = Rpc.define({
  id: "acme",
  methods: {
    search: {
      input: z.object({ query: z.string() }),
      output: z.object({ text: z.string() }),
      errors: {
        not_found: z.object({ query: z.string(), attempts: z.string().transform(Number) }),
        unavailable: z.undefined(),
      },
    },
    count: {
      input: z.object({ count: z.string().transform(Number) }),
      output: z.number().transform(String),
    },
    codec: {
      input: z.object({ count: z.string().transform(Number) }),
      output: z.number(),
    },
    raw: {
      input: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
      output: { type: "integer" },
    },
    ping: {
      input: z.undefined(),
      output: z.null(),
    },
  },
  events: {
    updated: { schema: z.object({ itemID: z.string(), text: z.string() }) },
    progress: { schema: z.object({ percent: z.number() }) },
    counted: { schema: z.object({ count: z.number() }).transform(({ count }) => ({ text: String(count) })) },
  },
})

export const EffectAcme = Rpc.define({
  id: "effect-acme",
  methods: {
    codec: {
      input: Schema.Struct({ count: Schema.FiniteFromString }),
      output: Schema.FiniteFromString,
      errors: { invalid_count: Schema.Struct({ count: Schema.FiniteFromString }) },
    },
  },
  events: { progress: { schema: Schema.Struct({ percent: Schema.Number }) } },
})

export type Equal<A, B> = Types.Equals<A, B>
export type Assert<T extends true> = T
