import { BusEvent } from "@/bus/bus-event"
import z from "zod"
import { Plan, WorkerState, PlanID, SubtaskID } from "./schema"

export const ParallelEvent = {
  PlanUpdated: BusEvent.define("parallel.plan.updated", z.object({ plan: Plan })),
  WorkerUpdated: BusEvent.define(
    "parallel.worker.updated",
    z.object({
      planID: PlanID.zod,
      worker: WorkerState,
    }),
  ),
  MergeProgress: BusEvent.define(
    "parallel.merge.progress",
    z.object({
      planID: PlanID.zod,
      branch: z.string(),
      result: z.enum(["clean", "resolved", "failed"]),
    }),
  ),
  WorkerTimeoutWarning: BusEvent.define(
    "parallel.worker.timeout_warning",
    z.object({
      planID: PlanID.zod,
      subtaskID: SubtaskID.zod,
      elapsedMs: z.number(),
      remainingMs: z.number(),
      timeoutMs: z.number(),
    }),
  ),
}
