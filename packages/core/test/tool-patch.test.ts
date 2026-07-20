import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Exit, Layer, Schema } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
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
  deps: [ToolRegistry.toolsNode, FSUtil.node, Location.node, PermissionV2.node],
})

const sessionID = SessionV2.ID.make("ses_patch_tool_test")
const assertions: PermissionV2.AssertInput[] = []
let denyAction: string | undefined
let failRemoveTarget: string | undefined
let readsBeforeEditApproval = 0
let editApproved = false
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
        return fs.remove(target, options)
      },
    })
  }),
).pipe(Layer.provide(LayerNode.compile(FSUtil.node)))

const withTool = <A, E, R>(
  directory: string,
  body: (registry: ToolRegistry.Interface) => Effect.Effect<A, E, R>,
  projectDirectory = directory,
) => {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of(
      location(
        { directory: AbsolutePath.make(directory) },
        { projectDirectory: AbsolutePath.make(projectDirectory) },
      ),
    ),
  )
  return Effect.gen(function* () {
    return yield* body(yield* ToolRegistry.Service)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(
        LayerNode.group([
          ToolRegistry.node,
          ToolRegistry.toolsNode,
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
const withTempTool = <A, E, R>(body: (directory: string, registry: ToolRegistry.Interface) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => {
      reset()
      return withTool(tmp.path, (registry) => body(tmp.path, registry))
    },
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

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
                if (process.platform === "win32") expect(settled.result.value).not.toContain("\\")
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
                      deletions: 2,
                      patch: expect.stringContaining("-remove"),
                    },
                  ],
                })
                expect(assertions).toMatchObject([
                  {
                    sessionID,
                    action: "edit",
                    resources: ["nested/new.txt", "update.txt", "remove.txt"],
                    save: ["*"],
                    metadata: {
                      filepath: "nested/new.txt, update.txt, remove.txt",
                      diff: expect.stringContaining("Index:"),
                      files: expect.any(Array),
                    },
                  },
                ])
                expect(readsBeforeEditApproval).toBe(2)
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

  it.live("moves a symlink without deleting its target", () =>
    withTempTool((directory, registry) =>
      Effect.gen(function* () {
        if (process.platform === "win32") return
        const target = path.join(directory, "target.txt")
        const source = path.join(directory, "link.txt")
        const moved = path.join(directory, "moved.txt")
        yield* Effect.promise(() => fs.writeFile(target, "before\n"))
        yield* Effect.promise(() => fs.symlink(target, source))
        yield* executeTool(
          registry,
          call(
            "*** Begin Patch\n*** Update File: link.txt\n*** Move to: moved.txt\n@@\n-before\n+after\n*** End Patch",
          ),
        )
        expect(yield* exists(source)).toBe(false)
        expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("before\n")
        expect(yield* Effect.promise(() => fs.readFile(moved, "utf8"))).toBe("after\n")
      }),
    ),
  )

  it.live("includes move file info in structured output", () =>
    withTempTool((directory, registry) =>
      Effect.gen(function* () {
        const source = path.join(directory, "old", "name.txt")
        yield* Effect.promise(() => fs.mkdir(path.dirname(source), { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(source, "old content\n"))
        const settled = yield* settleTool(
          registry,
          call(
            "*** Begin Patch\n*** Update File: old/name.txt\n*** Move to: renamed/dir/name.txt\n@@\n-old content\n+new content\n*** End Patch",
          ),
        )
        expect(settled.output?.structured).toMatchObject({
          applied: [{ type: "update", resource: "renamed/dir/name.txt" }],
          files: [
            {
              file: "renamed/dir/name.txt",
              status: "modified",
              patch: expect.stringContaining("-old content\n+new content"),
            },
          ],
        })
      }),
    ),
  )

  it.live("inserts lines with an insert-only hunk", () =>
    withTempTool((directory, registry) =>
      Effect.gen(function* () {
        const target = path.join(directory, "insert-only.txt")
        yield* Effect.promise(() => fs.writeFile(target, "alpha\nomega\n"))
        yield* executeTool(
          registry,
          call("*** Begin Patch\n*** Update File: insert-only.txt\n@@\n alpha\n+beta\n omega\n*** End Patch"),
        )
        expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("alpha\nbeta\nomega\n")
      }),
    ),
  )

  it.live("updates an empty file", () =>
    withTempTool((directory, registry) =>
      Effect.gen(function* () {
        const target = path.join(directory, "empty.txt")
        yield* Effect.promise(() => fs.writeFile(target, ""))
        yield* executeTool(registry, call("*** Begin Patch\n*** Update File: empty.txt\n@@\n+First line\n*** End Patch"))
        expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("First line\n")
      }),
    ),
  )

  it.live("rejects deleting a directory", () =>
    withTempTool((directory, registry) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.mkdir(path.join(directory, "dir")))
        expect(
          yield* executeTool(registry, call("*** Begin Patch\n*** Delete File: dir\n*** End Patch")),
        ).toMatchObject({ type: "error" })
        expect(yield* exists(path.join(directory, "dir"))).toBe(true)
      }),
    ),
  )

  it.live("supports an end-of-file anchor", () =>
    withTempTool((directory, registry) =>
      Effect.gen(function* () {
        const target = path.join(directory, "tail.txt")
        yield* Effect.promise(() => fs.writeFile(target, "alpha\nlast\n"))
        yield* executeTool(
          registry,
          call(
            "*** Begin Patch\n*** Update File: tail.txt\n@@\n-last\n+end\n*** End of File\n*** End Patch",
          ),
        )
        expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("alpha\nend\n")
      }),
    ),
  )

  it.live("rejects a missing second chunk context", () =>
    withTempTool((directory, registry) =>
      Effect.gen(function* () {
        const target = path.join(directory, "two-chunks.txt")
        yield* Effect.promise(() => fs.writeFile(target, "a\nb\nc\nd\n"))
        expect(
          yield* executeTool(
            registry,
            call(
              "*** Begin Patch\n*** Update File: two-chunks.txt\n@@\n-b\n+B\n\n-d\n+D\n*** End Patch",
            ),
          ),
        ).toMatchObject({ type: "error" })
        expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("a\nb\nc\nd\n")
      }),
    ),
  )

  it.live("requires patchText", () =>
    withTempTool((_directory, registry) =>
      Effect.gen(function* () {
        expect(yield* executeTool(registry, call(""))).toEqual({ type: "error", value: "patchText is required" })
      }),
    ),
  )

  it.live("rejects invalid patch format", () =>
    withTempTool((_directory, registry) =>
      Effect.gen(function* () {
        expect(yield* executeTool(registry, call("invalid patch"))).toMatchObject({
          type: "error",
          value: expect.stringContaining("patch verification failed"),
        })
      }),
    ),
  )

  it.live("rejects an empty patch", () =>
    withTempTool((_directory, registry) =>
      Effect.gen(function* () {
        expect(yield* executeTool(registry, call("*** Begin Patch\n*** End Patch"))).toEqual({
          type: "error",
          value: "patch rejected: empty patch",
        })
      }),
    ),
  )

  it.live("rejects an invalid hunk header", () =>
    withTempTool((_directory, registry) =>
      Effect.gen(function* () {
        expect(
          yield* executeTool(
            registry,
            call("*** Begin Patch\n*** Frobnicate File: foo\n*** End Patch"),
          ),
        ).toEqual({ type: "error", value: "patch verification failed: no hunks found" })
      }),
    ),
  )

  it.live("applies multiple hunks to one file", () =>
    withTempTool((directory, registry) =>
      Effect.gen(function* () {
        const target = path.join(directory, "multi.txt")
        yield* Effect.promise(() => fs.writeFile(target, "a\nb\nc\nd\n"))
        yield* executeTool(
          registry,
          call("*** Begin Patch\n*** Update File: multi.txt\n@@\n-b\n+B\n@@\n-d\n+D\n*** End Patch"),
        )
        expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("a\nB\nc\nD\n")
      }),
    ),
  )

  it.live("does not invent a first-line diff for BOM files", () =>
    withTempTool((directory, registry) =>
      Effect.gen(function* () {
        const bom = "\uFEFF"
        const target = path.join(directory, "example.cs")
        yield* Effect.promise(() => fs.writeFile(target, `${bom}using System;\n\nclass Test {}\n`))
        const settled = yield* settleTool(
          registry,
          call(
            "*** Begin Patch\n*** Update File: example.cs\n@@\n class Test {}\n+class Next {}\n*** End Patch",
          ),
        )
        const output = Schema.decodeUnknownSync(PatchTool.Output)(settled.output?.structured)
        expect(output.files[0]?.patch).not.toContain(bom)
        expect(output.files[0]?.patch).not.toContain("-using System;")
        expect(output.files[0]?.patch).not.toContain("+using System;")
        expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe(
          `${bom}using System;\n\nclass Test {}\nclass Next {}\n`,
        )
      }),
    ),
  )

  it.live("appends a trailing newline on update", () =>
    withTempTool((directory, registry) =>
      Effect.gen(function* () {
        const target = path.join(directory, "no-newline.txt")
        yield* Effect.promise(() => fs.writeFile(target, "no newline at end"))
        yield* executeTool(
          registry,
          call(
            "*** Begin Patch\n*** Update File: no-newline.txt\n@@\n-no newline at end\n+first line\n+second line\n*** End Patch",
          ),
        )
        expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("first line\nsecond line\n")
      }),
    ),
  )

  it.live("disambiguates change context with an @@ header", () =>
    withTempTool((directory, registry) =>
      Effect.gen(function* () {
        const target = path.join(directory, "context.txt")
        yield* Effect.promise(() => fs.writeFile(target, "fn a\nx=10\ny=2\nfn b\nx=10\ny=20\n"))
        yield* executeTool(
          registry,
          call("*** Begin Patch\n*** Update File: context.txt\n@@ fn b\n-x=10\n+x=11\n*** End Patch"),
        )
        expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe(
          "fn a\nx=10\ny=2\nfn b\nx=11\ny=20\n",
        )
      }),
    ),
  )

  it.live("parses a heredoc-wrapped patch", () =>
    withTempTool((directory, registry) =>
      Effect.gen(function* () {
        yield* executeTool(
          registry,
          call("cat <<'EOF'\n*** Begin Patch\n*** Add File: heredoc.txt\n+with cat\n*** End Patch\nEOF"),
        )
        expect(yield* Effect.promise(() => fs.readFile(path.join(directory, "heredoc.txt"), "utf8"))).toBe(
          "with cat\n",
        )
      }),
    ),
  )

  it.live("parses a heredoc-wrapped patch without cat", () =>
    withTempTool((directory, registry) =>
      Effect.gen(function* () {
        yield* executeTool(
          registry,
          call("<<EOF\n*** Begin Patch\n*** Add File: heredoc.txt\n+without cat\n*** End Patch\nEOF"),
        )
        expect(yield* Effect.promise(() => fs.readFile(path.join(directory, "heredoc.txt"), "utf8"))).toBe(
          "without cat\n",
        )
      }),
    ),
  )

  it.live("matches with trailing whitespace differences", () =>
    withTempTool((directory, registry) =>
      Effect.gen(function* () {
        const target = path.join(directory, "trailing.txt")
        yield* Effect.promise(() => fs.writeFile(target, "line1  \nline2\nline3   \n"))
        yield* executeTool(
          registry,
          call("*** Begin Patch\n*** Update File: trailing.txt\n@@\n-line2\n+changed\n*** End Patch"),
        )
        expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("line1  \nchanged\nline3   \n")
      }),
    ),
  )

  it.live("matches with leading whitespace differences", () =>
    withTempTool((directory, registry) =>
      Effect.gen(function* () {
        const target = path.join(directory, "leading.txt")
        yield* Effect.promise(() => fs.writeFile(target, "  line1\nline2\n  line3\n"))
        yield* executeTool(
          registry,
          call("*** Begin Patch\n*** Update File: leading.txt\n@@\n-line2\n+changed\n*** End Patch"),
        )
        expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("  line1\nchanged\n  line3\n")
      }),
    ),
  )

  it.live("matches with Unicode punctuation differences", () =>
    withTempTool((directory, registry) =>
      Effect.gen(function* () {
        const target = path.join(directory, "unicode.txt")
        yield* Effect.promise(() => fs.writeFile(target, "He said “hello”\nsome—dash\nend\n"))
        yield* executeTool(
          registry,
          call(
            '*** Begin Patch\n*** Update File: unicode.txt\n@@\n-He said "hello"\n+He said "hi"\n*** End Patch',
          ),
        )
        expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe('He said "hi"\nsome—dash\nend\n')
      }),
    ),
  )

  it.live("rejects an update with missing context", () =>
    withTempTool((directory, registry) =>
      Effect.gen(function* () {
        const target = path.join(directory, "unchanged.txt")
        yield* Effect.promise(() => fs.writeFile(target, "line1\nline2\n"))
        expect(
          yield* executeTool(
            registry,
            call("*** Begin Patch\n*** Update File: unchanged.txt\n@@\n-missing\n+changed\n*** End Patch"),
          ),
        ).toMatchObject({ type: "error", value: expect.stringContaining("Failed to find expected lines") })
        expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("line1\nline2\n")
      }),
    ),
  )

  it.live("rejects an update when the target file is missing", () =>
    withTempTool((_directory, registry) =>
      Effect.gen(function* () {
        expect(
          yield* executeTool(
            registry,
            call("*** Begin Patch\n*** Update File: missing.txt\n@@\n-old\n+new\n*** End Patch"),
          ),
        ).toMatchObject({
          type: "error",
          value: expect.stringContaining("patch verification failed: Failed to read file to update"),
        })
      }),
    ),
  )

  it.live("rejects a delete when the target file is missing", () =>
    withTempTool((_directory, registry) =>
      Effect.gen(function* () {
        expect(
          yield* executeTool(registry, call("*** Begin Patch\n*** Delete File: missing.txt\n*** End Patch")),
        ).toMatchObject({ type: "error", value: expect.stringContaining("patch verification failed") })
      }),
    ),
  )

  it.live("approves an external directory before reading and requests edit permission afterward", () =>
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
                expect(readsBeforeEditApproval).toBe(1)
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

  it.live("does not inspect an external file when external permission is denied", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      ([active, outside]) => {
        reset()
        denyAction = "external_directory"
        const target = path.join(outside.path, "external.txt")
        return Effect.promise(() => fs.writeFile(target, "before\n")).pipe(
          Effect.andThen(
            withTool(
              active.path,
              (registry) =>
                Effect.gen(function* () {
                  expect(
                    yield* executeTool(
                      registry,
                      call(`*** Begin Patch\n*** Update File: ${target}\n@@\n-before\n+after\n*** End Patch`),
                    ),
                  ).toMatchObject({ type: "error" })
                  expect(assertions.map((input) => input.action)).toEqual(["external_directory"])
                  expect(readsBeforeEditApproval).toBe(0)
                  expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("before\n")
                }),
              path.parse(active.path).root,
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

  it.live("treats a sibling path inside the project worktree as internal", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        const active = path.join(tmp.path, "active")
        const target = path.join(tmp.path, "sibling.txt")
        return Effect.promise(() => Promise.all([fs.mkdir(active), fs.writeFile(target, "before\n")])).pipe(
          Effect.andThen(
            withTool(
              active,
              (registry) =>
                Effect.gen(function* () {
                  expect(
                    yield* executeTool(
                      registry,
                      call("*** Begin Patch\n*** Update File: ../sibling.txt\n@@\n-before\n+after\n*** End Patch"),
                    ),
                  ).toMatchObject({ type: "text" })
                  expect(assertions.map((input) => input.action)).toEqual(["edit"])
                  expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("after\n")
                }),
              tmp.path,
            ),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("follows an internal symlink to an external file without external permission", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      ([active, outside]) => {
        reset()
        if (process.platform === "win32") return Effect.void
        const target = path.join(outside.path, "external.txt")
        const link = path.join(active.path, "link.txt")
        return Effect.promise(() => fs.writeFile(target, "before\n")).pipe(
          Effect.andThen(Effect.promise(() => fs.symlink(target, link))),
          Effect.andThen(
            withTool(active.path, (registry) =>
              Effect.gen(function* () {
                expect(
                  yield* executeTool(
                    registry,
                    call("*** Begin Patch\n*** Update File: link.txt\n@@\n-before\n+after\n*** End Patch"),
                  ),
                ).toMatchObject({ type: "text" })
                expect(assertions.map((input) => input.action)).toEqual(["edit"])
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

  it.live("approves a relative external target before reading and requests edit permission afterward", () =>
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
                expect(readsBeforeEditApproval).toBe(1)
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

  it.live("approves each external file under the same parent", () =>
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
                expect(assertions.map((input) => input.action)).toEqual([
                  "external_directory",
                  "external_directory",
                  "edit",
                ])
                expect(assertions[0]?.resources).toEqual([
                  process.platform === "win32"
                    ? FSUtil.normalizePathPattern(path.join(outside.path, "*"))
                    : path.join(yield* Effect.promise(() => fs.realpath(outside.path)), "*").replaceAll("\\", "/"),
                ])
                expect(assertions[1]?.resources).toEqual(assertions[0]?.resources)
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
            ).toMatchObject({
              type: "error",
              value: expect.stringContaining("patch verification failed: Failed to read file to update"),
            })
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

})
