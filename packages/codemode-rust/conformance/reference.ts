// Loads the reference's language layer (`packages/codemode/src/language`, the `Language` namespace) and `effect` as
// the reference resolves it, and defines the `tools` host global the generators and the reference bench drivers share.
//
// The reference package directory: `override` (a generator's first argument or CODEMODE_REF), or by default
// ../codemode relative to this workspace.
//
// The `tools` global (`Host.namespace`), the same wherever it is used:
// - `keys([])` is `["echo", "fail", "git"]`, `keys(["git"])` is `["status"]`, `keys` of a function's path (`["echo"]`,
//   `["fail"]`, `["git", "status"]`) is `[]`; any other path throws `Host.fail("NotFound", "No namespace at tools.<path>.")`.
// - `resolve(path)` (path joined with "."):
//   - `echo`: `Host.fn`, `type: "async"`, not idempotent; gives its first argument's own `id` property when that
//     argument is a non-null object, otherwise `null`.
//   - `fail`: `Host.fn`, `type: "async"`; fails with `Host.fail("HostFailure", "boom")`.
//   - `git.status`: `Host.fn`, `type: "async"`; gives `{ branch: "main", dirty: true }`.
//   - any other path: `Host.fn`, `type: "async"`, that fails with `Host.fail("NotFound", "No function at tools.<path>.")`,
//     so calling it rejects its promise.
//   Each function's `run` takes one parameter (`length` 1); its name is the last segment of its path.

import { join, resolve } from "node:path"

export const reference = async (override?: string) => {
  const pkg = override === undefined ? resolve(import.meta.dir, "../../codemode") : resolve(override)
  const effect = await import(Bun.resolveSync("effect", join(pkg, "src")))
  const language = await import(join(pkg, "src/language/index.ts"))
  return { pkg, Effect: effect.Effect, Fiber: effect.Fiber, Language: language }
}

type Reference = Awaited<ReturnType<typeof reference>>

export const toolsGlobal = (ref: Reference) => {
  const Effect = ref.Effect
  const Host = ref.Language.Host
  const echo = Host.fn(
    ([input]: ReadonlyArray<unknown>) =>
      Effect.succeed(
        typeof input === "object" && input !== null && Object.hasOwn(input, "id")
          ? (input as { id: unknown }).id
          : null,
      ),
    { type: "async" },
  )
  const fail = Host.fn((_: ReadonlyArray<unknown>) => Effect.fail(Host.fail("HostFailure", "boom")), { type: "async" })
  const status = Host.fn((_: ReadonlyArray<unknown>) => Effect.succeed({ branch: "main", dirty: true }), {
    type: "async",
  })
  const functions = new Map<string, unknown>([
    ["echo", echo],
    ["fail", fail],
    ["git.status", status],
  ])
  const namespaces = new Map([
    ["", ["echo", "fail", "git"]],
    ["git", ["status"]],
  ])
  return Host.namespace({
    keys: (path: ReadonlyArray<string>) => {
      const name = path.join(".")
      const names = namespaces.get(name)
      if (names !== undefined) return names
      if (functions.has(name)) return []
      throw Host.fail("NotFound", `No namespace at tools.${name}.`)
    },
    resolve: (path: ReadonlyArray<string>) => {
      const name = path.join(".")
      return (
        functions.get(name) ??
        Host.fn((_: ReadonlyArray<unknown>) => Effect.fail(Host.fail("NotFound", `No function at tools.${name}.`)), {
          type: "async",
        })
      )
    },
  })
}

/**
 * A host value as data, for recordings: what a host function received, in a form JSON keeps. `{ undefined: true }`,
 * `{ number: "NaN" | "Infinity" | "-Infinity" }`, JSON primitives as they are, `{ function: name }`,
 * `{ date: ms | "NaN" }`, `{ regexp: [source, flags] }`, `{ url: href }`, `{ params: [[k, v], ...] }`,
 * `{ headers: [[k, v], ...] }`, `{ buffer: [bytes] }`, `{ bytes: [bytes] }`, `{ arrayBuffer: [bytes] }`,
 * `{ map: [[k, v], ...] }`, `{ set: [v, ...] }`, `{ array: [v | { hole: true }, ...] }`, and a string, an object key
 * or an error message with an unpaired surrogate as `{ string: [code units] }`,
 * `{ error: { name, message, cause?, fields: [[k, v], ...] } }`, `{ object: [[k, v], ...] }`.
 */
export const describe = (v: unknown): unknown => {
  if (v === undefined) return { undefined: true }
  if (typeof v === "number" && !Number.isFinite(v)) return { number: String(v) }
  if (typeof v === "string") return text(v)
  if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v
  if (typeof v === "function") return { function: v.name }
  if (v instanceof Date) return { date: Number.isNaN(v.getTime()) ? "NaN" : v.getTime() }
  if (v instanceof RegExp) return { regexp: [text(v.source), v.flags] }
  if (v instanceof URL) return { url: v.href }
  if (v instanceof URLSearchParams) return { params: [...v] }
  if (v instanceof Headers) return { headers: [...v] }
  if (Buffer.isBuffer(v)) return { buffer: [...v] }
  if (v instanceof Uint8Array) return { bytes: [...v] }
  if (v instanceof ArrayBuffer) return { arrayBuffer: [...new Uint8Array(v)] }
  if (v instanceof Map) return { map: [...v].map(([k, x]) => [describe(k), describe(x)]) }
  if (v instanceof Set) return { set: [...v].map(describe) }
  if (Array.isArray(v))
    return { array: Array.from({ length: v.length }, (_, i) => (i in v ? describe(v[i]) : { hole: true })) }
  if (v instanceof Error) {
    const fields = v as unknown as Record<string, unknown>
    return {
      error: {
        name: text(v.name),
        message: text(v.message),
        ...("cause" in v ? { cause: describe(v.cause) } : {}),
        fields: Object.keys(v).map((k) => [text(k), describe(fields[k])]),
      },
    }
  }
  return { object: Object.entries(v as Record<string, unknown>).map(([k, x]) => [text(k), describe(x)]) }
}

/** A string as `describe` writes it: itself, or `{ string: [code units] }` when it has an unpaired surrogate. */
const text = (s: string): unknown =>
  s.isWellFormed() ? s : { string: Array.from({ length: s.length }, (_, i) => s.charCodeAt(i)) }
