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
import { toolIdentity, executeTool, settleTool, toolDefinitions } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_edit_tool_test")
const assertions: PermissionV2.AssertInput[] = []
const writes: string[] = []
let reads = 0
let denyAction: string | undefined
let afterRead = (_target: string, _content: Uint8Array): Effect.Effect<void> => Effect.void

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => assertions.push(input)).pipe(
        Effect.andThen(
          input.action === denyAction ? Effect.fail(new PermissionV2.DeniedError({ rules: [] })) : Effect.void,
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
      writeFile: (target, content, options) =>
        Effect.sync(() => writes.push(target)).pipe(Effect.andThen(fs.writeFile(target, content, options))),
      writeFileString: (target, content, options) =>
        Effect.sync(() => writes.push(target)).pipe(Effect.andThen(fs.writeFileString(target, content, options))),
    })
  }),
).pipe(Layer.provide(FSUtil.defaultLayer))

const withTool = <A, E, R>(directory: string, body: (registry: ToolRegistry.Interface) => Effect.Effect<A, E, R>) => {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
  )
  const resolution = LocationMutation.layer.pipe(Layer.provide(filesystem), Layer.provide(activeLocation))
  const mutation = FileMutation.layer.pipe(Layer.provide(filesystem))
  const registry = ToolRegistry.defaultLayer.pipe(Layer.provide(permission))
  const edit = EditTool.layer.pipe(
    Layer.provide(registry),
    Layer.provide(permission),
    Layer.provide(resolution),
    Layer.provide(mutation),
    Layer.provide(filesystem),
  )
  return Effect.gen(function* () {
    return yield* body(yield* ToolRegistry.Service)
  }).pipe(Effect.provide(Layer.mergeAll(registry, resolution, mutation, edit)))
}

const call = (input: typeof EditTool.Input.Type, id = "call-edit") => ({
  sessionID,
  ...toolIdentity,
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
                expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual(["edit"])
                expect(yield* toolDefinitions(registry, [{ action: "edit", resource: "*", effect: "deny" }])).toEqual(
                  [],
                )
                const settled = yield* settleTool(
                  registry,
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
                expect(assertions).toMatchObject([{ sessionID, action: "edit", resources: ["hello.txt"], save: ["*"] }])
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
              executeTool(registry, call({ path: target, oldString: "before", newString: "after" })),
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
              executeTool(registry, call({ path: target, oldString: "before", newString: "after" })),
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
              executeTool(registry, call({ path: external, oldString: "before", newString: "after" })),
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
              executeTool(registry, call({ path: external, oldString: "before", newString: "after" })),
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
                const matching = yield* executeTool(
                  registry,
                  call({ path: "secret.txt", oldString: "secret content", newString: "replacement" }),
                )
                const missing = yield* executeTool(
                  registry,
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
                  yield* executeTool(registry, call({ path: "matches.txt", oldString: "same", newString: "same" })),
                ).toEqual({
                  type: "error",
                  value: "No changes to apply: oldString and newString are identical.",
                })
                expect(
                  yield* executeTool(registry, call({ path: "matches.txt", oldString: "", newString: "after" })),
                ).toEqual({
                  type: "error",
                  value: "oldString must not be empty. Use write to create or overwrite a file.",
                })
                expect(
                  yield* executeTool(registry, call({ path: "matches.txt", oldString: "missing", newString: "after" })),
                ).toEqual({
                  type: "error",
                  value:
                    "Could not find oldString in the file. It must match exactly, including whitespace and indentation.",
                })
                expect(
                  yield* executeTool(registry, call({ path: "matches.txt", oldString: "same", newString: "after" })),
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
              settleTool(registry, call({ path: "all.txt", oldString: "same", newString: "after", replaceAll: true })),
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
              executeTool(registry, call({ path: "windows.txt", oldString: "before\nrest", newString: "after\nrest" })),
            ),
          ),
          Effect.andThen(() => Effect.promise(() => fs.readFile(target, "utf8"))),
          Effect.tap((content) => Effect.sync(() => expect(content).toBe("\uFEFFafter\r\nrest\r\n"))),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("fuzzy-matches trailing whitespace differences via line-trimmed replacer", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        const target = path.join(tmp.path, "trailing.txt")
        return Effect.promise(() => fs.writeFile(target, "const x = 1\nconst y = 2")).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              settleTool(registry, call({ path: "trailing.txt", oldString: "const x = 1  \nconst y = 2", newString: "const x = 1\nconst y = 2" })),
            ),
          ),
          Effect.andThen((settled) =>
            Effect.gen(function* () {
              expect(settled.output?.structured).toMatchObject({ replacements: 1 })
              expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("const x = 1\nconst y = 2")
            }),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("fuzzy-matches extra whitespace via whitespace-normalized replacer", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        const target = path.join(tmp.path, "spaces.txt")
        return Effect.promise(() => fs.writeFile(target, "const    x   =   1")).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              settleTool(registry, call({ path: "spaces.txt", oldString: "const x = 1", newString: "const x = 2" })),
            ),
          ),
          Effect.andThen((settled) =>
            Effect.gen(function* () {
              expect(settled.output?.structured).toMatchObject({ replacements: 1 })
              expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("const x = 2")
            }),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("fuzzy-matches indentation differences via indentation-flexible replacer", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        const target = path.join(tmp.path, "indent.txt")
        return Effect.promise(() => fs.writeFile(target, "    const x = 1\n    const y = 2")).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              settleTool(
                registry,
                call({ path: "indent.txt", oldString: "const x = 1\nconst y = 2", newString: "const z = 3\nconst w = 4" }),
              ),
            ),
          ),
          Effect.andThen((settled) =>
            Effect.gen(function* () {
              expect(settled.output?.structured).toMatchObject({ replacements: 1 })
              expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("const z = 3\nconst w = 4")
            }),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("fuzzy-matches escaped characters via escape-normalized replacer", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        const target = path.join(tmp.path, "escape.txt")
        return Effect.promise(() => fs.writeFile(target, "hello\nworld")).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              settleTool(registry, call({ path: "escape.txt", oldString: "hello\\nworld", newString: "hi\\nthere" })),
            ),
          ),
          Effect.andThen((settled) =>
            Effect.gen(function* () {
              expect(settled.output?.structured).toMatchObject({ replacements: 1 })
              expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("hi\\nthere")
            }),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("fuzzy-matches trimmed boundary via trimmed-boundary replacer", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        const target = path.join(tmp.path, "boundary.txt")
        return Effect.promise(() => fs.writeFile(target, "hello world")).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              settleTool(
                registry,
                call({ path: "boundary.txt", oldString: "  hello world  ", newString: "goodbye" }),
              ),
            ),
          ),
          Effect.andThen((settled) =>
            Effect.gen(function* () {
              expect(settled.output?.structured).toMatchObject({ replacements: 1 })
              expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("goodbye")
            }),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("finds no match when content differs entirely", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        const target = path.join(tmp.path, "missing.txt")
        return Effect.promise(() => fs.writeFile(target, "completely different content")).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              executeTool(
                registry,
                call({ path: "missing.txt", oldString: "not found anywhere", newString: "replacement" }),
              ),
            ),
          ),
          Effect.andThen((result) =>
            Effect.gen(function* () {
              expect(result).toEqual({
                type: "error",
                value: "Could not find oldString in the file. It must match exactly, including whitespace and indentation.",
              })
              expect(writes).toEqual([])
              expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("completely different content")
            }),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("fuzzy-matches with replaceAll via multi-occurrence replacer", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        const target = path.join(tmp.path, "fuzzy-all.txt")
        return Effect.promise(() => fs.writeFile(target, "before\nbefore\nbefore")).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              settleTool(
                registry,
                call({ path: "fuzzy-all.txt", oldString: "before", newString: "after", replaceAll: true }),
              ),
            ),
          ),
          Effect.andThen((settled) =>
            Effect.gen(function* () {
              expect(settled.output?.structured).toMatchObject({ replacements: 3 })
              expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("after\nafter\nafter")
            }),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("fuzzy-matches block by anchors when middle content differs slightly", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        const target = path.join(tmp.path, "anchor.txt")
        return Effect.promise(() =>
          fs.writeFile(target, "function foo() {\n  let x = 1;\n  let y = 2;\n  return x + y;\n}"),
        ).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              settleTool(
                registry,
                call({
                  path: "anchor.txt",
                  oldString: "function foo() {\n  let x = 1;\n  let y = 3;\n  return x + y;\n}",
                  newString: "function foo() {\n  let x = 2;\n  let y = 2;\n  return x + y;\n}",
                }),
              ),
            ),
          ),
          Effect.andThen((settled) =>
            Effect.gen(function* () {
              expect(settled.output?.structured).toMatchObject({ replacements: 1 })
              expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe(
                "function foo() {\n  let x = 2;\n  let y = 2;\n  return x + y;\n}",
              )
            }),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("rejects replacement when fuzzy match span is disproportionately large", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        const pad = " ".repeat(300)
        const content = `${pad}a\n${pad}b\n${pad}c`
        const target = path.join(tmp.path, "disprop.txt")
        return Effect.promise(() => fs.writeFile(target, content)).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              executeTool(
                registry,
                call({
                  path: "disprop.txt",
                  oldString: "a\nb\nc",
                  newString: "x\ny\nz",
                }),
              ),
            ),
          ),
          Effect.andThen((result) =>
            Effect.gen(function* () {
              expect(result).toEqual({
                type: "error",
                value:
                  "Refusing replacement because the matched span is much larger than oldString. Re-read the file and provide the full exact oldString for the intended replacement.",
              })
              expect(writes).toEqual([])
              expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe(content)
            }),
          ),
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
              executeTool(registry, call({ path: "concurrent.txt", oldString: "before", newString: "after" })),
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
})

test("keeps the locked edit schema, semantics docstring, and deferred TODOs visible", async () => {
  const source = (await fs.readFile(new URL("../src/tool/edit.ts", import.meta.url), "utf8")).replaceAll("\r\n", "\n")
  const definition = await Effect.runPromise(
    withTool(path.dirname(fileURLToPath(import.meta.url)), (registry) => toolDefinitions(registry)),
  )
  const schema = definition[0]?.inputSchema as { readonly properties?: Record<string, unknown> }

  expect(Object.keys(schema.properties ?? {}).sort()).toEqual(["newString", "oldString", "path", "replaceAll"])
  expect(source).toContain("Model-facing V2 exact-edit leaf")
  expect(source).toContain("Deferred V2 edit behavior")
  expect(source).toContain("lineTrimmedReplacer")
  expect(source).toContain("blockAnchorReplacer")
  expect(source).toContain("whitespaceNormalizedReplacer")
  expect(source).toContain("indentationFlexibleReplacer")
  expect(source).toContain("escapeNormalizedReplacer")
  expect(source).toContain("trimmedBoundaryReplacer")
  expect(source).toContain("contextAwareReplacer")
  expect(source).toContain("multiOccurrenceReplacer")
  expect(source).toContain("levenshtein")
  expect(source).toContain("isDisproportionateMatch")
  expect(source).toContain("fuzzyMatch")
  for (const todo of [
    "Add formatter integration after V2 formatter runtime exists.",
    "Publish watcher/file-edit events after V2 watcher integration exists.",
    "Add snapshots / undo after design exists.",
    "Add LSP notification and diagnostics after V2 LSP runtime exists.",
  ]) {
    expect(source).toContain(`TODO: ${todo}`)
  }
})
