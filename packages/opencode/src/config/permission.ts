export * as ConfigPermission from "./permission"
import { Schema, SchemaGetter } from "effect"
import z from "zod"
import { ZodOverride, zod } from "@/util/effect-zod"
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

// Known permission keys get explicit types in the Effect schema for generated
// docs/types. Runtime config parsing uses `InfoZod` below so user key order is
// preserved for permission precedence.
const InputObject = Schema.StructWithRest(
  Schema.Struct({
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

// Input the user writes in config: either a single Action (shorthand for "*")
// or an object of per-target rules.
const InputSchema = Schema.Union([Action, InputObject])

// Normalise the Action shorthand into `{ "*": action }`. Object inputs pass
// through untouched.
const normalizeInput = (input: Schema.Schema.Type<typeof InputSchema>): Schema.Schema.Type<typeof InputObject> =>
  typeof input === "string" ? { "*": input } : input

const ACTION_ONLY = new Set(["todowrite", "question", "webfetch", "websearch", "codesearch", "doom_loop"])

const InfoZod = z
  .union([zod(Action), z.record(z.string(), z.union([zod(Action), z.record(z.string(), zod(Action))]))])
  .transform(normalizeInput)
  .superRefine((input, ctx) => {
    for (const [key, value] of globalThis.Object.entries(input)) {
      if (!ACTION_ONLY.has(key) || typeof value === "string") continue
      ctx.addIssue({ code: "custom", message: `${key} must be a permission action`, path: [key] })
    }
  })

export const Info = InputSchema.pipe(
  Schema.decodeTo(InputObject, {
    decode: SchemaGetter.transform(normalizeInput),
    // Not perfectly invertible (we lose whether the user originally typed an
    // Action shorthand), but the object form is always a valid representation
    // of the same rules.
    encode: SchemaGetter.passthrough({ strict: false }),
  }),
)
  .annotate({ identifier: "PermissionConfig" })
  .annotate({ [ZodOverride]: InfoZod })
  .pipe(
    // Walker already emits the decodeTo transform into the derived zod (see
    // `encoded()` in effect-zod.ts), so just expose that directly.
    withStatics((s) => ({ zod: zod(s) })),
  )
type _Info = Schema.Schema.Type<typeof InputObject>
export type Info = { -readonly [K in keyof _Info]: _Info[K] }
