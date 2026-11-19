import { describe, expect } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { ChildProcess } from "effect/process"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Global } from "@opencode/util/global"
import { Config } from "@opencode/core/config"
import { Environment } from "@opencode/core/environment/index"
import { FileAccess } from "@opencode/core/file-access"
import { Flag } from "@opencode/core/flag"
import { Job } from "@opencode/core/job"
import { Permission } from "@opencode/core/permission"
import { PersistentPty } from "@opencode/core/persistent-pty"
import { Session } from "@opencode/core/session"
import { Shell } from "@opencode/core/shell"
import { ShellSelect } from "@opencode/core/shell/select"
import { Tool } from "@opencode/core/tool"
import { ShellTool } from "@opencode/core/tool/plugin/shell"
import { recordingEnvironmentLayer } from "./fixture/environment"
import { tempGlobalLayer } from "./fixture/global"
import { disabledPersistentPtyLayer } from "./fixture/persistent-pty"
import { elsewhere } from "./fixture/target-environment"
import { withTempDir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const shellToolNode = makeLocationNode({
  name: "test/shell-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(ShellTool.Plugin)),
  deps: [
    Config.node,
    Environment.node,
    FileAccess.node,
    Flag.node,
    Permission.node,
    Session.node,
    Job.node,
    Shell.node,
    Shell.daemonNode,
    ShellSelect.node,
    Tool.node,
  ],
})

const sessionID = Session.ID.make("ses_shell_target_environment_test")
const it = testEffect(Layer.succeed(Flag.Overrides, undefined))
// A foreground command never reaches its session; `Layer.mock` only fills in functions.
const revert: Session.Interface["revert"] = {
  stage: () => Effect.die("unused"),
  clear: () => Effect.die("unused"),
  commit: () => Effect.die("unused"),
}

describe("shell tool", () => {
  it.live("runs its command in the resolved working directory's environment, not the session's", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const targetSpawns: ChildProcess.Command[] = []
        const sessionSpawns: ChildProcess.Command[] = []
        const daemonCommands: string[] = []
        // The host under another identity: commands really run, through a spawner that is not the session's.
        const other = elsewhere(
          tmp.path,
          Context.get(yield* Layer.build(recordingEnvironmentLayer(targetSpawns)), Environment.Service),
        )
        // A process daemon that is available, so a local command would go to it before any spawner.
        const daemon = Shell.Daemon.of({
          at: () =>
            Effect.succeed({
              get: () => undefined,
              list: () => [],
              create: (input) =>
                Effect.sync(() => daemonCommands.push(input.info.command)).pipe(
                  Effect.andThen(Effect.fail(new PersistentPty.UnavailableError({ message: "recording only" }))),
                ),
              timeout: () => Effect.void,
              stop: () => Effect.void,
              remove: () => Effect.void,
            }),
          watch: () => Effect.void,
          handoffPrepared: () => false,
        })

        return yield* Effect.gen(function* () {
          const registry = yield* Tool.Service
          expect(
            yield* executeTool(registry, {
              sessionID,
              ...toolIdentity,
              call: { type: "tool-call", id: "call-shell", name: "shell", input: { command: "echo elsewhere" } },
            }),
          ).toMatchObject({ status: "completed", output: { exitCode: 0, output: "elsewhere\n" } })

          expect(targetSpawns).toHaveLength(1)
          expect(targetSpawns[0]).toMatchObject({
            args: expect.arrayContaining(["echo elsewhere"]),
            options: { cwd: tmp.path },
          })
          expect(sessionSpawns).toEqual([])
          expect(daemonCommands).toEqual([])
        }).pipe(
          Effect.provide(
            AppNodeBuilder.build(LayerNode.group([Tool.node, shellToolNode]), [
              ...other.replacements,
              Environment.node.replace(recordingEnvironmentLayer(sessionSpawns)),
              Shell.daemonNode.replace(Layer.succeed(Shell.Daemon, daemon)),
              PersistentPty.node.replace(disabledPersistentPtyLayer),
              Session.node.replace(Layer.mock(Session.Service, { revert })),
              Config.node.replace(Config.testLayer()),
              Global.node.replace(tempGlobalLayer),
            ]),
          ),
        )
      }),
    ),
  )
})
