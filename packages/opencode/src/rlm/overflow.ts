/**
 * RLM Overflow — ask/reply dialog for context overflow.
 *
 * When the conversation context exceeds the model's window, instead of
 * auto-compacting we block and ask the user: "Compact" or "Switch to RLM".
 * Follows the same blocking-promise pattern as the Question system.
 */

import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import z from "zod"

const log = Log.create({ service: "rlm-overflow" })

export type OverflowChoice = "compact" | "rlm"

export const Request = z
  .object({
    id: z.string(),
    sessionID: z.string(),
  })
  .meta({ ref: "RLMOverflowRequest" })
export type Request = z.infer<typeof Request>

export const Event = {
  Asked: BusEvent.define("rlm.overflow.asked", Request),
  Replied: BusEvent.define(
    "rlm.overflow.replied",
    z.object({
      sessionID: z.string(),
      requestID: z.string(),
      choice: z.enum(["compact", "rlm"]),
    }),
  ),
}

const state = Instance.state(async () => {
  const pending: Record<
    string,
    {
      info: Request
      resolve: (choice: OverflowChoice) => void
    }
  > = {}
  return { pending }
})

/**
 * Ask the user to choose between compaction and RLM mode.
 * Blocks until the user replies via the TUI.
 */
export async function ask(sessionID: string): Promise<OverflowChoice> {
  const s = await state()
  const id = Identifier.ascending("rlmoverflow")

  log.info("asking", { id, sessionID })

  return new Promise<OverflowChoice>((resolve) => {
    const info: Request = { id, sessionID }
    s.pending[id] = { info, resolve }
    Bus.publish(Event.Asked, info)
  })
}

/**
 * Reply to an overflow request. Resolves the blocking promise from ask().
 */
export async function reply(input: {
  requestID: string
  choice: OverflowChoice
}): Promise<void> {
  const s = await state()
  const existing = s.pending[input.requestID]
  if (!existing) {
    log.warn("reply for unknown request", { requestID: input.requestID })
    return
  }
  delete s.pending[input.requestID]

  log.info("replied", { requestID: input.requestID, choice: input.choice })

  Bus.publish(Event.Replied, {
    sessionID: existing.info.sessionID,
    requestID: existing.info.id,
    choice: input.choice,
  })

  existing.resolve(input.choice)
}

export async function list() {
  return state().then((x) => Object.values(x.pending).map((x) => x.info))
}
