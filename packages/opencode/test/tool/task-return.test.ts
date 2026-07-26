import { afterEach, describe, expect } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { Session } from "@/session/session"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { Agent } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Config } from "@/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Interrupt } from "../../src/session/interrupt"
import { Messaging } from "../../src/messaging"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Truncate } from "@/tool/truncate"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EffectBridge } from "@/effect/bridge"
import { MessageID, SessionID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"
import { disposeAllInstances } from "../fixture/fixture"
import { TaskReturnTool } from "../../src/tool/task-return"
import { TASK_RETURN_MAX_BYTES } from "../../src/tool/task-return"

afterEach(async () => {
  await disposeAllInstances()
})

const layer = (flags: Partial<RuntimeFlags.Info> = {}) =>
  LayerNode.compile(
    LayerNode.group([
      Agent.node,
      BackgroundJob.node,
      EventV2Bridge.node,
      Config.node,
      CrossSpawnSpawner.node,
      Session.node,
      SessionProjector.node,
      SessionRunState.node,
      SessionStatus.node,
      Truncate.node,
      Interrupt.node,
      Database.node,
      Messaging.node,
      RuntimeFlags.node,
      Ripgrep.node,
    ]),
    [[RuntimeFlags.node, RuntimeFlags.layer(flags)]],
  )

const withRipgrep = (flags: Partial<RuntimeFlags.Info> = {}) => layer(flags)
const it = testEffect(withRipgrep())

function ctxFor(sessionID: SessionID) {
  return {
    sessionID,
    messageID: MessageID.ascending(),
    agent: "build",
    abort: new AbortController().signal,
    messages: [],
    metadata: () => Effect.void,
    ask: () => Effect.void,
  }
}

describe("tool.task_return", () => {
  it.instance("stores result on own session row", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const parent = yield* sessions.create({})
      const child = yield* sessions.create({ parentID: parent.id })
      const tool = yield* TaskReturnTool
      const def = yield* tool.init()

      const params = { result: { verdict: "APPROVE" } }
      const out = yield* def.execute(params, ctxFor(child.id))
      const read = yield* sessions.get(child.id)
      expect(read.result).toEqual(params.result)
      expect(out.output).toEqual(JSON.stringify(params.result, null, 2))
      expect(out.metadata.result).toEqual(params.result)
    }),
  )

  it.instance("on a root session is a warning no-op", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const root = yield* sessions.create({})
      const tool = yield* TaskReturnTool
      const def = yield* tool.init()

      const out = yield* def.execute({ result: { nope: true } }, ctxFor(root.id))
      const read = yield* sessions.get(root.id)
      expect(read.result).toBeUndefined()
      expect(out.output).toContain("no parent")
    }),
  )

  it.instance("rejects oversized payloads", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const parent = yield* sessions.create({})
      const child = yield* sessions.create({ parentID: parent.id })
      const tool = yield* TaskReturnTool
      const def = yield* tool.init()

      const bigValue = "x".repeat(5000)
      const result = { data: bigValue }

      const exit = yield* def.execute({ result }, ctxFor(child.id)).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      const read = yield* sessions.get(child.id)
      expect(read.result).toBeUndefined()
    }),
  )

  it.instance("oversize result error is surfaceable through the tool bridge", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const parent = yield* sessions.create({})
      const child = yield* sessions.create({ parentID: parent.id })
      const tool = yield* TaskReturnTool
      const def = yield* tool.init()
      const bridge = yield* EffectBridge.make()

      const bigValue = "x".repeat(5000)

      // Mirror the tools.ts path: run.promise(Effect.gen(...)).
      // The Effect.die inside task_return surfaces as a Promise rejection,
      // which native-runtime.ts catches as ToolFailure and ToolRuntime.dispatch
      // emits as tool-error + error tool-result events to the model.
      const exit = yield* Effect.tryPromise({
        try: () => bridge.promise(def.execute({ result: { data: bigValue } }, ctxFor(child.id))),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      }).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const errors = Cause.prettyErrors(exit.cause)
        expect(errors.length).toBeGreaterThan(0)
        expect(errors[0]!.message).toMatch(/result is \d+ bytes; cap is 4096/)
      }

      // Drain is alive: the guard died before setResult, row is untouched.
      // A subsequent session read succeeds — proving the fiber did not crash.
      const read = yield* sessions.get(child.id)
      expect(read.result).toBeUndefined()
    }),
  )
})
