import z from "zod"

/**
 * Extends a Zod schema to also accept alias names for parameters.
 * The aliases are added as additional optional properties that mirror
 * the original parameter's type.
 */
export function schemaWithAliases(
  parameters: z.ZodType,
  aliases?: Record<string, string[]>,
): z.ZodType {
  if (!aliases || Object.keys(aliases).length === 0) return parameters
  if (!(parameters instanceof z.ZodObject)) return parameters

  const shape = parameters.shape as Record<string, z.ZodType>
  const extra: Record<string, z.ZodType> = {}

  for (const [canonical, aliasList] of Object.entries(aliases)) {
    const original = shape[canonical]
    if (!original) continue
    for (const alias of aliasList) {
      if (alias in shape) continue
      // Make the alias optional so validation doesn't require it
      extra[alias] = original instanceof z.ZodOptional ? original : original.optional()
    }
  }

  if (Object.keys(extra).length === 0) return parameters

  return parameters.extend(extra)
}

/**
 * Creates a function that transforms tool call arguments by mapping
 * alias parameter names to their canonical names.
 */
export function createAliasTransformer(
  aliases?: Record<string, string[]>,
): ((args: Record<string, unknown>) => Record<string, unknown>) | undefined {
  if (!aliases || Object.keys(aliases).length === 0) return undefined

  return (args: Record<string, unknown>) => {
    const transformed = { ...args }
    let changed = false

    for (const [canonical, aliasList] of Object.entries(aliases)) {
      for (const alias of aliasList) {
        if (alias in transformed && !(canonical in transformed)) {
          transformed[canonical] = transformed[alias]
          delete transformed[alias]
          changed = true
        }
      }
    }

    return changed ? transformed : args
  }
}
