import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Context, Effect, Layer } from "effect"
import type { ChildProcess } from "effect/process"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Config } from "@opencode/core/config"
import { Environment } from "@opencode/core/environment/index"
import { FileAccess } from "@opencode/core/file-access"
import { Flag } from "@opencode/core/flag"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { Ripgrep } from "@opencode/core/ripgrep"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { GlobTool } from "@opencode/core/tool/plugin/glob"
import { GrepTool } from "@opencode/core/tool/plugin/grep"
import { recordingEnvironmentLayer } from "./fixture/environment"
import { elsewhere } from "./fixture/target-environment"
import { withTempDir } from "./fixture/tmpdir"
import { it } from "./lib/effect"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const searchToolsNode = makeLocationNode({
  name: "test/search-target-environment-plugins",
  layer: Layer.effectDiscard(Effect.all([registerToolPlugin(GlobTool.Plugin), registerToolPlugin(GrepTool.Plugin)])),
  deps: [
    Config.node,
    Environment.node,
    FileAccess.node,
    Flag.node,
    Location.node,
    Permission.node,
    Ripgrep.node,
    Tool.node,
  ],
})

const sessionID = Session.ID.make("ses_search_target_environment_test")

describe("search tools", () => {
  it.live("check and search the resolved target's environment, not the session's", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "notes.txt"), "needle\n"))
        const targetSpawns: ChildProcess.Command[] = []
        const sessionSpawns: ChildProcess.Command[] = []
        const target = yield* Layer.build(recordingEnvironmentLayer(targetSpawns))
        const session = yield* Layer.build(recordingEnvironmentLayer(sessionSpawns))
        const other = elsewhere(tmp.path, Context.get(target, Environment.Service))
        const execute = (registry: Tool.Interface, name: string, input: unknown) =>
          executeTool(registry, {
            sessionID,
            ...toolIdentity,
            call: { type: "tool-call", id: `call-${name}`, name, input },
          })

        yield* Effect.gen(function* () {
          const registry = yield* Tool.Service
          expect(yield* execute(registry, "grep", { pattern: "needle" })).toMatchObject({
            status: "completed",
            output: [{ entry: { path: "notes.txt" }, line: 1 }],
          })
          expect(yield* execute(registry, "glob", { pattern: "*.txt" })).toMatchObject({
            status: "completed",
            output: [{ path: "notes.txt", type: "file" }],
          })
        }).pipe(
          Effect.provide(
            AppNodeBuilder.build(LayerNode.group([Tool.node, searchToolsNode]), [
              ...other.replacements,
              // The session's files are empty, so a path-type check through them would not find the folder.
              Environment.node.replace(
                Layer.succeed(
                  Environment.Service,
                  Environment.Service.of({
                    files: Environment.makeFiles(Environment.makeMemoryDriver()),
                    spawner: Context.get(session, Environment.Service).spawner,
                  }),
                ),
              ),
              Config.node.replace(Config.testLayer()),
            ]),
          ),
        )

        expect(targetSpawns).toMatchObject([
          { args: expect.arrayContaining(["--json", "needle"]) },
          { args: expect.arrayContaining(["--files", "--glob=*.txt"]) },
        ])
        expect(sessionSpawns).toEqual([])
      }),
    ),
  )
})
