export * as ConfigPermissionV1 from "./permission.js"

import { Schema, SchemaGetter } from "effect"

export const Action = Schema.Literals(["ask", "allow", "deny"]).annotate({ identifier: "PermissionActionConfig" })
export type Action = Schema.Schema.Type<typeof Action>

// Permission rules are last-match-wins, so the order an author writes keys in is policy. Effect
// leaves the key order of decoded objects unspecified but keeps array order, so these objects
// decode to entries read directly from the input.
export const Entries = <A, I>(value: Schema.Codec<A, I>) =>
  Schema.ObjectKeyword.check(
    Schema.makeFilter((input) => !globalThis.Array.isArray(input), { expected: "an object" }),
  ).pipe(
    Schema.decodeTo(Schema.Array(Schema.Tuple([Schema.String, value])), {
      decode: SchemaGetter.transform((input) => globalThis.Object.entries(input)),
      encode: SchemaGetter.transform((entries) => globalThis.Object.fromEntries(entries)),
    }),
  )

export const Object = Entries(Action).annotate({ identifier: "PermissionObjectConfig" })
export type Object = Schema.Schema.Type<typeof Object>

export const Rule = Schema.Union([Action, Object]).annotate({ identifier: "PermissionRuleConfig" })
export type Rule = Schema.Schema.Type<typeof Rule>

const actionOnly = new Set(["question", "websearch", "doom_loop"])

export const Info = Schema.Union([Action, Schema.ObjectKeyword])
  .pipe(
    Schema.decodeTo(Entries(Rule), {
      decode: SchemaGetter.transform((input) => (typeof input === "string" ? { "*": input } : input)),
      encode: SchemaGetter.passthrough({ strict: false }),
    }),
  )
  .check(
    Schema.makeFilter((rules) => rules.every(([key, rule]) => !actionOnly.has(key) || typeof rule === "string"), {
      expected: "question, websearch, and doom_loop to be ask, allow, or deny",
    }),
  )
  .annotate({ identifier: "PermissionConfig" })
export type Info = Schema.Schema.Type<typeof Info>
