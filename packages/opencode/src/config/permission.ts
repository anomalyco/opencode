export * as ConfigPermission from "./permission"
import z from "zod"

const permissionPreprocess = (val: unknown) => {
  if (typeof val === "object" && val !== null && !Array.isArray(val)) {
    return { __originalKeys: globalThis.Object.keys(val), ...val }
  }
  return val
}

export const Action = z.enum(["ask", "allow", "deny"]).meta({
  ref: "PermissionActionConfig",
})
export type Action = z.infer<typeof Action>

export const Object = z.record(z.string(), Action).meta({
  ref: "PermissionObjectConfig",
})
export type Object = z.infer<typeof Object>

export const Rule = z.union([Action, Object]).meta({
  ref: "PermissionRuleConfig",
})
export type Rule = z.infer<typeof Rule>

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
        read: Rule.optional(),
        edit: Rule.optional(),
        glob: Rule.optional(),
        grep: Rule.optional(),
        list: Rule.optional(),
        bash: Rule.optional(),
        task: Rule.optional(),
        external_directory: Rule.optional(),
        todowrite: Action.optional(),
        question: Action.optional(),
        webfetch: Action.optional(),
        websearch: Action.optional(),
        codesearch: Action.optional(),
        lsp: Rule.optional(),
        doom_loop: Action.optional(),
        skill: Rule.optional(),
      })
      .catchall(Rule)
      .or(Action),
  )
  .transform(transform)
  .meta({
    ref: "PermissionConfig",
  })
export type Info = z.infer<typeof Info>
