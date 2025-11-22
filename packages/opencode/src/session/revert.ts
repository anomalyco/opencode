import z from "zod"
import { Identifier } from "../id/id"
import { Snapshot } from "../snapshot"
import { MessageV2 } from "./message-v2"
import { Session } from "."
import { Log } from "../util/log"
import { splitWhen } from "remeda"
import { Storage } from "../storage/storage"
import { Bus } from "../bus"
import { SessionPrompt } from "./prompt"

export namespace SessionRevert {
  const log = Log.create({ service: "session.revert" })

  export const RevertInput = z.object({
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message"),
    partID: Identifier.schema("part").optional(),
  })
  export type RevertInput = z.infer<typeof RevertInput>

  export async function revert(input: RevertInput) {
    SessionPrompt.assertNotBusy(input.sessionID)
    const all = await Session.messages({ sessionID: input.sessionID })
    let lastUser: MessageV2.User | undefined
    const session = await Session.get(input.sessionID)

    let revert: Session.Info["revert"]
    const patches: Snapshot.Patch[] = []
    for (const msg of all) {
      if (msg.info.role === "user") lastUser = msg.info
      const remaining = []
      for (const part of msg.parts) {
        if (revert) {
          if (part.type === "patch") {
            patches.push(part)
          }
          continue
        }

        if (!revert) {
          if ((msg.info.id === input.messageID && !input.partID) || part.id === input.partID) {
            // if no useful parts left in message, same as reverting whole message
            const partID = remaining.some((item) => ["text", "tool"].includes(item.type)) ? input.partID : undefined
            revert = {
              messageID: !partID && lastUser ? lastUser.id : msg.info.id,
              partID,
            }
          }
          remaining.push(part)
        }
      }
    }

    if (revert) {
      const session = await Session.get(input.sessionID)
      revert.snapshot = session.revert?.snapshot ?? (await Snapshot.track())
      await Snapshot.revert(patches)
      if (revert.snapshot) revert.diff = await Snapshot.diff(revert.snapshot)
      return Session.update(input.sessionID, (draft) => {
        draft.revert = revert
      })
    }
    return session
  }

  export async function unrevert(input: { sessionID: string }) {
    log.info("unreverting", input)
    SessionPrompt.assertNotBusy(input.sessionID)
    const session = await Session.get(input.sessionID)
    if (!session.revert) return session
    if (session.revert.snapshot) await Snapshot.restore(session.revert.snapshot)
    const next = await Session.update(input.sessionID, (draft) => {
      draft.revert = undefined
    })
    return next
  }

  export async function cleanup(session: Session.Info) {
    if (!session.revert) return
    const sessionID = session.id
    let msgs = await Session.messages({ sessionID })
    const messageID = session.revert.messageID
    const [preserve, remove] = splitWhen(msgs, (x) => x.info.id === messageID)
    msgs = preserve
    for (const msg of remove) {
      await Storage.remove(["message", sessionID, msg.info.id])
      await Bus.publish(MessageV2.Event.Removed, { sessionID: sessionID, messageID: msg.info.id })
    }
    const last = preserve.at(-1)
    if (session.revert.partID && last) {
      const partID = session.revert.partID
      const [preserveParts, removeParts] = splitWhen(last.parts, (x) => x.id === partID)
      last.parts = preserveParts
      for (const part of removeParts) {
        await Storage.remove(["part", last.info.id, part.id])
        await Bus.publish(MessageV2.Event.PartRemoved, {
          sessionID: sessionID,
          messageID: last.info.id,
          partID: part.id,
        })
      }
    }
    await Session.update(sessionID, (draft) => {
      draft.revert = undefined
    })
  }
}
