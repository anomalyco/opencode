import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import z from "zod"

export namespace PlanReview {
  const log = Log.create({ service: "plan-review" })

  export const Request = z
    .object({
      id: Identifier.schema("plan_review"),
      sessionID: Identifier.schema("session"),
      planID: Identifier.schema("plan"),
      filePath: z.string(),
      tool: z
        .object({
          messageID: z.string(),
          callID: z.string(),
        })
        .optional(),
    })
    .meta({
      ref: "PlanReviewRequest",
    })
  export type Request = z.infer<typeof Request>

  export const Result = z.discriminatedUnion("status", [
    z.object({ status: z.literal("approved") }),
    z.object({ status: z.literal("rejected"), feedback: z.string().optional() }),
  ])
  export type Result = z.infer<typeof Result>

  export const Event = {
    Requested: BusEvent.define("plan_review.requested", Request),
    Approved: BusEvent.define(
      "plan_review.approved",
      z.object({
        requestID: z.string(),
        sessionID: z.string(),
      }),
    ),
    Rejected: BusEvent.define(
      "plan_review.rejected",
      z.object({
        requestID: z.string(),
        sessionID: z.string(),
        feedback: z.string().optional(),
      }),
    ),
  }

  const state = Instance.state(async () => {
    const pending: Record<
      string,
      {
        info: Request
        resolve: (result: Result) => void
        reject: (e: any) => void
      }
    > = {}

    return {
      pending,
    }
  })

  /**
   * Request a plan review from the user.
   * This blocks until the user approves or rejects the plan.
   */
  export async function request(input: {
    sessionID: string
    planID: string
    filePath: string
    tool?: { messageID: string; callID: string }
  }): Promise<Result> {
    const s = await state()
    const id = Identifier.ascending("plan_review")

    log.info("requesting review", { id, sessionID: input.sessionID, planID: input.planID })

    return new Promise<Result>((resolve, reject) => {
      const info: Request = {
        id,
        sessionID: input.sessionID,
        planID: input.planID,
        filePath: input.filePath,
        tool: input.tool,
      }
      s.pending[id] = {
        info,
        resolve,
        reject,
      }
      Bus.publish(Event.Requested, info)
    })
  }

  /**
   * Approve a pending plan review.
   */
  export async function approve(requestID: string): Promise<void> {
    const s = await state()
    const existing = s.pending[requestID]
    if (!existing) {
      log.warn("approve for unknown request", { requestID })
      return
    }
    delete s.pending[requestID]

    log.info("approved", { requestID, sessionID: existing.info.sessionID })

    Bus.publish(Event.Approved, {
      requestID: existing.info.id,
      sessionID: existing.info.sessionID,
    })

    existing.resolve({ status: "approved" })
  }

  /**
   * Reject a pending plan review with optional feedback.
   */
  export async function reject(requestID: string, feedback?: string): Promise<void> {
    const s = await state()
    const existing = s.pending[requestID]
    if (!existing) {
      log.warn("reject for unknown request", { requestID })
      return
    }
    delete s.pending[requestID]

    log.info("rejected", { requestID, sessionID: existing.info.sessionID, feedback })

    Bus.publish(Event.Rejected, {
      requestID: existing.info.id,
      sessionID: existing.info.sessionID,
      feedback,
    })

    existing.resolve({ status: "rejected", feedback })
  }

  /**
   * List all pending review requests.
   */
  export async function list() {
    return state().then((x) => Object.values(x.pending).map((x) => x.info))
  }

  /**
   * Get a specific pending review request.
   */
  export async function getPending(requestID: string): Promise<Request | undefined> {
    const s = await state()
    return s.pending[requestID]?.info
  }

  /**
   * Get the pending review request for a session.
   */
  export async function getBySession(sessionID: string): Promise<Request | undefined> {
    const s = await state()
    const entry = Object.values(s.pending).find((x) => x.info.sessionID === sessionID)
    return entry?.info
  }

  /**
   * Get the content of a plan file for a pending review.
   */
  export async function content(requestID: string): Promise<string> {
    const pending = await getPending(requestID)
    if (!pending) throw new Error(`Plan review request not found: ${requestID}`)
    const fs = await import("fs/promises")
    return fs.readFile(pending.filePath, "utf-8")
  }
}
