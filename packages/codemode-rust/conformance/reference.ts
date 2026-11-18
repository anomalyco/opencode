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
      Effect.succeed(typeof input === "object" && input !== null && Object.hasOwn(input, "id") ? (input as { id: unknown }).id : null),
    { type: "async" },
  )
  const fail = Host.fn((_: ReadonlyArray<unknown>) => Effect.fail(Host.fail("HostFailure", "boom")), { type: "async" })
  const status = Host.fn((_: ReadonlyArray<unknown>) => Effect.succeed({ branch: "main", dirty: true }), { type: "async" })
  const functions = new Map<string, unknown>([["echo", echo], ["fail", fail], ["git.status", status]])
  const namespaces = new Map([["", ["echo", "fail", "git"]], ["git", ["status"]]])
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
