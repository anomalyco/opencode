import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { FileMutation } from "@opencode-ai/core/file-mutation"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { EditTool } from "@opencode-ai/core/tool/edit"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const sessionID = SessionV2.ID.make("ses_edit_tool_test")
const assertions: PermissionV2.AssertInput[] = []
const writes: string[] = []
let reads = 0
let denyAction: string | undefined
let afterAssertion = (_input: PermissionV2.AssertInput): Effect.Effect<void> => Effect.void
let afterRead = (_target: string, _content: Uint8Array): Effect.Effect<void> => Effect.void

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => assertions.push(input)).pipe(
        Effect.andThen(
          input.action === denyAction
            ? Effect.fail(new PermissionV2.DeniedError({ rules: [] }))
            : afterAssertion(input),
        ),
      ),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const reset = () => {
  assertions.length = 0
  writes.length = 0
  reads = 0
  denyAction = undefined
  afterAssertion = () => Effect.void
  afterRead = () => Effect.void
}

const filesystem = Layer.effect(
  FSUtil.Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    return FSUtil.Service.of({
      ...fs,
      readFile: (target) =>
        fs
          .readFile(target)
          .pipe(
            Effect.tap((content) =>
              Effect.sync(() => reads++).pipe(Effect.andThen(Effect.suspend(() => afterRead(target, content)))),
            ),
          ),
      writeWithDirs: (target, content, mode) =>
        Effect.sync(() => writes.push(target)).pipe(Effect.andThen(fs.writeWithDirs(target, content, mode))),
    })
  }),
).pipe(Layer.provide(FSUtil.defaultLayer))

const withTool = <A, E, R>(directory: string, body: (registry: ToolRegistry.Interface) => Effect.Effect<A, E, R>) => {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
  )
  const planning = LocationMutation.layer.pipe(Layer.provide(filesystem), Layer.provide(activeLocation))
  const commits = FileMutation.layer.pipe(Layer.provide(filesystem), Layer.provide(planning))
  const registry = ToolRegistry.defaultLayer.pipe(Layer.provide(permission))
  const edit = EditTool.layer.pipe(
    Layer.provide(registry),
    Layer.provide(planning),
    Layer.provide(commits),
    Layer.provide(filesystem),
  )
  return Effect.gen(function* () {
    return yield* body(yield* ToolRegistry.Service)
  }).pipe(Effect.provide(Layer.mergeAll(registry, planning, commits, edit)))
}

const call = (input: typeof EditTool.Parameters.Type, id = "call-edit") => ({
  sessionID,
  call: { type: "tool-call" as const, id, name: "edit", input },
})

const it = testEffect(Layer.empty)

describe("EditTool", () => {
  it.live("registers and replaces relative exact text through FileMutation once", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        const target = path.join(tmp.path, "hello.txt")
        return Effect.promise(() => fs.writeFile(target, "before\nrest\n")).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              Effect.gen(function* () {
                expect((yield* registry.definitions()).map((tool) => tool.name)).toEqual(["edit"])
                const settled = yield* registry.settle(
                  call({ path: "hello.txt", oldString: "before", newString: "after" }),
                )
                expect(settled.result).toEqual({
                  type: "text",
                  value: "Edited file successfully: hello.txt\nReplacements: 1\n```diff\n-before\n+after\n```",
                })
                expect(settled.output?.structured).toEqual({
                  operation: "write",
                  target: yield* Effect.promise(() => fs.realpath(target)),
                  resource: "hello.txt",
                  existed: true,
                  replacements: 1,
                })
                expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("after\nrest\n")
                expect(assertions).toEqual([{ sessionID, action: "edit", resources: ["hello.txt"], save: ["*"] }])
                expect(writes).toEqual([yield* Effect.promise(() => fs.realpath(target))])
              }),
            ),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("accepts an absolute file path inside the active Location", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        const target = path.join(tmp.path, "absolute.txt")
        return Effect.promise(() => fs.writeFile(target, "before")).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              registry.execute(call({ path: target, oldString: "before", newString: "after" })),
            ),
          ),
          Effect.andThen((result) =>
            Effect.gen(function* () {
              expect(result.type).toBe("text")
              expect(assertions.map((input) => input.action)).toEqual(["edit"])
              expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("after")
            }),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("approves an explicit external absolute path before edit", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      ([active, outside]) => {
        reset()
        const target = path.join(outside.path, "external.txt")
        return Effect.promise(() => fs.writeFile(target, "before")).pipe(
          Effect.andThen(
            withTool(active.path, (registry) =>
              registry.execute(call({ path: target, oldString: "before", newString: "after" })),
            ),
          ),
          Effect.andThen((result) =>
            Effect.gen(function* () {
              expect(result.type).toBe("text")
              expect(assertions.map((input) => input.action)).toEqual(["external_directory", "edit"])
              expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("after")
              expect(writes).toHaveLength(1)
            }),
          ),
        )
      },
      ([active, outside]) =>
        Effect.promise(() =>
          Promise.all([active[Symbol.asyncDispose](), outside[Symbol.asyncDispose]()]).then(() => undefined),
        ),
    ),
  )

  it.live("does not write when external_directory or edit approval is denied", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      ([active, outside]) =>
        Effect.gen(function* () {
          const external = path.join(outside.path, "denied.txt")
          yield* Effect.promise(() => fs.writeFile(external, "before"))
          reset()
          denyAction = "external_directory"
          expect(
            yield* withTool(active.path, (registry) =>
              registry.execute(call({ path: external, oldString: "before", newString: "after" })),
            ),
          ).toEqual({
            type: "error",
            value: `Unable to edit ${external}`,
          })
          expect(assertions.map((input) => input.action)).toEqual(["external_directory"])
          expect(reads).toBe(0)
          expect(writes).toEqual([])

          reset()
          denyAction = "edit"
          expect(
            yield* withTool(active.path, (registry) =>
              registry.execute(call({ path: external, oldString: "before", newString: "after" })),
            ),
          ).toEqual({
            type: "error",
            value: `Unable to edit ${external}`,
          })
          expect(assertions.map((input) => input.action)).toEqual(["external_directory", "edit"])
          expect(reads).toBe(0)
          expect(writes).toEqual([])
          expect(yield* Effect.promise(() => fs.readFile(external, "utf8"))).toBe("before")
        }),
      ([active, outside]) =>
        Effect.promise(() =>
          Promise.all([active[Symbol.asyncDispose](), outside[Symbol.asyncDispose]()]).then(() => undefined),
        ),
    ),
  )

  it.live("denied edit reads no target content and does not disclose whether oldString matches", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        denyAction = "edit"
        const target = path.join(tmp.path, "secret.txt")
        return Effect.promise(() => fs.writeFile(target, "secret content")).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              Effect.gen(function* () {
                const matching = yield* registry.execute(
                  call({ path: "secret.txt", oldString: "secret content", newString: "replacement" }),
                )
                const missing = yield* registry.execute(
                  call({ path: "secret.txt", oldString: "not present", newString: "replacement" }),
                )

                expect(matching).toEqual({ type: "error", value: "Unable to edit secret.txt" })
                expect(missing).toEqual(matching)
                expect(assertions.map((input) => input.action)).toEqual(["edit", "edit"])
                expect(reads).toBe(0)
                expect(writes).toEqual([])
              }),
            ),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("rejects no-op, empty, missing, and ambiguous exact replacements", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        const target = path.join(tmp.path, "matches.txt")
        return Effect.promise(() => fs.writeFile(target, "same same")).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              Effect.gen(function* () {
                expect(
                  yield* registry.execute(call({ path: "matches.txt", oldString: "same", newString: "same" })),
                ).toEqual({
                  type: "error",
                  value: "No changes to apply: oldString and newString are identical.",
                })
                expect(
                  yield* registry.execute(call({ path: "matches.txt", oldString: "", newString: "after" })),
                ).toEqual({
                  type: "error",
                  value: "oldString must not be empty. Use write to create or overwrite a file.",
                })
                expect(
                  yield* registry.execute(call({ path: "matches.txt", oldString: "missing", newString: "after" })),
                ).toEqual({
                  type: "error",
                  value:
                    "Could not find oldString in the file. It must match exactly, including whitespace and indentation.",
                })
                expect(
                  yield* registry.execute(call({ path: "matches.txt", oldString: "same", newString: "after" })),
                ).toEqual({
                  type: "error",
                  value:
                    "Found multiple exact matches for oldString. Provide more surrounding context or set replaceAll to true.",
                })
                expect(writes).toEqual([])
              }),
            ),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("replaces every exact occurrence when replaceAll is true", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        const target = path.join(tmp.path, "all.txt")
        return Effect.promise(() => fs.writeFile(target, "same same same")).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              registry.settle(call({ path: "all.txt", oldString: "same", newString: "after", replaceAll: true })),
            ),
          ),
          Effect.andThen((settled) =>
            Effect.gen(function* () {
              expect(settled.output?.structured).toMatchObject({ replacements: 3 })
              expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("after after after")
              expect(writes).toHaveLength(1)
            }),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("preserves BOM and CRLF line endings", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        const target = path.join(tmp.path, "windows.txt")
        return Effect.promise(() => fs.writeFile(target, "\uFEFFbefore\r\nrest\r\n")).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              registry.execute(call({ path: "windows.txt", oldString: "before\nrest", newString: "after\nrest" })),
            ),
          ),
          Effect.andThen(() => Effect.promise(() => fs.readFile(target, "utf8"))),
          Effect.tap((content) => Effect.sync(() => expect(content).toBe("\uFEFFafter\r\nrest\r\n"))),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("rejects an in-place content change after matching but before conditional commit", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        const target = path.join(tmp.path, "concurrent.txt")
        afterRead = () => (reads === 1 ? Effect.promise(() => fs.writeFile(target, "newer\n")) : Effect.void)
        return Effect.promise(() => fs.writeFile(target, "before\n")).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              registry.execute(call({ path: "concurrent.txt", oldString: "before", newString: "after" })),
            ),
          ),
          Effect.andThen((result) =>
            Effect.gen(function* () {
              expect(result).toEqual({
                type: "error",
                value: "File changed after permission approval. Read it again before editing.",
              })
              expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("newer\n")
              expect(writes).toEqual([])
            }),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  if (process.platform !== "win32") {
    it.live("delegates post-approval revalidation to FileMutation before writing", () =>
      Effect.acquireUseRelease(
        Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
        ([active, outside]) => {
          reset()
          const parent = path.join(active.path, "parent")
          const detached = path.join(active.path, "detached")
          afterAssertion = (input) =>
            input.action === "edit"
              ? Effect.promise(async () => {
                  await fs.rename(parent, detached)
                  await fs.symlink(outside.path, parent)
                })
              : Effect.void
          return Effect.promise(async () => {
            await fs.mkdir(parent)
            await fs.writeFile(path.join(parent, "escape.txt"), "before")
          }).pipe(
            Effect.andThen(
              withTool(active.path, (registry) =>
                registry.execute(call({ path: "parent/escape.txt", oldString: "before", newString: "after" })),
              ),
            ),
            Effect.andThen((result) =>
              Effect.gen(function* () {
                expect(result).toEqual({ type: "error", value: "Unable to edit parent/escape.txt" })
                expect(assertions.map((input) => input.action)).toEqual(["edit"])
                expect(writes).toEqual([])
                expect(
                  yield* Effect.promise(() =>
                    fs.stat(path.join(outside.path, "escape.txt")).then(
                      () => true,
                      () => false,
                    ),
                  ),
                ).toBe(false)
              }),
            ),
          )
        },
        ([active, outside]) =>
          Effect.promise(() =>
            Promise.all([active[Symbol.asyncDispose](), outside[Symbol.asyncDispose]()]).then(() => undefined),
          ),
      ),
    )
  }
})

test("keeps the locked edit schema, semantics docstring, and deferred TODOs visible", async () => {
  const source = (await fs.readFile(new URL("../src/tool/edit.ts", import.meta.url), "utf8")).replaceAll("\r\n", "\n")
  const definition = await Effect.runPromise(
    withTool(path.dirname(fileURLToPath(import.meta.url)), (registry) => registry.definitions()),
  )
  const schema = definition[0]?.inputSchema as { readonly properties?: Record<string, unknown> }

  expect(Object.keys(schema.properties ?? {}).sort()).toEqual(["newString", "oldString", "path", "replaceAll"])
  expect(source).toContain(
    "Named project references\n * are read-oriented and deliberately are not accepted by mutation tools.",
  )
  for (const todo of [
    "Port V1 fuzzy correction strategies only after exact-edit behavior is established: line-trimmed matching, block-anchor fallback, indentation correction, and similarity-threshold review.",
    "Add formatter integration after V2 formatter runtime exists.",
    "Publish watcher/file-edit events after V2 watcher integration exists.",
    "Add snapshots / undo after design exists.",
    "Add LSP notification and diagnostics after V2 LSP runtime exists.",
  ]) {
    expect(source).toContain(`TODO: ${todo}`)
  }
})
