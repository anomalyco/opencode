import fs from "fs/promises"
import path from "path"
import { expect } from "bun:test"
import { DateTime, Deferred, Duration, Effect, Exit, Fiber, Layer, Schema } from "effect"
import { ChildProcessSpawner } from "effect/process"
import type { ChildProcessHandle } from "effect/process/ChildProcessSpawner"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { Environment } from "@opencode/core/environment/index"
import { FileAccess } from "@opencode/core/file-access"
import { Job } from "@opencode/core/job"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { Permission } from "@opencode/core/permission"
import { Provider } from "@opencode/core/provider"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionMessage } from "@opencode/core/session/message"
import { createLLMEventPublisher } from "@opencode/core/session/runner/publish-llm-event"
import { Shell } from "@opencode/core/shell"
import { ShellSelect } from "@opencode/core/shell/select"
import { Tool } from "@opencode/core/tool"
import { ShellTool } from "@opencode/core/tool/plugin/shell"
import { ID } from "@opencode/schema/shell"
import { Global } from "@opencode/util/global"
import { makeGlobalNode, makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { hostEnvironmentLayer } from "./fixture/environment"
import { tempGlobalLayer } from "./fixture/global"
import { tempLocationLayer } from "./fixture/location"
import { it } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { registerToolPlugin, toolIdentity } from "./lib/tool"

const plugin = makeLocationNode({
  name: "test/shell-tool-handoff",
  layer: Layer.effectDiscard(registerToolPlugin(ShellTool.Plugin)),
  deps: [
    Tool.node,
    Shell.node,
    ShellSelect.node,
    Job.node,
    Session.node,
    Environment.node,
    FileAccess.node,
    Permission.node,
  ],
})

for (const scenario of ["progress", "job", "foreground", "background", "completed", "permission", "spawn"] as const) {
  const title = {
    progress: "cancels a shell during its progress publication before Job ownership",
    job: "cancels a Job whose start has not returned to the shell tool",
    foreground: "cancels the foreground Job and its shell while waiting for completion",
    background: "keeps a successfully backgrounded shell alive and delivers its result",
    completed: "returns a normal foreground shell result",
    permission: "keeps shell permission preparation interruptible before spawning",
    spawn: "keeps shell acquisition interruptible while the process handle is being handed off",
  }[scenario]
  it.live(title, () =>
    Effect.gen(function* () {
      const spawned = yield* Deferred.make<ChildProcessHandle>()
      const blocked = yield* Deferred.make<string>()
      const jobStarted = yield* Deferred.make<string>()
      const allowJobStart = yield* Deferred.make<void>()
      const allowSpawnReturn = yield* Deferred.make<void>()
      const permissionEntered = yield* Deferred.make<void>()
      const allowPermission = yield* Deferred.make<void>()
      const notified = yield* Deferred.make<Parameters<Session.Interface["synthetic"]>[0]>()
      const acknowledged = yield* Deferred.make<void>()
      const environment = Layer.effect(
        Environment.Service,
        Effect.gen(function* () {
          const host = yield* Environment.Service
          return Environment.Service.of({
            ...host,
            spawner: ChildProcessSpawner.make((command) =>
              host.spawner.spawn(command).pipe(
                Effect.tap((handle) => Deferred.succeed(spawned, handle)),
                Effect.tap(() => (scenario === "spawn" ? Deferred.await(allowSpawnReturn) : Effect.void)),
              ),
            ),
          })
        }),
      ).pipe(Layer.provide(hostEnvironmentLayer))
      const jobsLayer = Layer.effect(
        Job.Service,
        Effect.gen(function* () {
          const jobs = yield* Job.make
          return Job.Service.of({
            ...jobs,
            completeBackground: (notificationID) =>
              jobs.completeBackground(notificationID).pipe(Effect.tap(() => Deferred.succeed(acknowledged, undefined))),
            start: (input) =>
              jobs
                .start(input)
                .pipe(
                  Effect.tap((info) =>
                    scenario === "job"
                      ? Deferred.succeed(jobStarted, info.id).pipe(Effect.andThen(Deferred.await(allowJobStart)))
                      : Effect.void,
                  ),
                ),
            block: (input) => Deferred.succeed(blocked, input.id).pipe(Effect.andThen(jobs.block(input))),
          })
        }),
      )
      const sessions = Layer.mock(Session.Service, {
        synthetic: (input) =>
          Deferred.succeed(notified, input).pipe(
            Effect.as({
              id: input.id ?? SessionMessage.ID.create(),
              sessionID: input.sessionID,
              type: "synthetic" as const,
              payload: { text: input.text, description: input.description, metadata: input.metadata },
              delivery: input.delivery ?? "steer",
              time: { created: DateTime.makeUnsafe(0) },
            }),
          ),
        revert: {
          stage: () => Effect.die("Unexpected revert in shell handoff fixture"),
          clear: () => Effect.die("Unexpected revert in shell handoff fixture"),
          commit: () => Effect.die("Unexpected revert in shell handoff fixture"),
        },
      })

      yield* Effect.gen(function* () {
        const shell = yield* Shell.Service
        const selection = yield* ShellSelect.Service
        const jobs = yield* Job.Service
        const bus = yield* Bus.Service
        const tools = yield* Tool.Service
        const location = yield* Location.Service
        const progressEntered = yield* Deferred.make<string>()
        const allowProgress = yield* Deferred.make<void>()
        const finish = path.join(location.directory, "finish")
        const sessionID = Session.ID.make("ses_shell_tool_handoff")
        const assistantMessageID = SessionMessage.ID.create()
        const call = {
          type: "tool-call" as const,
          id: "call-shell-tool-handoff",
          name: "shell",
          input: {
            command:
              process.platform === "win32"
                ? "[Console]::Out.Write('done'); while (!(Test-Path -LiteralPath 'finish')) { Start-Sleep -Milliseconds 25 }"
                : "printf done; while [ ! -e finish ]; do sleep 0.05; done",
            timeout: 0,
            ...(scenario === "background" ? { background: true } : {}),
          },
        }
        const publisher = createLLMEventPublisher(bus, {
          sessionID,
          assistantMessageID,
          agent: toolIdentity.agent,
          model: Model.Ref.make({ id: Model.ID.make("test"), providerID: Provider.ID.make("test") }),
          providerMetadataKey: "test",
          started: 0,
        })
        yield* selection.transform((editor) =>
          editor.configure(process.platform === "win32" ? "powershell.exe" : "/bin/sh"),
        )
        yield* Effect.acquireRelease(
          bus.listen((event) => {
            if (!Schema.is(SessionEvent.Tool.Progress)(event) || event.data.id !== call.id) return Effect.void
            const shellID = event.data.metadata.shellID
            if (typeof shellID !== "string") return Effect.die("Expected shell ID progress")
            return Deferred.succeed(progressEntered, shellID).pipe(
              Effect.andThen(scenario === "progress" ? Deferred.await(allowProgress) : Effect.void),
            )
          }),
          (unsubscribe) => unsubscribe,
        )
        yield* publisher.publish(call)
        const snapshot = yield* tools.snapshot()
        const execution = yield* snapshot
          .execute({
            sessionID,
            agent: toolIdentity.agent,
            messageID: assistantMessageID,
            call,
            progress: (update) => publisher.progress(call.id, update),
          })
          .pipe(Effect.forkScoped({ startImmediately: true }))

        if (scenario === "permission") {
          yield* Deferred.await(permissionEntered)
          yield* Fiber.interrupt(execution)
          expect(Exit.hasInterrupts(yield* Fiber.await(execution))).toBe(true)
          expect(yield* Deferred.isDone(spawned)).toBe(false)
          expect(yield* shell.list()).toEqual([])
          return
        }

        if (scenario === "spawn") {
          const handle = yield* Deferred.await(spawned)
          yield* Fiber.interrupt(execution)
          expect(Exit.hasInterrupts(yield* Fiber.await(execution))).toBe(true)
          expect(yield* handle.isRunning).toBe(false)
          expect(yield* shell.list()).toEqual([])
          expect(yield* Deferred.isDone(progressEntered)).toBe(false)
          return
        }

        const shellID = ID.make(yield* Deferred.await(progressEntered))
        const info = yield* shell.get(shellID)
        const handle = yield* Deferred.await(spawned)
        yield* Effect.gen(function* () {
          if (scenario === "progress" || scenario === "job" || scenario === "foreground") {
            if (scenario === "job") expect(yield* Deferred.await(jobStarted)).toBe(shellID)
            if (scenario === "foreground") expect(yield* Deferred.await(blocked)).toBe(shellID)
            yield* Fiber.interrupt(execution)
            const job = yield* jobs.get(shellID)
            const runningShells = yield* shell.list()
            const captureExists = yield* Effect.promise(() => Bun.file(info.file).exists())
            // Shell.remove releases its process manager asynchronously; observe real exit before checking the process.
            const reaped =
              runningShells.length === 0
                ? yield* handle.exitCode.pipe(Effect.exit, Effect.timeoutOption("10 seconds"))
                : undefined
            const running = yield* handle.isRunning
            // Ensure even a failing regression leaves no process behind.
            yield* handle.kill({ forceKillAfter: Duration.seconds(3) }).pipe(Effect.ignore)
            expect(Exit.hasInterrupts(yield* Fiber.await(execution))).toBe(true)
            expect(runningShells).toEqual([])
            expect(captureExists).toBe(false)
            expect(reaped?._tag).toBe("Some")
            expect(running).toBe(false)
            if (scenario === "progress") expect(job).toBeUndefined()
            if (scenario !== "progress") expect(job?.status).toBe("cancelled")
            return
          }

          if (scenario === "background") {
            expect((yield* Fiber.join(execution)).output).toMatchObject({ status: "running", shellID })
            expect(yield* handle.isRunning).toBe(true)
            expect((yield* jobs.get(shellID))?.status).toBe("running")
            yield* Effect.promise(() => fs.writeFile(finish, ""))
            expect(yield* Deferred.await(notified)).toMatchObject({
              sessionID,
              text: expect.stringContaining("done"),
              metadata: { shellID, state: "completed", exit: 0 },
            })
            yield* Deferred.await(acknowledged)
            expect(yield* jobs.pendingBackground).toEqual([])
            return
          }

          yield* Effect.promise(() => fs.writeFile(finish, ""))
          expect((yield* Fiber.join(execution)).output).toMatchObject({ status: "completed", exit: 0, output: "done" })
          expect((yield* jobs.get(shellID))?.status).toBe("completed")
          expect(yield* handle.isRunning).toBe(false)
        }).pipe(
          Effect.ensuring(
            Deferred.succeed(allowProgress, undefined).pipe(
              Effect.andThen(handle.kill({ forceKillAfter: Duration.seconds(3) }).pipe(Effect.ignore)),
              Effect.andThen(shell.remove(shellID).pipe(Effect.ignore)),
            ),
          ),
        )
      }).pipe(
        Effect.provide(
          AppNodeBuilder.build(
            LayerNode.group([plugin, Shell.node, Job.node, Tool.node, Bus.node, Location.node, ShellSelect.node]),
            [
              Location.node.replace(tempLocationLayer),
              Global.node.replace(tempGlobalLayer),
              Config.node.replace(Config.testLayer()),
              Session.node.replace(sessions),
              Job.node.replace(makeGlobalNode({ service: Job.Service, layer: jobsLayer, deps: [Database.node] })),
              Permission.node.replace(
                permissionLayer({
                  assert: () =>
                    scenario === "permission"
                      ? Deferred.succeed(permissionEntered, undefined).pipe(
                          Effect.andThen(Deferred.await(allowPermission)),
                        )
                      : Effect.void,
                }),
              ),
              Environment.node.replace(environment),
            ],
          ),
        ),
        Effect.ensuring(
          Effect.all([
            Deferred.succeed(allowPermission, undefined),
            Deferred.succeed(allowJobStart, undefined),
            Deferred.succeed(allowSpawnReturn, undefined),
          ]),
        ),
      )
    }),
  )
}
