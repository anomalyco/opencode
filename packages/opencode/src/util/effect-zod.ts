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
  return encoding.reduce<z.ZodTypeAny>((acc, link) => acc.transform((v) => decode(link.transformation, v)), walk(encoding[0].to))
}

// Transformations built via pure `SchemaGetter.transform(fn)` (the common
// decodeTo case) resolve synchronously, so running with no services is safe.
// Effectful / middleware-based transforms will surface as Effect defects.
function decode(transformation: SchemaAST.Link["transformation"], value: unknown): unknown {
  const exit = Effect.runSyncExit(
    (transformation.decode as any).run(Option.some(value), EMPTY_PARSE_OPTIONS) as Effect.Effect<Option.Option<unknown>>,
  )
  if (exit._tag === "Failure") throw new Error(`effect-zod: transform failed: ${String(exit.cause)}`)
  return Option.getOrElse(exit.value, () => value)
}

// Flatten FilterGroups and any nested variants into a linear list of Filters
// so we can run all of them inside a single Zod .superRefine wrapper instead
// of stacking N wrapper layers (one per check).
function applyChecks(out: z.ZodTypeAny, checks: SchemaAST.Checks, ast: SchemaAST.AST): z.ZodTypeAny {
  const filters: SchemaAST.Filter<unknown>[] = []
  const collect = (c: SchemaAST.Check<unknown>) => {
    if (c._tag === "FilterGroup") c.checks.forEach(collect)
    else filters.push(c)
  }
  checks.forEach(collect)
  return out.superRefine((value, ctx) => {
    for (const filter of filters) {
      const issue = filter.run(value, ast, EMPTY_PARSE_OPTIONS)
      if (!issue) continue
      const message = issueMessage(issue) ?? (filter.annotations as any)?.message ?? "Validation failed"
      ctx.addIssue({ code: "custom", message })
    }
  })
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
