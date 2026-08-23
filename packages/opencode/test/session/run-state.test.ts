import { afterEach, describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { BackgroundJob } from "@/background/job"
import { SessionID } from "@/session/schema"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { EventV2Bridge } from "@/event-v2-bridge"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await disposeAllInstances()
})

const layer = () =>
  LayerNode.compile(LayerNode.group([BackgroundJob.node, EventV2Bridge.node, SessionRunState.node, SessionStatus.node]))

const it = testEffect(layer())

const startJob = Effect.fn("RunStateTest.startJob")(function* (sessionID: SessionID) {
  const jobs = yield* BackgroundJob.Service
  return yield* jobs.start({
    type: "test",
    metadata: { sessionId: sessionID },
    run: Effect.never,
  })
})

describe("SessionRunState.cancel", () => {
  it.instance("cancels matching background jobs by default", () =>
    Effect.gen(function* () {
      const state = yield* SessionRunState.Service
      const jobs = yield* BackgroundJob.Service
      const sessionID = SessionID.make("ses_runstate_default")

      const job = yield* startJob(sessionID)
      expect((yield* jobs.get(job.id))?.status).toBe("running")

      yield* state.cancel(sessionID)
      expect((yield* jobs.get(job.id))?.status).toBe("cancelled")
    }),
  )

  it.instance("background=keep leaves background jobs running", () =>
    Effect.gen(function* () {
      const state = yield* SessionRunState.Service
      const jobs = yield* BackgroundJob.Service
      const sessionID = SessionID.make("ses_runstate_keep")

      const job = yield* startJob(sessionID)
      expect((yield* jobs.get(job.id))?.status).toBe("running")

      yield* state.cancel(sessionID, { background: "keep" })
      expect((yield* jobs.get(job.id))?.status).toBe("running")
    }),
  )
})
