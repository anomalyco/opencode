export * as ConfigPermission from "./permission"
import { Schema } from "effect"
import { zod, ZodPreprocess } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

export const Action = Schema.Literals(["ask", "allow", "deny"])
  .annotate({ identifier: "PermissionActionConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Action = Schema.Schema.Type<typeof Action>

export const Object = Schema.Record(Schema.String, Action)
  .annotate({ identifier: "PermissionObjectConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Object = Schema.Schema.Type<typeof Object>

export const Rule = Schema.Union([Action, Object])
  .annotate({ identifier: "PermissionRuleConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Rule = Schema.Schema.Type<typeof Rule>

// Captures the user's original property insertion order before Schema.Struct
// canonicalises the object.  See the `ZodPreprocess` comment in
// `util/effect-zod.ts` for the full rationale — in short: rule precedence is
// encoded in JSON key order (`evaluate.ts` uses `findLast`, so later keys win)
// and `Schema.StructWithRest` would otherwise drop that order.
const permissionPreprocess = (val: unknown) => {
  if (typeof val === "object" && val !== null && !Array.isArray(val)) {
    return { __originalKeys: globalThis.Object.keys(val), ...val }
  }
  return val
}

const ObjectShape = Schema.StructWithRest(
  Schema.Struct({
    __originalKeys: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
    read: Schema.optional(Rule),
    edit: Schema.optional(Rule),
    glob: Schema.optional(Rule),
    grep: Schema.optional(Rule),
    list: Schema.optional(Rule),
    bash: Schema.optional(Rule),
    task: Schema.optional(Rule),
    external_directory: Schema.optional(Rule),
    todowrite: Schema.optional(Action),
    question: Schema.optional(Action),
    webfetch: Schema.optional(Action),
    websearch: Schema.optional(Action),
    codesearch: Schema.optional(Action),
    lsp: Schema.optional(Rule),
    doom_loop: Schema.optional(Action),
    skill: Schema.optional(Rule),
  }),
  [Schema.Record(Schema.String, Rule)],
)

const InnerSchema = Schema.Union([ObjectShape, Action]).annotate({
  [ZodPreprocess]: permissionPreprocess,
})

// Post-parse: drop the __originalKeys metadata and rebuild the rule map in the
// user's original insertion order.  A plain string input (the Action branch of
// the union) becomes `{ "*": action }`.
const transform = (x: unknown): Record<string, Rule> => {
  if (typeof x === "string") return { "*": x as Action }
  const obj = x as { __originalKeys?: string[] } & Record<string, unknown>
  const { __originalKeys, ...rest } = obj
  if (!__originalKeys) return rest as Record<string, Rule>
  const result: Record<string, Rule> = {}
  for (const key of __originalKeys) {
    if (key in rest) result[key] = rest[key] as Rule
  }
  return result
}

export const Info = zod(InnerSchema).transform(transform).meta({ ref: "PermissionConfig" })
export type Info = Record<string, Rule>
