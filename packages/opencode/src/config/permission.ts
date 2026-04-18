export * as ConfigPermission from "./permission"
import { Schema } from "effect"
import z from "zod"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

const permissionPreprocess = (val: unknown) => {
  if (typeof val === "object" && val !== null && !Array.isArray(val)) {
    return { __originalKeys: globalThis.Object.keys(val), ...val }
  }
  return val
}

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

export const Info = z
  .preprocess(
    permissionPreprocess,
    z
      .object({
        __originalKeys: z.string().array().optional(),
        read: Rule.zod.optional(),
        edit: Rule.zod.optional(),
        glob: Rule.zod.optional(),
        grep: Rule.zod.optional(),
        list: Rule.zod.optional(),
        bash: Rule.zod.optional(),
        task: Rule.zod.optional(),
        external_directory: Rule.zod.optional(),
        todowrite: Action.zod.optional(),
        question: Action.zod.optional(),
        webfetch: Action.zod.optional(),
        websearch: Action.zod.optional(),
        codesearch: Action.zod.optional(),
        lsp: Rule.zod.optional(),
        doom_loop: Action.zod.optional(),
        skill: Rule.zod.optional(),
      })
      .catchall(Rule.zod)
      .or(Action.zod),
  )
  .transform(transform)
  .meta({
    ref: "PermissionConfig",
  })
export type Info = z.infer<typeof Info>
