import { describe, expect } from "bun:test"
import { Deferred, Effect } from "effect"
import { Job } from "@opencode/core/job"
import { SessionSchema } from "@opencode/core/session/schema"
import { testEffect } from "./lib/effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Database } from "@opencode/core/database/database"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Job.node, Database.node, Global.node])))

describe("Job.background on settled work", () => {
  it.live("does not hand a settled job back as a background handoff", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const latch = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        id: "job_settled_move",
        type: "shell",
        recovery: {
          kind: "shell",
          sessionID: SessionSchema.ID.make("ses_settled_move"),
          shellID: "job_settled_move",
          command: "exit 7",
        },
        run: Deferred.await(latch).pipe(Effect.as("done")),
      })

      // The command finishes between the timeout firing and the move.
      yield* Deferred.succeed(latch, undefined)
      yield* Effect.sleep("50 millis")

      const info = yield* jobs.background(job.id)
      // The caller reads a finished job, not a running one it would wait on forever.
      expect(info).toMatchObject({ id: job.id, status: "completed", output: "done" })
      // Nothing is left pending for it: the settlement already reported this work.
      expect(yield* jobs.pendingBackground).toEqual([])
    }),
  )
})
