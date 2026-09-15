import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { NotebookTools } from "@opencode-ai/core/notebook/tools"
import { NotebookEvidence } from "@opencode-ai/core/notebook/evidence"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { toolIdentity, settleTool, toolDefinitions } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_notebook_tools_test")

const asserts: PermissionV2.AssertInput[] = []

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) => Effect.sync(() => asserts.push(input)),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const withTools = <A, E>(project: string, body: (registry: ToolRegistry.Interface) => Effect.Effect<A, E>): Effect.Effect<A, E> => {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of(
      location({ directory: AbsolutePath.make(project) }, { projectDirectory: AbsolutePath.make(project) }),
    ),
  )
  return Effect.gen(function* () {
    return yield* body(yield* ToolRegistry.Service)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(
        LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, NotebookTools.node]),
        [
          [Location.node, activeLocation],
          [PermissionV2.node, permission],
          [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
        ],
      ),
    ),
  )
}

const getCall = (input: Record<string, unknown>, id = "call-get"): ToolRegistry.ExecuteInput => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: "notes_get", input },
})

const commitCall = (input: Record<string, unknown>, id = "call-commit"): ToolRegistry.ExecuteInput => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: "notes_commit", input },
})

const inTemp = <A, E>(body: (tmp: Awaited<ReturnType<typeof tmpdir>>) => Effect.Effect<A, E>): Effect.Effect<A, E> =>
  Effect.acquireUseRelease(
    Effect.promise(() => tmpdir()),
    body,
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

const textValue = (result: { type: string; value: unknown }) =>
  result.type === "text" && typeof result.value === "string" ? result.value : ""

const it = testEffect(Layer.empty)

describe("NotebookTools", () => {
  it.live("registers notes_get and notes_commit", () =>
    inTemp((tmp) =>
      withTools(tmp.path, (registry) =>
        toolDefinitions(registry).pipe(Effect.map((defs) => defs.map((def) => def.name).sort())),
      ).pipe(
        Effect.map((names) => expect(names).toEqual(["notes_commit", "notes_get"])),
      ),
    ),
  )

  it.live("notes_get recalls ancestor-chain memory for a path", () =>
    inTemp((tmp) =>
      Effect.gen(function* () {
        const src = path.join(tmp.path, "src")
        yield* Effect.promise(() => fs.mkdir(src, { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(path.join(src, "lib.ts"), "export const util = 1\n"))
        yield* Effect.promise(() =>
          fs.writeFile(
            path.join(tmp.path, ".note.yaml"),
            "version: 1\nupdated: ''\nsummary: Project root bundles everything.\n",
          ),
        )
        yield* Effect.promise(() =>
          fs.writeFile(
            path.join(src, ".note.yaml"),
            "version: 1\nupdated: ''\nsummary: Core library lives here.\nentries:\n  lib.ts:\n    summary: Provides the util helper.\n    based_on:\n      - 'src/lib.ts@2-1'\n",
          ),
        )

        const settled = yield* withTools(tmp.path, (registry) => settleTool(registry, getCall({ path: "src/lib.ts" })))
        const value = textValue(settled.result)
        expect(value).toContain("Project root bundles everything.")
        expect(value).toContain("Core library lives here.")
        expect(value).toContain("Provides the util helper.")
      }),
    ),
  )

  it.live("notes_get keyword-searches across notebooks", () =>
    inTemp((tmp) =>
      Effect.gen(function* () {
        const src = path.join(tmp.path, "src")
        yield* Effect.promise(() => fs.mkdir(src, { recursive: true }))
        yield* Effect.promise(() =>
          fs.writeFile(
            path.join(src, ".note.yaml"),
            "version: 1\nupdated: ''\nentries:\n  login.ts:\n    summary: authenticates users with tokens\n",
          ),
        )
        const settled = yield* withTools(tmp.path, (registry) =>
          settleTool(registry, getCall({ task: "users tokens" })),
        )
        expect(textValue(settled.result)).toContain("authenticates users with tokens")
      }),
    ),
  )

    it.live("notes_commit asks to write and persists an entry", () =>
    inTemp((tmp) =>
      Effect.gen(function* () {
        const src = path.join(tmp.path, "src")
        yield* Effect.promise(() => fs.mkdir(src, { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(path.join(src, "lib.ts"), "export const util = 1\n"))
        NotebookEvidence.markExplore(sessionID)

        const settled = yield* withTools(tmp.path, (registry) =>
          settleTool(
            registry,
            commitCall({
              task: "learn-lib",
              entries: [
                {
                  path: "src/lib.ts",
                  summary:
                    "The util module exposes a single exported constant `util` that other modules import for the shared helper value.",
                  based_on: ["src/lib.ts"],
                },
              ],
            }),
          ),
        )
        const value = textValue(settled.result)
        expect(value).toContain("src/.note.yaml")
        expect(value).toContain("entry lib.ts added")

        const target = path.join(src, ".note.yaml")
        expect(asserts.some((a) => a.action === "write-notes" && a.resources.includes(target))).toBe(true)
        const written = yield* Effect.promise(() => fs.readFile(target, "utf8"))
        expect(written).toContain("single exported constant")

        const again = yield* withTools(tmp.path, (registry) => settleTool(registry, getCall({ path: "src/lib.ts" })))
        expect(textValue(again.result)).toContain("single exported constant")
      }),
    ),
  )

  it.live("notes_commit rejects a vague summary that names no concrete symbols", () =>
    inTemp((tmp) =>
      Effect.gen(function* () {
        const src = path.join(tmp.path, "src")
        yield* Effect.promise(() => fs.mkdir(src, { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(path.join(src, "lib.ts"), "export const util = 1\n"))
        NotebookEvidence.markExplore(sessionID)

        const settled = yield* withTools(tmp.path, (registry) =>
          settleTool(
            registry,
            commitCall({
              task: "vague",
              entries: [
                { path: "src/lib.ts", summary: "Handles files and manages things in a nice and friendly way that is helpful.", based_on: ["src/lib.ts"] },

              ],
            }),
          ),
        )
        const value = textValue(settled.result)
        expect(value).toContain("NOT applied")
        expect(value).toContain("vague")
      }),
    ),
  )
})
