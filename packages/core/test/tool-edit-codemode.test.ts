import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Config } from "@opencode/core/config"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Environment } from "@opencode/core/environment/index"
import { FileAccess } from "@opencode/core/file-access"
import { FileMutation } from "@opencode/core/file-mutation"
import { FileWrite } from "@opencode/core/file-write"
import { Flag } from "@opencode/core/flag"
import { Formatter } from "@opencode/core/formatter"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { EditTool } from "@opencode/core/tool/plugin/edit"
import { PatchTool } from "@opencode/core/tool/plugin/patch"
import { WriteTool } from "@opencode/core/tool/plugin/write"
import { Document, Info } from "@opencode/schema/config"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { location } from "./fixture/location"
import { withTempDir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { codeModeListings, executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const editingTools = makeLocationNode({
  name: "test/editing-tools-codemode",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      yield* registerToolPlugin(WriteTool.Plugin)
      yield* registerToolPlugin(EditTool.Plugin)
      yield* registerToolPlugin(PatchTool.Plugin)
    }),
  ),
  deps: [
    Tool.node,
    FileWrite.node,
    FileMutation.node,
    FileAccess.node,
    Environment.node,
    Formatter.node,
    Location.node,
    Permission.node,
    Config.node,
    Flag.node,
  ],
})

const withTools = <A, E, R>(
  directory: string,
  enabled: boolean,
  body: (registry: Tool.Interface) => Effect.Effect<A, E, R>,
  permission = permissionLayer({ assert: () => Effect.void }),
) =>
  Effect.gen(function* () {
    const registry = yield* Tool.Service
    return yield* body(registry)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(LayerNode.group([editingTools, Tool.node]), [
        Config.node.replace(
          Config.testLayer([
            new Document({ type: "document", info: new Info({ experimental: { full_codemode: enabled } }) }),
          ]),
        ),
        Location.node.replace(
          Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
        ),
        Formatter.node.replace(Layer.mock(Formatter.Service, { file: () => Effect.succeed(false) })),
        Permission.node.replace(permission),
      ]),
    ),
  )

const sessionID = Session.ID.make("ses_edit_codemode_test")
const execute = (registry: Tool.Interface, code: string) =>
  executeTool(registry, {
    sessionID,
    ...toolIdentity,
    call: { type: "tool-call", id: "call-edit-code-mode", name: "execute", input: { code } },
  })
const it = testEffect(Layer.empty)

describe("editing tools in Code Mode", () => {
  it.live("keeps editing tools native with full_codemode off", () =>
    withTempDir((tmp) =>
      withTools(tmp.path, false, (registry) =>
        Effect.gen(function* () {
          const snapshot = yield* registry.snapshot()
          expect(snapshot.definitions.map((tool) => tool.name)).toEqual(["edit", "patch", "write", "execute"])
          expect(snapshot.definitions.find((tool) => tool.name === "patch")?.freeform).toMatchObject({
            type: "lark",
          })
          expect(codeModeListings(snapshot.codeModeCatalog!)).toEqual([])
        }),
      ),
    ),
  )

  it.live("exposes and executes all three editing tools inside execute with full_codemode on", () =>
    withTempDir((tmp) =>
      withTools(tmp.path, true, (registry) =>
        Effect.gen(function* () {
          const snapshot = yield* registry.snapshot()
          expect(snapshot.definitions.map((tool) => tool.name)).toEqual(["execute"])
          expect(codeModeListings(snapshot.codeModeCatalog!).map((tool) => tool.path).sort()).toEqual([
            "edit",
            "patch",
            "write",
          ])
          expect((yield* registry.list()).map((tool) => tool.options?.permission)).toEqual([
            "edit",
            "edit",
            "edit",
          ])

          const result = yield* execute(
            registry,
            [
              'const written = await tools.write({path: "example.txt", content: "before\\n"});',
              'const edited = await tools.edit({path: "example.txt", oldString: "before", newString: "middle"});',
              `const patched = await tools.patch({patchText: ${JSON.stringify(
                "*** Begin Patch\n*** Update File: example.txt\n@@\n-middle\n+after\n*** End Patch\n",
              )}});`,
              "return {written, edited, patched};",
            ].join("\n"),
          )
          expect(result).toMatchObject({
            status: "completed",
            output: {
              output: JSON.stringify({
                written: "Created file successfully: example.txt",
                edited: "Edited example.txt (1 replacement)",
                patched: {},
              }),
            },
          })
          expect(yield* Effect.promise(() => fs.readFile(path.join(tmp.path, "example.txt"), "utf8"))).toBe(
            "after\n",
          )
        }),
      ),
    ),
  )

  it.live("keeps the shared edit permission filter in Code Mode", () =>
    withTempDir((tmp) =>
      withTools(tmp.path, true, (registry) =>
        Effect.gen(function* () {
          const snapshot = yield* registry.snapshot([{ action: "edit", resource: "*", effect: "deny" }])
          expect(snapshot.definitions.map((tool) => tool.name)).toEqual(["execute"])
          expect(codeModeListings(snapshot.codeModeCatalog!)).toEqual([])
        }),
      ),
    ),
  )

  it.live("does not bypass edit approval when an editing tool runs inside execute", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const assertions: Permission.AssertInput[] = []
        yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "example.txt"), "before\n"))
        yield* withTools(
          tmp.path,
          true,
          (registry) =>
            Effect.gen(function* () {
              for (const code of [
                'return await tools.write({path: "example.txt", content: "after\\n"});',
                'return await tools.edit({path: "example.txt", oldString: "before", newString: "after"});',
                `return await tools.patch({patchText: ${JSON.stringify(
                  "*** Begin Patch\n*** Update File: example.txt\n@@\n-before\n+after\n*** End Patch\n",
                )}});`,
              ]) {
                expect(yield* execute(registry, code)).toMatchObject({
                  status: "completed",
                  output: { error: true },
                })
                expect(yield* Effect.promise(() => fs.readFile(path.join(tmp.path, "example.txt"), "utf8"))).toBe(
                  "before\n",
                )
              }
            }),
          permissionLayer({
            assert: (input) =>
              Effect.sync(() => assertions.push(input)).pipe(
                Effect.andThen(
                  input.action === "edit"
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
          }),
        )
        expect(assertions).toMatchObject([
          { sessionID, action: "edit", resources: ["example.txt"] },
          { sessionID, action: "edit", resources: ["example.txt"] },
          { sessionID, action: "edit", resources: ["example.txt"] },
        ])
      }),
    ),
  )
})
