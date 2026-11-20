import { describe, expect } from "bun:test"
import { Context, Effect, Layer, Sink, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { ExitCode, makeHandle, ProcessId } from "effect/process/ChildProcessSpawner"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Global } from "@opencode/util/global"
import { Config } from "@opencode/core/config"
import { Environment } from "@opencode/core/environment/index"
import { FileAccess } from "@opencode/core/file-access"
import { Flag } from "@opencode/core/flag"
import { Job } from "@opencode/core/job"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { PersistentPty } from "@opencode/core/persistent-pty"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { Shell } from "@opencode/core/shell"
import { ShellSelect } from "@opencode/core/shell/select"
import { Tool } from "@opencode/core/tool"
import { Workspace } from "@opencode/core/workspace"
import { ShellTool } from "@opencode/core/tool/plugin/shell"
import { hostEnvironmentLayer, recordingEnvironmentLayer } from "./fixture/environment"
import { tempGlobalLayer } from "./fixture/global"
import { disabledPersistentPtyLayer } from "./fixture/persistent-pty"
import { elsewhere } from "./fixture/target-environment"
import { location } from "./fixture/location"
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
    Location.node,
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

// Runs `echo elsewhere` in a working directory whose environment is not the session's object and has the given
// id, and reports which spawner started it and whether the process daemon was asked first.
const run = (id: Environment.ID, workspaceID?: Workspace.ID) =>
  withTempDir((tmp) =>
    Effect.gen(function* () {
      const targetSpawns: ChildProcess.Command[] = []
      const sessionSpawns: ChildProcess.Command[] = []
      const daemonCommands: string[] = []
      // The host's files, so the working directory exists there, and a spawner that starts no process: a command
      // elsewhere gets none of this machine's variables, which a real shell on Windows may not start without.
      const output = Stream.succeed(Buffer.from("elsewhere"))
      const other = elsewhere(tmp.path, {
        ...Context.get(yield* Layer.build(hostEnvironmentLayer), Environment.Service),
        id,
        spawner: ChildProcessSpawner.make((command) =>
          Effect.sync(() => {
            targetSpawns.push(command)
            return makeHandle({
              pid: ProcessId(1),
              exitCode: Effect.succeed(ExitCode(0)),
              isRunning: Effect.succeed(false),
              kill: () => Effect.void,
              stdin: Sink.drain,
              stdout: output,
              stderr: Stream.empty,
              all: output,
              getInputFd: () => Sink.drain,
              getOutputFd: () => Stream.empty,
              unref: Effect.succeed(Effect.void),
            })
          }),
        ),
      })
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
        const shells = yield* ShellSelect.Service
        // The program comes from the plugin's compatible shell, so ask the same way.
        const shell = workspaceID === undefined ? undefined : yield* shells.resolve({ priority: "compat" })
        expect(
          yield* executeTool(registry, {
            sessionID,
            ...toolIdentity,
            call: { type: "tool-call", id: "call-shell", name: "shell", input: { command: "echo elsewhere" } },
          }),
        ).toMatchObject({ status: "completed", output: { exitCode: 0, output: "elsewhere" } })
        return { targetSpawns, sessionSpawns, daemonCommands, shell }
      }).pipe(
        Effect.provide(
          AppNodeBuilder.build(LayerNode.group([Tool.node, shellToolNode, ShellSelect.node]), [
            ...other.replacements,
            ...(workspaceID === undefined
              ? []
              : [
                  Location.node.replace(
                    Layer.succeed(
                      Location.Service,
                      Location.Service.of({
                        ...location({ directory: AbsolutePath.make(tmp.path) }),
                        workspaceID,
                      }),
                    ),
                  ),
                ]),
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
  )

describe("shell tool", () => {
  it.live("runs its command in the resolved working directory's environment, not the session's", () =>
    Effect.gen(function* () {
      const ran = yield* run(Environment.ID.make("elsewhere"))
      expect(ran.daemonCommands).toEqual([])
      expect(ran.targetSpawns).toHaveLength(1)
      expect(ran.targetSpawns[0]).toMatchObject({ args: expect.arrayContaining(["echo elsewhere"]) })
      expect(ran.sessionSpawns).toEqual([])
    }),
  )

  it.live("treats an environment with the session's id as the session's machine", () =>
    Effect.gen(function* () {
      const ran = yield* run(Environment.localID)
      // Local, so the daemon is asked first; it is unavailable here, and the command falls back to the spawner.
      expect(ran.daemonCommands).toEqual(["echo elsewhere"])
      expect(ran.targetSpawns).toHaveLength(1)
      expect(ran.sessionSpawns).toEqual([])
    }),
  )

  it.live("keeps a workspace session's own shell instead of running its command with sh", () =>
    Effect.gen(function* () {
      const ran = yield* run(Environment.localID, Workspace.ID.make("wrk_workspace"))
      // A workspace is not this server's own machine, so the daemon is never asked, and no sh is forced.
      expect(ran.daemonCommands).toEqual([])
      expect(ran.targetSpawns).toHaveLength(1)
      expect(ran.targetSpawns[0]).toMatchObject({ command: ran.shell })
    }),
  )
})
