import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { FileMutation } from "@opencode-ai/core/file-mutation"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { Permission } from "@opencode-ai/core/permission"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { Tool } from "@opencode-ai/core/tool"
import { EditTool } from "@opencode-ai/core/tool/plugin/edit"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool, registerToolPlugin, toolDefinitions } from "./lib/tool"

const editToolNode = makeLocationNode({
  name: "test/edit-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(EditTool.Plugin)),
  deps: [Tool.node, LocationMutation.node, FileMutation.node, FSUtil.node, Permission.node],
})

const sessionID = Session.ID.make("ses_edit_tool_test")
const assertions: Permission.AssertInput[] = []
const writes: string[] = []
let reads = 0
let denyAction: string | undefined
let afterRead = (_target: string, _content: Uint8Array): Effect.Effect<void> => Effect.void

const permission = Layer.succeed(
  Permission.Service,
  Permission.Service.of({
    assert: (input) =>
      Effect.sync(() => assertions.push(input)).pipe(
        Effect.andThen(
          input.action === denyAction
            ? Effect.fail(
                new Permission.BlockedError({
                  rules: [],
                  permission: input.action,
                  resources: input.resources,
                }),
              )
            : Effect.void,
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
).pipe(Layer.provide(LayerNode.compile(FSUtil.node)))

const withTool = <A, E, R>(directory: string, body: (registry: Tool.Interface) => Effect.Effect<A, E, R>) => {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
  )
  return Effect.gen(function* () {
    return yield* body(yield* Tool.Service)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(
        LayerNode.group([
          Tool.node,
          Tool.node,
          LocationMutation.node,
          FileMutation.node,
          editToolNode,
        ]),
        [
          [FSUtil.node, filesystem],
          [Location.node, activeLocation],
          [Permission.node, permission],
        ],
      ),
    ),
  )
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
                expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual(["edit", "execute"])
                expect(
                  (yield* toolDefinitions(registry, [{ action: "edit", resource: "*", effect: "deny" }])).map(
                    (tool) => tool.name,
                  ),
                ).toEqual(["execute"])
                const settled = yield* executeTool(
                  registry,
                  call({ path: "hello.txt", oldString: "before", newString: "after" }),
                )
                expect(settled.status).toBe("completed")
                if (settled.status !== "completed") return
                expect(settled.content).toEqual([
                  {
                    type: "text",
                    text: "Edited file successfully: hello.txt\nReplacements: 1\n```diff\n-before\n+after\n```",
                  },
                ])
                // Compact UI metadata carries the file diffs the TUI renders.
                expect(settled.metadata).toMatchObject({
                  files: [{ file: "hello.txt", status: "modified", additions: 1, deletions: 1 }],
                })
                expect(settled.output).toEqual({
                  replacements: 1,
                  files: [
                    {
                      file: "hello.txt",
                      status: "modified",
                      additions: 1,
                      deletions: 1,
                      patch: expect.stringContaining("-before\n+after"),
                    },
                  ],
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
              expect(result.status).toBe("completed")
              expect(assertions.map((input) => input.action)).toEqual(["edit"])
              expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("after")
            }),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("edits an external symlink target with only its in-location permission", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      ([active, outside]) => {
        reset()
        if (process.platform === "win32") return Effect.void
        const target = path.join(outside.path, "external.txt")
        const link = path.join(active.path, "link.txt")
        return Effect.promise(async () => {
          await fs.writeFile(target, "before")
          await fs.symlink(target, link)
        }).pipe(
          Effect.andThen(
            withTool(active.path, (registry) =>
              executeTool(registry, call({ path: "link.txt", oldString: "before", newString: "after" })),
            ),
          ),
          Effect.andThen((result) =>
            Effect.sync(() => {
              expect(result.status).toBe("completed")
              expect(assertions.map((input) => input.action)).toEqual(["edit"])
              expect(assertions[0]?.resources).toEqual(["link.txt"])
            }),
          ),
          Effect.andThen(Effect.promise(() => fs.readFile(target, "utf8"))),
          Effect.tap((content) => Effect.sync(() => expect(content).toBe("after"))),
        )
      },
      ([active, outside]) =>
        Effect.promise(() =>
          Promise.all([active[Symbol.asyncDispose](), outside[Symbol.asyncDispose]()]).then(() => undefined),
        ),
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
              expect(result.status).toBe("completed")
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
            status: "error",
            error: { type: "permission.rejected", message: "Permission denied: external_directory" },
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
            status: "error",
            error: { type: "permission.rejected", message: "Permission denied: edit" },
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

                expect(matching).toEqual({
                  status: "error",
                  error: { type: "permission.rejected", message: "Permission denied: edit" },
                })
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
                  status: "error",
                  error: {
                    type: "tool.execution",
                    message: "No changes to apply: oldString and newString are identical.",
                  },
                })
                expect(
                  yield* executeTool(registry, call({ path: "matches.txt", oldString: "", newString: "after" })),
                ).toEqual({
                  status: "error",
                  error: {
                    type: "tool.execution",
                    message: "oldString must not be empty. Use write to create or overwrite a file.",
                  },
                })
                expect(
                  yield* executeTool(registry, call({ path: "matches.txt", oldString: "missing", newString: "after" })),
                ).toEqual({
                  status: "error",
                  error: {
                    type: "tool.execution",
                    message:
                      "Could not find oldString in the file. It must match exactly, including whitespace and indentation.",
                  },
                })
                expect(
                  yield* executeTool(registry, call({ path: "matches.txt", oldString: "same", newString: "after" })),
                ).toEqual({
                  status: "error",
                  error: {
                    type: "tool.execution",
                    message:
                      "Found multiple exact matches for oldString. Provide more surrounding context or set replaceAll to true.",
                  },
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
              executeTool(registry, call({ path: "all.txt", oldString: "same", newString: "after", replaceAll: true })),
            ),
          ),
          Effect.andThen((settled) =>
            Effect.gen(function* () {
              expect(settled.status).toBe("completed")
              if (settled.status !== "completed") return
              expect(settled.output).toMatchObject({ replacements: 3 })
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

  it.live("applies the edit when content changes after matching", () =>
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
              expect(result).toMatchObject({ status: "completed", output: { replacements: 1 } })
              expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("after\n")
              expect(writes).toEqual([target])
            }),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
})
