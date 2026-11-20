import { describe, expect } from "bun:test"
import { Deferred, Effect } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Database } from "@opencode/core/database/database"
import { Job } from "@opencode/core/job"
import { SessionSchema } from "@opencode/core/session/schema"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { testEffect } from "./lib/effect"
import { waitUntil } from "./lib/eventually"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Job.node, Database.node, Global.node])))

describe("Job.background on settled work", () => {
  it.live("returns the settled job itself when the caller reports it, instead of marking it", () =>
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
      yield* waitUntil(jobs.get(job.id).pipe(Effect.map((info: Job.Info | undefined) => info?.status !== "running")))

      const info = yield* jobs.background(job.id, { reportSettled: true })
      // The caller reads a finished job, not a running one it would wait on forever.
      expect(info).toMatchObject({ id: job.id, status: "completed", output: "done" })
      // Nothing is left pending for it: the settlement already wrote its own row.
      expect(yield* jobs.pendingBackground).toEqual([])
    }),
  )

  it.live("still marks settled work when the caller does not report it", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const job = yield* jobs.start({
        id: "job_settled_marked",
        type: "shell",
        recovery: {
          kind: "shell",
          sessionID: SessionSchema.ID.make("ses_settled_marked"),
          shellID: "job_settled_marked",
          command: "exit 0",
        },
        run: Effect.succeed("kept"),
      })
      yield* waitUntil(jobs.get(job.id).pipe(Effect.map((info: Job.Info | undefined) => info?.status !== "running")))

      const info = yield* jobs.background(job.id)
      expect(info?.notificationID).toStartWith("msg_")
      expect(yield* jobs.pendingBackground).toMatchObject([{ id: job.id, status: "completed", output: "kept" }])
    }),
  )
})
