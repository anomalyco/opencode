import fs from "fs/promises"
import { watch } from "node:fs"
import path from "path"
import { describe, expect } from "bun:test"
import { Clock, Deferred, Duration, Effect, Exit, Fiber, Layer, Schema } from "effect"
import { TestClock } from "effect/testing"
import { Money } from "@opencode/schema/money"
import { ID } from "@opencode/schema/shell"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeGlobalNode, makeLocationNode } from "@opencode/util/effect/app-node"
import { filesystem } from "@opencode/util/effect/app-node-platform"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { Environment } from "@opencode/core/environment/index"
import { FileAccess } from "@opencode/core/file-access"
import { Job } from "@opencode/core/job"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { Permission } from "@opencode/core/permission"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginSupervisor } from "@opencode/core/plugin/supervisor"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionStore } from "@opencode/core/session/store"
import { SubagentJob } from "@opencode/core/session/subagent-job"
import { Shell } from "@opencode/core/shell"
import { ShellSelect } from "@opencode/core/shell/select"
import { Tool } from "@opencode/core/tool"
import { JobTools } from "@opencode/core/tool/plugin/job"
import { OpenCodeTools } from "@opencode/core/tool/plugin/opencode"
import { ShellTool } from "@opencode/core/tool/plugin/shell"
import { SubagentTool } from "@opencode/core/tool/plugin/subagent"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const modelRef = Model.Ref.make({ id: Model.ID.make("test"), providerID: Provider.ID.make("test") })
const zeroTokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

const childGate = {
  started: undefined as Deferred.Deferred<void> | undefined,
  release: undefined as Deferred.Deferred<void> | undefined,
  interrupted: [] as Session.ID[],
  woken: [] as Session.ID[],
}

const executionNode = makeGlobalNode({
  service: SessionExecution.Service,
  layer: Layer.effect(
    SessionExecution.Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const store = yield* SessionStore.Service
      const active = new Set<Session.ID>()

      const runChild = Effect.fn("AutoBgTest.runChild")(function* (sessionID: Session.ID) {
        const session = yield* store.get(sessionID)
        if (!session) return
        active.add(sessionID)
        return yield* Effect.gen(function* () {
          const assistantMessageID = SessionMessage.ID.create()
          yield* bus.publish(SessionEvent.Step.Started, {
            sessionID,
            assistantMessageID,
            agent: session.agent ?? Agent.ID.make("reviewer"),
            model: modelRef,
            started: 0,
          })
          yield* bus.publish(SessionEvent.Text.Started, {
            sessionID,
            assistantMessageID,
            ordinal: 0,
          })
          yield* bus.publish(SessionEvent.Text.Ended, {
            sessionID,
            assistantMessageID,
            ordinal: 0,
            text: "subagent partial findings",
          })
          if (childGate.started) yield* Deferred.succeed(childGate.started, undefined)
          if (childGate.release) yield* Deferred.await(childGate.release)
          const finalMessageID = SessionMessage.ID.create()
          yield* bus.publish(SessionEvent.Step.Started, {
            sessionID,
            assistantMessageID: finalMessageID,
            agent: session.agent ?? Agent.ID.make("reviewer"),
            model: modelRef,
            started: 1,
          })
          yield* bus.publish(SessionEvent.Text.Started, {
            sessionID,
            assistantMessageID: finalMessageID,
            ordinal: 0,
          })
          yield* bus.publish(SessionEvent.Text.Ended, {
            sessionID,
            assistantMessageID: finalMessageID,
            ordinal: 0,
            text: "subagent final answer",
          })
          yield* bus.publish(SessionEvent.Step.Ended, {
            sessionID,
            assistantMessageID: finalMessageID,
            finish: "stop",
            cost: Money.USD.zero,
            tokens: zeroTokens,
          })
        }).pipe(Effect.ensuring(Effect.sync(() => active.delete(sessionID))))
      })

      return SessionExecution.Service.of({
        active: Effect.sync(() => new Set(active)),
        isActive: (sessionID) => Effect.sync(() => active.has(sessionID)),
        resume: runChild,
        wake: (sessionID) => Effect.sync(() => void childGate.woken.push(sessionID)),
        interrupt: (sessionID) =>
          Effect.sync(() => {
            childGate.interrupted.push(sessionID)
            const had = active.delete(sessionID)
            return had
          }),
        awaitIdle: () => Effect.void,
      })
    }),
  ),
  deps: [Bus.node, SessionStore.node],
})

const autoBgPlugins = makeLocationNode({
  name: "test/autobg-plugins",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      yield* registerToolPlugin(OpenCodeTools.Plugin)
      yield* registerToolPlugin(JobTools.Plugin)
      yield* registerToolPlugin(ShellTool.Plugin)
      yield* registerToolPlugin(SubagentTool.Plugin, {}, (name, callback) => hooks.register("tool", name, callback))
    }),
  ),
  deps: [
    Agent.node,
    Config.node,
    Environment.node,
    FileAccess.node,
    Job.node,
    Location.node,
    Model.node,
    Permission.node,
    PluginHooks.node,
    Session.node,
    Shell.node,
    ShellSelect.node,
    SubagentJob.node,
    Tool.node,
  ],
})

const nodes = LayerNode.group([
  Database.node,
  Bus.node,
  Job.node,
  Session.node,
  SessionExecution.node,
  LocationServiceMap.node,
  filesystem,
  FSUtil.node,
  Global.node,
])

const it = testEffect(
  AppNodeBuilder.build(nodes, [
    SessionExecution.node.replace(executionNode),
    Permission.node.replace(permissionLayer({ assert: () => Effect.void })),
    Global.node.replace(tempGlobalLayer),
    PluginSupervisor.node.replace(autoBgPlugins),
    offlineModels,
  ]),
)

const prepareLocation = (directory: string) =>
  Effect.gen(function* () {
    childGate.started = undefined
    childGate.release = undefined
    childGate.interrupted.length = 0
    childGate.woken.length = 0
    const location = Location.Ref.make({ directory: AbsolutePath.make(directory) })
    const locations = yield* LocationServiceMap.Service
    const sessions = yield* Session.Service
    yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(Effect.provide(locations.get(location)))
    yield* Provider.Service.use((providers) =>
      providers.transform((editor) => {
        editor.models.update(modelRef.providerID, modelRef.id, () => {})
      }),
    ).pipe(Effect.provide(locations.get(location)))
    yield* Agent.Service.use((agents) =>
      agents.transform((editor) => {
        editor.update(toolIdentity.agent, (agent) => {
          agent.mode = "primary"
          agent.permissions.push({ action: "*", resource: "*", effect: "allow" })
        })
        editor.update(Agent.ID.make("reviewer"), (agent) => {
          agent.mode = "subagent"
          agent.model = modelRef
        })
      }),
    ).pipe(Effect.provide(locations.get(location)))
    const session = yield* sessions.create({ location, model: modelRef })
    const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(session.location)))
    const shell = yield* Shell.Service.pipe(Effect.provide(locations.get(session.location)))
    return { session, registry, sessions, shell }
  })

describe("auto-background tools and job controls", () => {
  it.effect("yields execute after yield_after with jobID and output so far, reflects session busy state, and delivers completion", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const { session, registry, sessions } = yield* prepareLocation(tmp.path)
      const jobs = yield* Job.Service
      const started = yield* Deferred.make<void>()
      const gate = yield* Deferred.make<void>()

      yield* registry.transform((editor) => {
        editor.add({
          name: "slow_fetch",
          description: "Slow Code Mode tool",
          input: Schema.Struct({ label: Schema.String }),
          output: Schema.String,
          options: { namespace: "demo", codemode: true, pinned: true },
          execute: ({ label }) =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(gate)),
              Effect.as({ output: `resolved:${label}` }),
            ),
        })
      })

      const callFiber = yield* executeTool(registry, {
        sessionID: session.id,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-execute-yield",
          name: "execute",
          input: {
            code: 'console.log("warming cache"); const res = await tools.demo.slow_fetch({ label: "alpha" }); console.log("done"); return res',
            yield_after: 5_000,
          },
        },
      }).pipe(Effect.forkChild({ startImmediately: true }))

      yield* Deferred.await(started)
      yield* Effect.yieldNow
      yield* TestClock.adjust("5 seconds")

      const yielded = yield* Fiber.join(callFiber)
      expect(yielded.status).toBe("completed")
      const jobID = String(yielded.output?.jobID)
      expect(jobID).toStartWith("job_")
      expect(yielded.output?.status).toBe("running")
      expect(yielded.output?.output).toContain(`jobID: ${jobID}`)
      expect(yielded.output?.output).toContain("warming cache")
      expect(yielded.output?.output).toContain("[running] demo.slow_fetch")

      // Session busy/idle state and session jobs reflect the running background job.
      expect(Array.from(yield* sessions.active)).toContain(session.id)
      expect(yield* sessions.jobs(session.id)).toMatchObject([{ id: jobID, type: "execute", status: "running" }])

      // Agent can list, inspect output so far, and wait with a timeout on the running job.
      const readRes = yield* executeTool(registry, {
        sessionID: session.id,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-job-output",
          name: "execute",
          input: { code: `return await tools.opencode.job_output({ id: ${JSON.stringify(jobID)} })` },
        },
      })
      expect(JSON.parse(readRes.output.output)).toMatchObject({
        id: jobID,
        type: "execute",
        status: "running",
        output: expect.stringContaining("warming cache"),
      })

      const waitRunningFiber = yield* executeTool(registry, {
        sessionID: session.id,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-job-wait-timeout",
          name: "execute",
          input: { code: `return await tools.opencode.job_wait({ id: ${JSON.stringify(jobID)}, yield_after: 1000 })` },
        },
      }).pipe(Effect.forkChild({ startImmediately: true }))
      yield* Effect.yieldNow
      yield* TestClock.adjust("1 second")
      const waitRunning = JSON.parse((yield* Fiber.join(waitRunningFiber)).output.output)
      expect(waitRunning).toMatchObject({
        timedOut: true,
        job: { id: jobID, status: "running", output: expect.stringContaining("warming cache") },
      })

      // Finish the job and verify its result is delivered to the session inbox and busy state clears.
      const wokeBefore = childGate.woken.length
      yield* Deferred.succeed(gate, undefined)
      yield* jobs.awaitSessionBackground(session.id)

      expect(Array.from(yield* sessions.active)).not.toContain(session.id)
      expect(yield* sessions.jobs(session.id)).toEqual([])
      expect(childGate.woken.slice(wokeBefore)).toContain(session.id)
      const inbox = yield* sessions.inbox(session.id)
      expect(inbox).toMatchObject([
        {
          type: "synthetic",
          payload: {
            text: `<execute id="${jobID}" state="completed">\nresolved:alpha\n\nLogs:\nwarming cache\ndone\n</execute>`,
            metadata: { source: "execute", jobID, state: "completed" },
          },
        },
      ])
      expect(yield* jobs.pendingBackground).toEqual([])

      // Completed background job remains inspectable via job_output, job_wait, and job_list(all) after notice delivery.
      const inspectAfter = yield* executeTool(registry, {
        sessionID: session.id,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-job-after-complete",
          name: "execute",
          input: {
            code: `return {
              output: await tools.opencode.job_output({ id: ${JSON.stringify(jobID)} }),
              waited: await tools.opencode.job_wait({ id: ${JSON.stringify(jobID)} }),
              listed: await tools.opencode.job_list({ status: "all" }),
            }`,
          },
        },
      })
      const post = JSON.parse(inspectAfter.output.output)
      expect(post.output).toMatchObject({
        id: jobID,
        status: "completed",
        output: expect.stringContaining("resolved:alpha"),
      })
      expect(post.waited).toMatchObject({
        timedOut: false,
        job: {
          id: jobID,
          status: "completed",
          output: expect.stringContaining("resolved:alpha"),
        },
      })
      expect(post.listed.jobs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: jobID,
            status: "completed",
            output: expect.stringContaining("resolved:alpha"),
          }),
        ]),
      )
    }),
  )

  it.effect("stops a running execute job via job_stop without waking an idle session", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const { session, registry, sessions } = yield* prepareLocation(tmp.path)
      const jobs = yield* Job.Service
      const started = yield* Deferred.make<void>()

      yield* registry.transform((editor) => {
        editor.add({
          name: "hang",
          description: "Hanging tool",
          input: Schema.Struct({}),
          output: Schema.String,
          options: { namespace: "demo", codemode: true },
          execute: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
        })
      })

      const callFiber = yield* executeTool(registry, {
        sessionID: session.id,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-execute-stop",
          name: "execute",
          input: {
            code: 'console.log("before stop"); return await tools.demo.hang({})',
            yield_after: 1_000,
          },
        },
      }).pipe(Effect.forkChild({ startImmediately: true }))

      yield* Deferred.await(started)
      yield* Effect.yieldNow
      yield* TestClock.adjust("1 second")
      const yielded = yield* Fiber.join(callFiber)
      const jobID = String(yielded.output?.jobID)
      expect(Array.from(yield* sessions.active)).toContain(session.id)

      const wokeBefore = childGate.woken.length
      const stopRes = yield* executeTool(registry, {
        sessionID: session.id,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-stop",
          name: "execute",
          input: { code: `return await tools.opencode.job_stop({ id: ${JSON.stringify(jobID)} })` },
        },
      })
      const stopped = JSON.parse(stopRes.output.output)
      expect(stopped).toMatchObject({
        id: jobID,
        status: "cancelled",
        output: expect.stringContaining("before stop"),
      })
      yield* jobs.awaitSessionBackground(session.id)
      expect(Array.from(yield* sessions.active)).not.toContain(session.id)
      expect(childGate.woken.slice(wokeBefore)).not.toContain(session.id)
    }),
  )

  it.effect("yields subagent after yield_after with output so far, delivers completion, and supports job_stop", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const { session, registry, sessions } = yield* prepareLocation(tmp.path)
      const jobs = yield* Job.Service

      childGate.started = yield* Deferred.make<void>()
      childGate.release = yield* Deferred.make<void>()

      const subagentFiber = yield* executeTool(registry, {
        sessionID: session.id,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-subagent-yield",
          name: SubagentTool.name,
          input: {
            agent: "reviewer",
            description: "deep audit",
            prompt: "audit everything",
            yield_after: 5_000,
          },
        },
      }).pipe(Effect.forkChild({ startImmediately: true }))

      yield* Deferred.await(childGate.started)
      yield* Effect.yieldNow
      yield* TestClock.adjust("5 seconds")

      const yielded = yield* Fiber.join(subagentFiber)
      const childID = String(yielded.output?.sessionID)
      expect(yielded.output).toMatchObject({
        sessionID: childID,
        jobID: childID,
        status: "running",
      })
      expect(yielded.output?.output).toContain("subagent partial findings")
      expect(Array.from(yield* sessions.active)).toContain(session.id)

      yield* Deferred.succeed(childGate.release, undefined)
      yield* jobs.awaitSessionBackground(session.id)
      expect(Array.from(yield* sessions.active)).not.toContain(session.id)

      const inbox = yield* sessions.inbox(session.id)
      expect(inbox).toMatchObject([
        {
          type: "synthetic",
          payload: {
            text: `<subagent sessionID="${childID}" state="completed" description="deep audit">\nsubagent final answer\n</subagent>`,
          },
        },
      ])

      // Launch a second subagent and stop it via job_stop.
      childGate.started = yield* Deferred.make<void>()
      childGate.release = yield* Deferred.make<void>()
      const secondFiber = yield* executeTool(registry, {
        sessionID: session.id,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-subagent-stop",
          name: SubagentTool.name,
          input: {
            agent: "reviewer",
            description: "stoppable audit",
            prompt: "audit slowly",
            yield_after: 1_000,
          },
        },
      }).pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(childGate.started)
      yield* Effect.yieldNow
      yield* TestClock.adjust("1 second")
      const secondYielded = yield* Fiber.join(secondFiber)
      const secondChildID = String(secondYielded.output?.jobID)

      const stopRes = yield* executeTool(registry, {
        sessionID: session.id,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-stop-subagent",
          name: "execute",
          input: { code: `return await tools.opencode.job_stop({ id: ${JSON.stringify(secondChildID)} })` },
        },
      })
      expect(JSON.parse(stopRes.output.output)).toMatchObject({
        id: secondChildID,
        status: "cancelled",
      })
      expect(childGate.interrupted).toContain(Session.ID.make(secondChildID))
    }),
  )

  it.live("yields shell with live output so far, delivers completion, and stops a running shell via job_stop", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const { session, registry, sessions, shell } = yield* prepareLocation(tmp.path)
      const jobs = yield* Job.Service
      const liveClock = Clock.Clock.defaultValue()
      const makeYieldClock = (trigger: Deferred.Deferred<void>): Clock.Clock => ({
        currentTimeMillisUnsafe: () => liveClock.currentTimeMillisUnsafe(),
        currentTimeMillis: liveClock.currentTimeMillis,
        currentTimeNanosUnsafe: () => liveClock.currentTimeNanosUnsafe(),
        currentTimeNanos: liveClock.currentTimeNanos,
        monotonicTimeNanosUnsafe: () => liveClock.monotonicTimeNanosUnsafe(),
        monotonicTimeNanos: liveClock.monotonicTimeNanos,
        sleep: () => Deferred.await(trigger),
      })
      const waitForSnapshot = (text: string): Effect.Effect<void, Error> =>
        Effect.gen(function* () {
          const deadline = liveClock.currentTimeMillisUnsafe() + 5_000
          while (liveClock.currentTimeMillisUnsafe() < deadline) {
            const running = yield* shell.list()
            for (const item of running) {
              const snap = yield* shell.snapshot(item.id)
              if (snap?.output.includes(text)) return
            }
            yield* liveClock.sleep(Duration.millis(5))
          }
          return yield* Effect.fail(new Error(`Timed out waiting for shell output: ${text}`))
        })

      const isWindows = process.platform === "win32"
      const readyFile = path.join(tmp.path, "ready")
      const releaseFile = path.join(tmp.path, "release")
      const ready = yield* Deferred.make<void>()
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          watch(tmp.path, (_event, filename) => {
            if (filename === "ready") Deferred.doneUnsafe(ready, Exit.void)
          }),
        ),
        (watcher) => Effect.sync(() => watcher.close()),
      )

      const command = isWindows
        ? `[Console]::Out.WriteLine('shell-progress'); [Console]::Out.Flush(); New-Item -ItemType File -Path '${readyFile}' | Out-Null; while (-not (Test-Path '${releaseFile}')) { Start-Sleep -Milliseconds 20 }; [Console]::Out.WriteLine('shell-finished')`
        : `printf 'shell-progress\\n'; : > '${readyFile}'; while [ ! -e '${releaseFile}' ]; do sleep 0.02; done; printf 'shell-finished\\n'`

      const firstYieldTrigger = yield* Deferred.make<void>()
      const shellFiber = yield* executeTool(registry, {
        sessionID: session.id,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-shell-yield",
          name: "shell",
          input: { command, yield_after: 5_000 },
        },
      }).pipe(
        Effect.provideService(Clock.Clock, makeYieldClock(firstYieldTrigger)),
        Effect.forkScoped({ startImmediately: true }),
      )

      yield* Deferred.await(ready).pipe(Effect.timeout("5 seconds"))
      yield* waitForSnapshot("shell-progress")
      yield* Deferred.succeed(firstYieldTrigger, undefined)
      const yielded = yield* Fiber.join(shellFiber)
      const jobID = String(yielded.output?.jobID)
      expect(jobID).toStartWith("sh_")
      expect(yielded.output?.status).toBe("running")
      expect(yielded.output?.output).toContain("shell-progress")
      expect(Array.from(yield* sessions.active)).toContain(session.id)

      // Read live output via job_output while running.
      const liveOut = yield* executeTool(registry, {
        sessionID: session.id,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-shell-job-output",
          name: "execute",
          input: { code: `return await tools.opencode.job_output({ id: ${JSON.stringify(jobID)} })` },
        },
      })
      expect(JSON.parse(liveOut.output.output)).toMatchObject({
        id: jobID,
        type: "shell",
        status: "running",
        output: expect.stringContaining("shell-progress"),
      })

      // Release the child and verify completion delivery via job_wait and session inbox.
      yield* Effect.promise(() => fs.writeFile(releaseFile, "go"))
      const waited = yield* executeTool(registry, {
        sessionID: session.id,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-shell-job-wait",
          name: "execute",
          input: { code: `return await tools.opencode.job_wait({ id: ${JSON.stringify(jobID)}, yield_after: 5000 })` },
        },
      })
      expect(JSON.parse(waited.output.output)).toMatchObject({
        timedOut: false,
        job: {
          id: jobID,
          status: "completed",
          output: expect.stringContaining("shell-finished"),
        },
      })
      yield* jobs.awaitSessionBackground(session.id)
      expect(Array.from(yield* sessions.active)).not.toContain(session.id)
      const inbox = yield* sessions.inbox(session.id)
      expect(inbox).toMatchObject([
        {
          type: "synthetic",
          payload: {
            text: expect.stringContaining("shell-finished"),
            metadata: { source: "shell", jobID, state: "completed" },
          },
        },
      ])

      // Start a second shell and stop it via job_stop.
      const stopReadyFile = path.join(tmp.path, "stop-ready")
      const stopReady = yield* Deferred.make<void>()
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          watch(tmp.path, (_event, filename) => {
            if (filename === "stop-ready") Deferred.doneUnsafe(stopReady, Exit.void)
          }),
        ),
        (watcher) => Effect.sync(() => watcher.close()),
      )
      const hangCommand = isWindows
        ? `[Console]::Out.WriteLine('hang-line'); [Console]::Out.Flush(); New-Item -ItemType File -Path '${stopReadyFile}' | Out-Null; Start-Sleep -Seconds 60`
        : `printf 'hang-line\\n'; : > '${stopReadyFile}'; sleep 60`
      const secondYieldTrigger = yield* Deferred.make<void>()
      const secondFiber = yield* executeTool(registry, {
        sessionID: session.id,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-shell-stop",
          name: "shell",
          input: { command: hangCommand, yield_after: 5_000 },
        },
      }).pipe(
        Effect.provideService(Clock.Clock, makeYieldClock(secondYieldTrigger)),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* Deferred.await(stopReady).pipe(Effect.timeout("5 seconds"))
      yield* waitForSnapshot("hang-line")
      yield* Deferred.succeed(secondYieldTrigger, undefined)
      const secondYielded = yield* Fiber.join(secondFiber)
      const secondID = String(secondYielded.output?.jobID)

      const stopped = yield* executeTool(registry, {
        sessionID: session.id,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-shell-stop-tool",
          name: "execute",
          input: { code: `return await tools.opencode.job_stop({ id: ${JSON.stringify(secondID)} })` },
        },
      })
      expect(JSON.parse(stopped.output.output)).toMatchObject({
        id: secondID,
        status: "cancelled",
        output: expect.stringContaining("hang-line"),
      })
      yield* jobs.awaitSessionBackground(session.id)
      expect(Array.from(yield* sessions.active)).not.toContain(session.id)
    }),
  )

  it.live("keeps an explicit shell timeout armed when default yield_after moves the command to the background", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const { session, registry, sessions, shell } = yield* prepareLocation(tmp.path)
      const jobs = yield* Job.Service
      const liveClock = Clock.Clock.defaultValue()
      const yieldTrigger = yield* Deferred.make<void>()
      const yieldClock: Clock.Clock = {
        currentTimeMillisUnsafe: () => liveClock.currentTimeMillisUnsafe(),
        currentTimeMillis: liveClock.currentTimeMillis,
        currentTimeNanosUnsafe: () => liveClock.currentTimeNanosUnsafe(),
        currentTimeNanos: liveClock.currentTimeNanos,
        monotonicTimeNanosUnsafe: () => liveClock.monotonicTimeNanosUnsafe(),
        monotonicTimeNanos: liveClock.monotonicTimeNanos,
        sleep: () => Deferred.await(yieldTrigger),
      }
      const isWindows = process.platform === "win32"
      const readyFile = path.join(tmp.path, "timeout-ready")
      const ready = yield* Deferred.make<void>()
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          watch(tmp.path, (_event, filename) => {
            if (filename === "timeout-ready") Deferred.doneUnsafe(ready, Exit.void)
          }),
        ),
        (watcher) => Effect.sync(() => watcher.close()),
      )
      const command = isWindows
        ? `New-Item -ItemType File -Path '${readyFile}' | Out-Null; Start-Sleep -Seconds 60`
        : `: > '${readyFile}'; sleep 60`

      // Omit `yield_after` so default 30s auto-backgrounding applies, while passing an explicit `timeout: 80`.
      const callFiber = yield* executeTool(registry, {
        sessionID: session.id,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-shell-explicit-timeout",
          name: "shell",
          input: { command, timeout: 80 },
        },
      }).pipe(
        Effect.provideService(Clock.Clock, yieldClock),
        Effect.forkScoped({ startImmediately: true }),
      )

      yield* Deferred.await(ready).pipe(Effect.timeout("5 seconds"))
      yield* Deferred.succeed(yieldTrigger, undefined)
      const yielded = yield* Fiber.join(callFiber)
      const jobID = String(yielded.output?.jobID)
      expect(yielded.output?.status).toBe("running")

      const terminal = yield* shell.wait(ID.make(jobID)).pipe(Effect.timeout("5 seconds"))
      expect(terminal.status).toBe("timeout")
      yield* jobs.awaitSessionBackground(session.id)
      const inbox = yield* sessions.inbox(session.id)
      expect(inbox).toMatchObject([
        {
          type: "synthetic",
          payload: {
            text: expect.stringContaining("Timed out before completion"),
            metadata: { source: "shell", jobID, state: "completed", timeout: true },
          },
        },
      ])
    }),
  )

  it.live("cancels background shell and execute jobs across a session and its descendants on Session.remove and subagent job_stop", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const { session, registry, sessions, shell } = yield* prepareLocation(tmp.path)
      const jobs = yield* Job.Service
      const isWindows = process.platform === "win32"
      const hangCommand = isWindows ? "Start-Sleep -Seconds 60" : "sleep 60"

      let toolStepCalls = 0
      const stepStarted = yield* Deferred.make<void>()
      const stepGate = yield* Deferred.make<void>()
      yield* registry.transform((editor) => {
        editor.add({
          name: "loop_step",
          description: "Blocking step",
          input: Schema.Struct({}),
          output: Schema.String,
          options: { namespace: "demo", codemode: true },
          execute: () =>
            Effect.sync(() => {
              toolStepCalls++
            }).pipe(
              Effect.andThen(Deferred.succeed(stepStarted, undefined)),
              Effect.andThen(Deferred.await(stepGate)),
              Effect.as({ output: "tick" }),
            ),
        })
      })

      // 1) Subagent starts its own background shell + execute jobs, then parent stops the subagent via job_stop.
      childGate.started = yield* Deferred.make<void>()
      childGate.release = yield* Deferred.make<void>()
      const subFiber = yield* executeTool(registry, {
        sessionID: session.id,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-subagent-with-children",
          name: SubagentTool.name,
          input: {
            agent: "reviewer",
            description: "subagent with bg work",
            prompt: "spawn bg work",
            yield_after: 0,
          },
        },
      }).pipe(Effect.forkScoped({ startImmediately: true }))
      const subYielded = yield* Fiber.join(subFiber)
      const childSessionID = Session.ID.make(String(subYielded.output?.sessionID))

      const childShell = yield* executeTool(registry, {
        sessionID: childSessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-child-bg-shell",
          name: "shell",
          input: { command: hangCommand, background: true },
        },
      })
      const childShellID = String(childShell.output?.jobID)
      const childExec = yield* executeTool(registry, {
        sessionID: childSessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-child-bg-exec",
          name: "execute",
          input: {
            code: "while (true) { await tools.demo.loop_step({}) }",
            yield_after: 0,
          },
        },
      })
      const childExecID = String(childExec.output?.jobID)
      const grandchild = yield* sessions.create({
        parentID: childSessionID,
        title: "grandchild",
        agent: Agent.ID.make("reviewer"),
        model: modelRef,
      })
      const grandchildShell = yield* executeTool(registry, {
        sessionID: grandchild.id,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-grandchild-bg-shell",
          name: "shell",
          input: { command: hangCommand, background: true },
        },
      })
      const grandchildShellID = String(grandchildShell.output?.jobID)
      yield* Deferred.await(stepStarted).pipe(Effect.timeout("5 seconds"))
      expect((yield* jobs.get(childShellID))?.status).toBe("running")
      expect((yield* jobs.get(childExecID))?.status).toBe("running")
      expect((yield* jobs.get(grandchildShellID))?.status).toBe("running")

      const stopSub = yield* executeTool(registry, {
        sessionID: session.id,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-stop-subagent-tree",
          name: "execute",
          input: { code: `return await tools.opencode.job_stop({ id: ${JSON.stringify(childSessionID)} })` },
        },
      })
      expect(JSON.parse(stopSub.output.output)).toMatchObject({ id: childSessionID, status: "cancelled" })
      expect((yield* jobs.get(childShellID))?.status).toBe("cancelled")
      expect((yield* jobs.get(childExecID))?.status).toBe("cancelled")
      expect((yield* jobs.get(grandchildShellID))?.status).toBe("cancelled")
      expect((yield* shell.list()).map((item) => String(item.id))).not.toContain(childShellID)
      expect((yield* shell.list()).map((item) => String(item.id))).not.toContain(grandchildShellID)

      // 2) Session.remove cancels background shell + execute jobs on both parent and descendant sessions.
      const nextStepStarted = yield* Deferred.make<void>()
      yield* registry.transform((editor) => {
        editor.update("demo_loop_step", (tool) => {
          tool.execute = () =>
            Effect.sync(() => {
              toolStepCalls++
            }).pipe(
              Effect.andThen(Deferred.succeed(nextStepStarted, undefined)),
              Effect.andThen(Effect.never),
            )
        })
      })

      const parentShell = yield* executeTool(registry, {
        sessionID: session.id,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-parent-bg-shell",
          name: "shell",
          input: { command: hangCommand, background: true },
        },
      })
      const parentShellID = String(parentShell.output?.jobID)
      const parentExec = yield* executeTool(registry, {
        sessionID: session.id,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-parent-bg-exec",
          name: "execute",
          input: {
            code: "for (let i = 0; i < 10; i++) { await tools.demo.loop_step({}) }",
            yield_after: 0,
          },
        },
      })
      const parentExecID = String(parentExec.output?.jobID)
      const descendant = yield* sessions.create({
        parentID: session.id,
        title: "descendant",
        agent: Agent.ID.make("reviewer"),
        model: modelRef,
      })
      const descendantShell = yield* executeTool(registry, {
        sessionID: descendant.id,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-descendant-bg-shell",
          name: "shell",
          input: { command: hangCommand, background: true },
        },
      })
      const descendantShellID = String(descendantShell.output?.jobID)
      yield* Deferred.await(nextStepStarted).pipe(Effect.timeout("5 seconds"))
      const callsBeforeRemove = toolStepCalls

      yield* sessions.remove(session.id)

      expect((yield* jobs.get(parentShellID))?.status).toBe("cancelled")
      expect((yield* jobs.get(parentExecID))?.status).toBe("cancelled")
      expect((yield* jobs.get(descendantShellID))?.status).toBe("cancelled")
      expect((yield* shell.list()).map((item) => String(item.id))).not.toContain(parentShellID)
      expect((yield* shell.list()).map((item) => String(item.id))).not.toContain(descendantShellID)
      expect(Array.from(yield* sessions.active)).toEqual([])
      expect(yield* jobs.pendingBackground).toEqual([])
      expect(toolStepCalls).toBe(callsBeforeRemove)
    }),
  )
})
