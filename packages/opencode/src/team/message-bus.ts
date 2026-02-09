import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Identifier } from "@/id/id"
import { Storage } from "@/storage/storage"
import { Log } from "@/util/log"

export namespace TeamMessageBus {
  const log = Log.create({ service: "team.message-bus" })

  export const Message = z
    .object({
      id: z.string(),
      teamID: z.string(),
      from: z.string(),
      to: z.string(),
      content: z.string(),
      time: z.number(),
    })
    .meta({ ref: "TeamMessage" })
  export type Message = z.infer<typeof Message>

  export const Event = {
    Sent: BusEvent.define(
      "team.message.sent",
      z.object({
        teamID: z.string(),
        message: Message,
      }),
    ),
  }

  export async function send(input: { teamID: string; from: string; to: string; content: string }) {
    const msg: Message = {
      id: Identifier.ascending("team_message"),
      teamID: input.teamID,
      from: input.from,
      to: input.to,
      content: input.content,
      time: Date.now(),
    }

    const messages = await list(input.teamID)
    messages.push(msg)
    await Storage.write(["team_messages", input.teamID], messages)

    log.info("message sent", { teamID: input.teamID, from: input.from, to: input.to })
    Bus.publish(Event.Sent, { teamID: input.teamID, message: msg })
    return msg
  }

  export async function list(teamID: string) {
    return Storage.read<Message[]>(["team_messages", teamID])
      .then((x) => x || [])
      .catch(() => [])
  }

  export async function forRecipient(teamID: string, recipientID: string) {
    const all = await list(teamID)
    return all.filter((m) => m.to === recipientID || m.to === "all")
  }

  export async function between(teamID: string, a: string, b: string) {
    const all = await list(teamID)
    return all.filter(
      (m) => (m.from === a && m.to === b) || (m.from === b && m.to === a) || m.to === "all",
    )
  }
}
