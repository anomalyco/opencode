import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer, Schema } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FileMutation } from "@opencode-ai/core/file-mutation"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { PatchTool } from "@opencode-ai/core/tool/patch"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { makeLocationNode } from "@opencode-ai/core/effect/app-node"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool, registerToolPlugin, settleTool, toolDefinitions } from "./lib/tool"

const patchToolNode = makeLocationNode({
  name: "test/patch-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(PatchTool.Plugin)),
  deps: [ToolRegistry.toolsNode, LocationMutation.node, FileMutation.node, FSUtil.node, PermissionV2.node],
})

const sessionID = SessionV2.ID.make("ses_patch_tool_test")
const assertions: PermissionV2.AssertInput[] = []
let denyAction: string | undefined
let failRemoveTarget: string | undefined
let readsBeforeEditApproval = 0
let editApproved = false
let blockRemoveTarget: string | undefined
let removeStarted: Deferred.Deferred<void> | undefined
let releaseRemove: Deferred.Deferred<void> | undefined
let afterEditApproval = (): Effect.Effect<void> => Effect.void

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => {
        assertions.push(input)
        if (input.action === "edit") editApproved = true
      }).pipe(
        Effect.andThen(input.action === "edit" ? Effect.suspend(afterEditApproval) : Effect.void),
        Effect.andThen(
          input.action === denyAction
            ? Effect.fail(
                new PermissionV2.BlockedError({
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
  denyAction = undefined
  failRemoveTarget = undefined
  readsBeforeEditApproval = 0
  editApproved = false
  blockRemoveTarget = undefined
  removeStarted = undefined
  releaseRemove = undefined
  afterEditApproval = () => Effect.void
}

const filesystem = Layer.effect(
  FSUtil.Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    return FSUtil.Service.of({
      ...fs,
      readFile: (target) =>
        Effect.sync(() => {
          if (!editApproved) readsBeforeEditApproval++
        }).pipe(Effect.andThen(fs.readFile(target))),
      remove: (target, options) => {
        if (failRemoveTarget && path.basename(target) === failRemoveTarget) return Effect.die("forced remove failure")
        if (blockRemoveTarget && path.basename(target) === blockRemoveTarget && removeStarted && releaseRemove)
          return Deferred.succeed(removeStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseRemove)),
            Effect.andThen(fs.remove(target, options)),
          )
        return fs.remove(target, options)
      },
    })
  }),
).pipe(Layer.provide(LayerNode.compile(FSUtil.node)))

const withTool = <A, E, R>(directory: string, body: (registry: ToolRegistry.Interface) => Effect.Effect<A, E, R>) => {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
  )
  return Effect.gen(function* () {
    return yield* body(yield* ToolRegistry.Service)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(
        LayerNode.group([
          ToolRegistry.node,
          ToolRegistry.toolsNode,
          LocationMutation.node,
          FileMutation.node,
          patchToolNode,
        ]),
        [
          [FSUtil.node, filesystem],
          [Location.node, activeLocation],
          [PermissionV2.node, permission],
          [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
        ],
      ),
    ),
  )
}

const call = (patchText: string, id = "call-patch") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: "patch", input: { patchText } },
})

const exists = (target: string) =>
  Effect.promise(() =>
    fs.stat(target).then(
      () => true,
      () => false,
    ),
  )
const it = testEffect(Layer.empty)

describe("PatchTool", () => {
  it.live("registers and sequentially applies add, update, and delete hunks", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        const update = path.join(tmp.path, "update.txt")
        const remove = path.join(tmp.path, "remove.txt")
        return Effect.promise(() =>
          Promise.all([fs.writeFile(update, "before\n"), fs.writeFile(remove, "remove\n")]),
        ).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              Effect.gen(function* () {
                expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual(["patch"])
                const settled = yield* settleTool(
                  registry,
                  call(
                    "*** Begin Patch\n*** Add File: nested/new.txt\n+created\n*** Update File: update.txt\n@@\n-before\n+after\n*** Delete File: remove.txt\n*** End Patch",
                  ),
                )
                expect(settled.result).toEqual({
                  type: "text",
                  value: "Success. Updated the following files:\nA nested/new.txt\nM update.txt\nD remove.txt",
                })
                expect(settled.output?.structured).toMatchObject({
                  applied: [
                    { type: "add", resource: "nested/new.txt" },
                    { type: "update", resource: "update.txt" },
                    { type: "delete", resource: "remove.txt" },
                  ],
                  files: [
                    {
                      file: "nested/new.txt",
                      status: "added",
                      additions: 1,
                      deletions: 0,
                      patch: expect.stringContaining("+created"),
                    },
                    {
                      file: "update.txt",
                      status: "modified",
                      additions: 1,
                      deletions: 1,
                      patch: expect.stringContaining("-before\n+after"),
                    },
                    {
                      file: "remove.txt",
                      status: "deleted",
                      additions: 0,
                      deletions: 1,
                      patch: expect.stringContaining("-remove"),
                    },
                  ],
                })
                expect(assertions).toMatchObject([
                  { sessionID, action: "edit", resources: ["nested/new.txt", "update.txt", "remove.txt"], save: ["*"] },
                ])
                expect(readsBeforeEditApproval).toBe(0)
                expect(yield* Effect.promise(() => fs.readFile(path.join(tmp.path, "nested/new.txt"), "utf8"))).toBe(
                  "created\n",
                )
                expect(yield* Effect.promise(() => fs.readFile(update, "utf8"))).toBe("after\n")
                expect(yield* exists(remove)).toBe(false)
              }),
            ),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("moves and updates a file", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        const source = path.join(tmp.path, "old.txt")
        return Effect.promise(() => fs.writeFile(source, "before\n")).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              Effect.gen(function* () {
                expect(
                  yield* executeTool(
                    registry,
                    call(
                      "*** Begin Patch\n*** Add File: created.txt\n+created\n*** Update File: old.txt\n*** Move to: moved.txt\n@@\n-before\n+after\n*** End Patch",
                    ),
                  ),
                ).toEqual({
                  type: "text",
                  value: "Success. Updated the following files:\nA created.txt\nM moved.txt",
                })
                expect(yield* exists(source)).toBe(false)
                expect(yield* Effect.promise(() => fs.readFile(path.join(tmp.path, "moved.txt"), "utf8"))).toBe(
                  "after\n",
                )
                expect(yield* Effect.promise(() => fs.readFile(path.join(tmp.path, "created.txt"), "utf8"))).toBe(
                  "created\n",
                )
              }),
            ),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("treats a move to the same canonical path as an update", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        const target = path.join(tmp.path, "same.txt")
        return Effect.promise(() => fs.writeFile(target, "before\n")).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              Effect.gen(function* () {
                expect(
                  yield* executeTool(
                    registry,
                    call(
                      "*** Begin Patch\n*** Update File: same.txt\n*** Move to: ./same.txt\n@@\n-before\n+after\n*** End Patch",
                    ),
                  ),
                ).toEqual({
                  type: "text",
                  value: "Success. Updated the following files:\nM same.txt",
                })
                expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("after\n")
              }),
            ),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("moves a file over an existing destination", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        const source = path.join(tmp.path, "old.txt")
        const destination = path.join(tmp.path, "nested", "moved.txt")
        return Effect.promise(() =>
          Promise.all([
            fs.writeFile(source, "before\n"),
            fs.mkdir(path.dirname(destination), { recursive: true }).then(() => fs.writeFile(destination, "existing\n")),
          ]),
        ).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              Effect.gen(function* () {
                expect(
                  yield* executeTool(
                    registry,
                    call(
                      "*** Begin Patch\n*** Update File: old.txt\n*** Move to: nested/moved.txt\n@@\n-before\n+after\n*** End Patch",
                    ),
                  ),
                ).toMatchObject({ type: "text" })
                expect(yield* exists(source)).toBe(false)
                expect(yield* Effect.promise(() => fs.readFile(destination, "utf8"))).toBe("after\n")
              }),
            ),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("rejects missing, invalid, and empty patches", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return withTool(tmp.path, (registry) =>
          Effect.gen(function* () {
            expect(yield* executeTool(registry, call(""))).toEqual({ type: "error", value: "patchText is required" })
            expect(yield* executeTool(registry, call("invalid patch", "invalid"))).toMatchObject({
              type: "error",
              value: expect.stringContaining("patch verification failed"),
            })
            expect(
              yield* executeTool(registry, call("*** Begin Patch\n*** End Patch", "empty")),
            ).toEqual({ type: "error", value: "patch rejected: empty patch" })
            expect(
              yield* executeTool(
                registry,
                call("*** Begin Patch\n*** Frobnicate File: foo\n*** End Patch", "unknown"),
              ),
            ).toEqual({ type: "error", value: "patch verification failed: no hunks found" })
            expect(yield* executeTool(registry, call("   ", "whitespace"))).toMatchObject({
              type: "error",
              value: expect.stringContaining("patch verification failed"),
            })
          }),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("matches V1 update, BOM, heredoc, and fuzzy matching behavior", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return withTool(tmp.path, (registry) =>
          Effect.gen(function* () {
            const run = (patchText: string, id: string) => executeTool(registry, call(patchText, id))

            yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "multi.txt"), "a\nb\nc\nd\n"))
            expect(
              yield* run(
                "*** Begin Patch\n*** Update File: multi.txt\n@@\n-b\n+B\n@@\n-d\n+D\n*** End Patch",
                "multi",
              ),
            ).toMatchObject({ type: "text" })
            expect(yield* Effect.promise(() => fs.readFile(path.join(tmp.path, "multi.txt"), "utf8"))).toBe(
              "a\nB\nc\nD\n",
            )

            const bom = "\uFEFF"
            yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "bom.txt"), `${bom}first\nsecond\n`))
            const bomResult = yield* settleTool(
              registry,
              call(
                "*** Begin Patch\n*** Update File: bom.txt\n@@\n-second\n+changed\n*** End Patch",
                "bom",
              ),
            )
            const bomOutput = Schema.decodeUnknownSync(PatchTool.Output)(bomResult.output?.structured)
            expect(bomOutput.files[0]?.patch).not.toContain(bom)
            expect(yield* Effect.promise(() => fs.readFile(path.join(tmp.path, "bom.txt"), "utf8"))).toBe(
              `${bom}first\nchanged\n`,
            )

            const bomAddResult = yield* settleTool(
              registry,
              call(`*** Begin Patch\n*** Add File: bom-add.txt\n+${bom}first\n*** End Patch`, "bom-add"),
            )
            const bomAddOutput = Schema.decodeUnknownSync(PatchTool.Output)(bomAddResult.output?.structured)
            expect(bomAddOutput.files[0]?.patch).not.toContain(bom)
            expect(yield* Effect.promise(() => fs.readFile(path.join(tmp.path, "bom-add.txt"), "utf8"))).toBe(
              `${bom}first\n`,
            )

            yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "no-newline.txt"), "old"))
            yield* run(
              "*** Begin Patch\n*** Update File: no-newline.txt\n@@\n-old\n+new\n*** End Patch",
              "no-newline",
            )
            expect(yield* Effect.promise(() => fs.readFile(path.join(tmp.path, "no-newline.txt"), "utf8"))).toBe(
              "new\n",
            )

            yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "context.txt"), "fn a\nx=10\nfn b\nx=10\n"))
            yield* run(
              "*** Begin Patch\n*** Update File: context.txt\n@@ fn b\n-x=10\n+x=11\n*** End Patch",
              "context",
            )
            expect(yield* Effect.promise(() => fs.readFile(path.join(tmp.path, "context.txt"), "utf8"))).toBe(
              "fn a\nx=10\nfn b\nx=11\n",
            )

            yield* run(
              "cat <<'EOF'\n*** Begin Patch\n*** Add File: heredoc.txt\n+with cat\n*** End Patch\nEOF",
              "heredoc-cat",
            )
            yield* run(
              "<<EOF\n*** Begin Patch\n*** Add File: heredoc-plain.txt\n+without cat\n*** End Patch\nEOF",
              "heredoc-plain",
            )
            expect(yield* Effect.promise(() => fs.readFile(path.join(tmp.path, "heredoc.txt"), "utf8"))).toBe(
              "with cat\n",
            )
            expect(yield* Effect.promise(() => fs.readFile(path.join(tmp.path, "heredoc-plain.txt"), "utf8"))).toBe(
              "without cat\n",
            )

            yield* Effect.promise(() =>
              Promise.all([
                fs.writeFile(path.join(tmp.path, "leading.txt"), "  line\n"),
                fs.writeFile(path.join(tmp.path, "trailing.txt"), "line  \n"),
                fs.writeFile(path.join(tmp.path, "unicode.txt"), 'He said “hello”\n'),
              ]),
            )
            yield* run(
              "*** Begin Patch\n*** Update File: leading.txt\n@@\n-line\n+leading\n*** Update File: trailing.txt\n@@\n-line\n+trailing\n*** Update File: unicode.txt\n@@\n-He said \"hello\"\n+He said \"hi\"\n*** End Patch",
              "fuzzy",
            )
            expect(yield* Effect.promise(() => fs.readFile(path.join(tmp.path, "leading.txt"), "utf8"))).toBe(
              "leading\n",
            )
            expect(yield* Effect.promise(() => fs.readFile(path.join(tmp.path, "trailing.txt"), "utf8"))).toBe(
              "trailing\n",
            )
            expect(yield* Effect.promise(() => fs.readFile(path.join(tmp.path, "unicode.txt"), "utf8"))).toBe(
              'He said "hi"\n',
            )

            yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "unchanged.txt"), "line1\nline2\n"))
            expect(
              yield* run(
                "*** Begin Patch\n*** Update File: unchanged.txt\n@@\n-missing\n+changed\n*** End Patch",
                "missing-context",
              ),
            ).toMatchObject({
              type: "error",
              value: expect.stringContaining("Failed to find expected lines"),
            })
            expect(yield* Effect.promise(() => fs.readFile(path.join(tmp.path, "unchanged.txt"), "utf8"))).toBe(
              "line1\nline2\n",
            )
            expect(
              yield* run(
                "*** Begin Patch\n*** Update File: missing.txt\n@@\n-old\n+new\n*** End Patch",
                "missing-update",
              ),
            ).toMatchObject({ type: "error" })
            expect(
              yield* run("*** Begin Patch\n*** Delete File: missing.txt\n*** End Patch", "missing-delete"),
            ).toMatchObject({ type: "error" })
          }),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("approves an external directory and the batch before reading external update content", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      ([active, outside]) => {
        reset()
        const target = path.join(outside.path, "external.txt")
        return Effect.promise(() => fs.writeFile(target, "before\n")).pipe(
          Effect.andThen(
            withTool(active.path, (registry) =>
              Effect.gen(function* () {
                expect(
                  yield* executeTool(
                    registry,
                    call(`*** Begin Patch\n*** Update File: ${target}\n@@\n-before\n+after\n*** End Patch`),
                  ),
                ).toMatchObject({ type: "text" })
                expect(assertions.map((input) => input.action)).toEqual(["external_directory", "edit"])
                expect(readsBeforeEditApproval).toBe(0)
                expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("after\n")
              }),
            ),
          ),
        )
      },
      ([active, outside]) =>
        Effect.promise(() =>
          Promise.all([active[Symbol.asyncDispose](), outside[Symbol.asyncDispose]()]).then(() => undefined),
        ),
    ),
  )

  it.live("approves a relative external target before reading update content", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      ([active, outside]) => {
        reset()
        const target = path.join(outside.path, "external.txt")
        const relative = path.relative(active.path, target)
        return Effect.promise(() => fs.writeFile(target, "before\n")).pipe(
          Effect.andThen(
            withTool(active.path, (registry) =>
              Effect.gen(function* () {
                expect(
                  yield* executeTool(
                    registry,
                    call(`*** Begin Patch\n*** Update File: ${relative}\n@@\n-before\n+after\n*** End Patch`),
                  ),
                ).toMatchObject({ type: "text" })
                expect(assertions.map((input) => input.action)).toEqual(["external_directory", "edit"])
                expect(readsBeforeEditApproval).toBe(0)
                expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("after\n")
              }),
            ),
          ),
        )
      },
      ([active, outside]) =>
        Effect.promise(() =>
          Promise.all([active[Symbol.asyncDispose](), outside[Symbol.asyncDispose]()]).then(() => undefined),
        ),
    ),
  )

  it.live("approves one external directory scope for multiple files under the same parent", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      ([active, outside]) => {
        reset()
        const first = path.join(outside.path, "first.txt")
        const second = path.join(outside.path, "second.txt")
        return Effect.promise(() =>
          Promise.all([fs.writeFile(first, "before\n"), fs.writeFile(second, "before\n")]),
        ).pipe(
          Effect.andThen(
            withTool(active.path, (registry) =>
              Effect.gen(function* () {
                expect(
                  yield* executeTool(
                    registry,
                    call(
                      `*** Begin Patch\n*** Update File: ${first}\n@@\n-before\n+after\n*** Update File: ${second}\n@@\n-before\n+after\n*** End Patch`,
                    ),
                  ),
                ).toMatchObject({ type: "text" })
                expect(assertions.map((input) => input.action)).toEqual(["external_directory", "edit"])
                expect(assertions[0]?.resources).toEqual([
                  path.join(yield* Effect.promise(() => fs.realpath(outside.path)), "*").replaceAll("\\", "/"),
                ])
              }),
            ),
          ),
        )
      },
      ([active, outside]) =>
        Effect.promise(() =>
          Promise.all([active[Symbol.asyncDispose](), outside[Symbol.asyncDispose]()]).then(() => undefined),
        ),
    ),
  )

  it.live("rejects invalid later update before applying an earlier add", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return withTool(tmp.path, (registry) =>
          Effect.gen(function* () {
            expect(
              yield* executeTool(
                registry,
                call(
                  "*** Begin Patch\n*** Add File: created.txt\n+created\n*** Update File: missing.txt\n@@\n-before\n+after\n*** End Patch",
                ),
              ),
            ).toEqual({ type: "error", value: "Unable to apply patch at missing.txt" })
            expect(yield* exists(path.join(tmp.path, "created.txt"))).toBe(false)
          }),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("adds files by overwriting existing targets", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        const target = path.join(tmp.path, "existing.txt")
        return Effect.promise(() => fs.writeFile(target, "sentinel\n")).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              Effect.gen(function* () {
                expect(
                  yield* executeTool(
                    registry,
                    call("*** Begin Patch\n*** Add File: existing.txt\n+replacement\n*** End Patch"),
                  ),
                ).toMatchObject({ type: "text" })
                expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("replacement\n")
              }),
            ),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("overwrites an add target that appears during permission approval", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        const target = path.join(tmp.path, "appeared.txt")
        afterEditApproval = () => Effect.promise(() => fs.writeFile(target, "winner\n")).pipe(Effect.orDie)
        return withTool(tmp.path, (registry) =>
          Effect.gen(function* () {
            expect(
              yield* executeTool(
                registry,
                call("*** Begin Patch\n*** Add File: appeared.txt\n+replacement\n*** End Patch"),
              ),
            ).toMatchObject({ type: "text" })
            expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("replacement\n")
          }),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("preserves a later commit defect after earlier sequential applications", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        const first = path.join(tmp.path, "first.txt")
        const second = path.join(tmp.path, "second.txt")
        failRemoveTarget = path.basename(second)
        return Effect.promise(() => Promise.all([fs.writeFile(first, "first"), fs.writeFile(second, "second")])).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              Effect.gen(function* () {
                expect(
                  Exit.isFailure(
                    yield* executeTool(
                      registry,
                      call("*** Begin Patch\n*** Delete File: first.txt\n*** Delete File: second.txt\n*** End Patch"),
                    ).pipe(Effect.exit),
                  ),
                ).toBe(true)
                expect(yield* exists(first)).toBe(false)
                expect(yield* exists(second)).toBe(true)
              }),
            ),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("finishes the sequential commit phase when interrupted after the first mutation", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        const first = path.join(tmp.path, "first.txt")
        const second = path.join(tmp.path, "second.txt")
        blockRemoveTarget = path.basename(second)
        return Effect.gen(function* () {
          removeStarted = yield* Deferred.make<void>()
          releaseRemove = yield* Deferred.make<void>()
          yield* Effect.promise(() => Promise.all([fs.writeFile(first, "first"), fs.writeFile(second, "second")]))
          yield* withTool(tmp.path, (registry) =>
            Effect.gen(function* () {
              const run = yield* executeTool(
                registry,
                call("*** Begin Patch\n*** Delete File: first.txt\n*** Delete File: second.txt\n*** End Patch"),
              ).pipe(Effect.forkChild)
              yield* Deferred.await(removeStarted!)
              const interrupt = yield* Fiber.interrupt(run).pipe(Effect.forkChild)
              yield* Deferred.succeed(releaseRemove!, undefined)
              yield* Fiber.join(interrupt)
              expect(yield* exists(first)).toBe(false)
              expect(yield* exists(second)).toBe(false)
            }),
          )
        })
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
})
