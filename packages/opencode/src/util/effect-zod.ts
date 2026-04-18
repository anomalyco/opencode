import { Effect, Option, Schema, SchemaAST } from "effect"
import z from "zod"

/**
 * Annotation key for providing a hand-crafted Zod schema that the walker
 * should use instead of re-deriving from the AST.  Attach it via
 * `Schema.String.annotate({ [ZodOverride]: z.string().startsWith("per") })`.
 */
export const ZodOverride: unique symbol = Symbol.for("effect-zod/override")

// AST nodes are immutable and frequently shared across schemas (e.g. a single
// Schema.Class embedded in multiple parents). Memoizing by node identity
// avoids rebuilding equivalent Zod subtrees and keeps derived children stable
// by reference across callers.
const walkCache = new WeakMap<SchemaAST.AST, z.ZodTypeAny>()

// Shared empty ParseOptions for the rare callers that need one — avoids
// allocating a fresh object per parse inside refinements and transforms.
const EMPTY_PARSE_OPTIONS = {} as SchemaAST.ParseOptions

export function zod<S extends Schema.Top>(schema: S): z.ZodType<Schema.Schema.Type<S>> {
  return walk(schema.ast) as z.ZodType<Schema.Schema.Type<S>>
}

function walk(ast: SchemaAST.AST): z.ZodTypeAny {
  const cached = walkCache.get(ast)
  if (cached) return cached
  const result = walkUncached(ast)
  walkCache.set(ast, result)
  return result
}

function walkUncached(ast: SchemaAST.AST): z.ZodTypeAny {
  const override = (ast.annotations as any)?.[ZodOverride] as z.ZodTypeAny | undefined
  if (override) return override

  // Schema.Class wraps its fields in a Declaration AST plus an encoding that
  // constructs the class instance. For the Zod derivation we want the plain
  // field shape (the decoded/consumer view), not the class instance — so
  // Declarations fall through to body(), not encoded(). User-level
  // Schema.decodeTo / Schema.transform attach encoding to non-Declaration
  // nodes, where we do apply the transform.
  const hasTransform = ast.encoding?.length && ast._tag !== "Declaration"
  const base = hasTransform ? encoded(ast) : body(ast)
  const out = ast.checks?.length ? applyChecks(base, ast.checks, ast) : base
  const desc = SchemaAST.resolveDescription(ast)
  const ref = SchemaAST.resolveIdentifier(ast)
  const described = desc ? out.describe(desc) : out
  return ref ? described.meta({ ref }) : described
}

// Walk the encoded side and apply each link's decode to produce the decoded
// shape. A node `Target` produced by `from.decodeTo(Target)` carries
// `Target.encoding = [Link(from, transformation)]`. Chained decodeTo calls
// nest the encoding via `Link.to` so walking it recursively threads all
// prior transforms — typical encoding.length is 1.
function encoded(ast: SchemaAST.AST): z.ZodTypeAny {
  const encoding = ast.encoding!
  return encoding.reduce<z.ZodTypeAny>(
    (acc, link) => acc.transform((v) => decode(link.transformation, v)),
    walk(encoding[0].to),
  )
}

// Transformations built via pure `SchemaGetter.transform(fn)` (the common
// decodeTo case) resolve synchronously, so running with no services is safe.
// Effectful / middleware-based transforms will surface as Effect defects.
function decode(transformation: SchemaAST.Link["transformation"], value: unknown): unknown {
  const exit = Effect.runSyncExit(
    (transformation.decode as any).run(Option.some(value), EMPTY_PARSE_OPTIONS) as Effect.Effect<
      Option.Option<unknown>
    >,
  )
  if (exit._tag === "Failure") throw new Error(`effect-zod: transform failed: ${String(exit.cause)}`)
  return Option.getOrElse(exit.value, () => value)
}

// Flatten FilterGroups and any nested variants into a linear list of Filters.
// Well-known filters (Schema.isInt, isGreaterThan, isPattern, …) are
// translated into native Zod methods so their JSON Schema output includes
// the corresponding constraint (type: integer, exclusiveMinimum, pattern, …).
// Anything else falls back to a single .superRefine layer — runtime-only,
// emits no JSON Schema constraint.
function applyChecks(out: z.ZodTypeAny, checks: SchemaAST.Checks, ast: SchemaAST.AST): z.ZodTypeAny {
  const filters: SchemaAST.Filter<unknown>[] = []
  const collect = (c: SchemaAST.Check<unknown>) => {
    if (c._tag === "FilterGroup") c.checks.forEach(collect)
    else filters.push(c)
  }
  checks.forEach(collect)

  const unhandled: SchemaAST.Filter<unknown>[] = []
  const translated = filters.reduce<z.ZodTypeAny>((acc, filter) => {
    const next = translateFilter(acc, filter)
    if (next) return next
    unhandled.push(filter)
    return acc
  }, out)

  if (unhandled.length === 0) return translated

  return translated.superRefine((value, ctx) => {
    for (const filter of unhandled) {
      const issue = filter.run(value, ast, EMPTY_PARSE_OPTIONS)
      if (!issue) continue
      const message = issueMessage(issue) ?? (filter.annotations as any)?.message ?? "Validation failed"
      ctx.addIssue({ code: "custom", message })
    }
  })
}

// Translate a well-known Effect Schema filter into a native Zod method call on
// `out`. Dispatch is keyed on `filter.annotations.meta._tag`, which every
// built-in check factory (isInt, isGreaterThan, isPattern, …) attaches at
// construction time. Returns `undefined` for unrecognised filters so the
// caller can fall back to the generic .superRefine path.
function translateFilter(out: z.ZodTypeAny, filter: SchemaAST.Filter<unknown>): z.ZodTypeAny | undefined {
  const meta = (filter.annotations as { meta?: Record<string, unknown> } | undefined)?.meta
  if (!meta || typeof meta._tag !== "string") return undefined
  switch (meta._tag) {
    case "isInt":
      return call(out, "int")
    case "isFinite":
      return call(out, "finite")
    case "isGreaterThan":
      return call(out, "gt", meta.exclusiveMinimum)
    case "isGreaterThanOrEqualTo":
      return call(out, "gte", meta.minimum)
    case "isLessThan":
      return call(out, "lt", meta.exclusiveMaximum)
    case "isLessThanOrEqualTo":
      return call(out, "lte", meta.maximum)
    case "isBetween": {
      const lo = meta.exclusiveMinimum ? call(out, "gt", meta.minimum) : call(out, "gte", meta.minimum)
      if (!lo) return undefined
      return meta.exclusiveMaximum ? call(lo, "lt", meta.maximum) : call(lo, "lte", meta.maximum)
    }
    case "isMultipleOf":
      return call(out, "multipleOf", meta.divisor)
    case "isMinLength":
      return call(out, "min", meta.minLength)
    case "isMaxLength":
      return call(out, "max", meta.maxLength)
    case "isLengthBetween": {
      const lo = call(out, "min", meta.minimum)
      if (!lo) return undefined
      return call(lo, "max", meta.maximum)
    }
    case "isPattern":
      return call(out, "regex", meta.regExp)
    case "isStartsWith":
      return call(out, "startsWith", meta.startsWith)
    case "isEndsWith":
      return call(out, "endsWith", meta.endsWith)
    case "isIncludes":
      return call(out, "includes", meta.includes)
    case "isUUID":
      return call(out, "uuid")
    case "isULID":
      return call(out, "ulid")
    case "isBase64":
      return call(out, "base64")
    case "isBase64Url":
      return call(out, "base64url")
  }
  return undefined
}

// Invoke a named Zod method on `target` if it exists, otherwise return
// undefined so the caller can fall back. Using this helper instead of a
// typed cast keeps `translateFilter` free of per-case narrowing noise.
function call(target: z.ZodTypeAny, method: string, ...args: unknown[]): z.ZodTypeAny | undefined {
  const fn = (target as unknown as Record<string, ((...a: unknown[]) => z.ZodTypeAny) | undefined>)[method]
  return typeof fn === "function" ? fn.apply(target, args) : undefined
}

function issueMessage(issue: any): string | undefined {
  if (typeof issue?.annotations?.message === "string") return issue.annotations.message
  if (typeof issue?.message === "string") return issue.message
  return undefined
}

function body(ast: SchemaAST.AST): z.ZodTypeAny {
  if (SchemaAST.isOptional(ast)) return opt(ast)

  switch (ast._tag) {
    case "String":
      return z.string()
    case "Number":
      return z.number()
    case "Boolean":
      return z.boolean()
    case "Null":
      return z.null()
    case "Undefined":
      return z.undefined()
    case "Any":
    case "Unknown":
      return z.unknown()
    case "Never":
      return z.never()
    case "Literal":
      return z.literal(ast.literal)
    case "Union":
      return union(ast)
    case "Objects":
      return object(ast)
    case "Arrays":
      return array(ast)
    case "Declaration":
      return decl(ast)
    default:
      return fail(ast)
  }
}

function opt(ast: SchemaAST.AST): z.ZodTypeAny {
  if (ast._tag !== "Union") return fail(ast)
  const items = ast.types.filter((item) => item._tag !== "Undefined")
  if (items.length === 1) return walk(items[0]).optional()
  if (items.length > 1)
    return z.union(items.map(walk) as [z.ZodTypeAny, z.ZodTypeAny, ...Array<z.ZodTypeAny>]).optional()
  return z.undefined().optional()
}

function union(ast: SchemaAST.Union): z.ZodTypeAny {
  // When every member is a string literal, emit z.enum() so that
  // JSON Schema produces { "enum": [...] } instead of { "anyOf": [{ "const": ... }] }.
  if (ast.types.length >= 2 && ast.types.every((t) => t._tag === "Literal" && typeof t.literal === "string")) {
    return z.enum(ast.types.map((t) => (t as SchemaAST.Literal).literal as string) as [string, ...string[]])
  }

  const items = ast.types.map(walk)
  if (items.length === 1) return items[0]
  if (items.length < 2) return fail(ast)

  const discriminator = ast.annotations?.discriminator
  if (typeof discriminator === "string") {
    return z.discriminatedUnion(discriminator, items as [z.ZodObject<any>, z.ZodObject<any>, ...z.ZodObject<any>[]])
  }

  return z.union(items as [z.ZodTypeAny, z.ZodTypeAny, ...Array<z.ZodTypeAny>])
}

function object(ast: SchemaAST.Objects): z.ZodTypeAny {
  // Pure record: { [k: string]: V }
  if (ast.propertySignatures.length === 0 && ast.indexSignatures.length === 1) {
    const sig = ast.indexSignatures[0]
    if (sig.parameter._tag !== "String") return fail(ast)
    return z.record(z.string(), walk(sig.type))
  }

  // Pure object with known fields and no index signatures.
  if (ast.indexSignatures.length === 0) {
    return z.object(Object.fromEntries(ast.propertySignatures.map((sig) => [String(sig.name), walk(sig.type)])))
  }

  // Struct with a catchall (StructWithRest): known fields + index signature.
  // Only supports a single string-keyed index signature; multi-signature or
  // symbol/number keys fall through to fail.
  if (ast.indexSignatures.length !== 1) return fail(ast)
  const sig = ast.indexSignatures[0]
  if (sig.parameter._tag !== "String") return fail(ast)
  return z
    .object(Object.fromEntries(ast.propertySignatures.map((p) => [String(p.name), walk(p.type)])))
    .catchall(walk(sig.type))
}

function array(ast: SchemaAST.Arrays): z.ZodTypeAny {
  // Pure variadic arrays: { elements: [], rest: [item] }
  if (ast.elements.length === 0) {
    if (ast.rest.length !== 1) return fail(ast)
    return z.array(walk(ast.rest[0]))
  }
  // Fixed-length tuples: { elements: [a, b, ...], rest: [] }
  // Tuples with a variadic tail (...rest) are not yet supported.
  if (ast.rest.length > 0) return fail(ast)
  const items = ast.elements.map(walk)
  return z.tuple(items as [z.ZodTypeAny, ...Array<z.ZodTypeAny>])
}

function decl(ast: SchemaAST.Declaration): z.ZodTypeAny {
  if (ast.typeParameters.length !== 1) return fail(ast)
  return walk(ast.typeParameters[0])
}

function fail(ast: SchemaAST.AST): never {
  const ref = SchemaAST.resolveIdentifier(ast)
  throw new Error(`unsupported effect schema: ${ref ?? ast._tag}`)
}
