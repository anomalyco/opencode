import z from "zod"
import { Identifier } from "../id/id"
import { Snapshot } from "../snapshot"
import { MessageV2 } from "./message-v2"
import { Session } from "."
import { Log } from "../util/log"
import { Database, eq } from "../storage/db"
import { MessageTable, PartTable } from "./session.sql"
import { Storage } from "@/storage/storage"
import { Bus } from "../bus"
import { SessionPrompt } from "./prompt"
import { SessionSummary } from "./summary"

export namespace SessionRevert {
  const log = Log.create({ service: "session.revert" })

  export const RevertInput = z.object({
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message"),
    partID: Identifier.schema("part").optional(),
    mode: z.enum(["conversation", "conversation_and_code"]).optional(),
  })
  export type RevertInput = z.infer<typeof RevertInput>

  export async function revert(input: RevertInput) {
    SessionPrompt.assertNotBusy(input.sessionID)
    const all = await Session.messages({ sessionID: input.sessionID })
    let lastUser: MessageV2.User | undefined
    const session = await Session.get(input.sessionID)

    const mode = input.mode ?? session.revert?.mode ?? "conversation_and_code"
    let next: Session.Info["revert"]
    const patches: Snapshot.Patch[] = []
    for (const msg of all) {
      if (msg.info.role === "user") lastUser = msg.info
      const remaining = []
      for (const part of msg.parts) {
        if (next) {
          if (part.type === "patch") {
            patches.push(part)
          }
          continue
        }

        if (!next) {
          if ((msg.info.id === input.messageID && !input.partID) || part.id === input.partID) {
            // if no useful parts left in message, same as reverting whole message
            const partID = remaining.some((item) => ["text", "tool"].includes(item.type)) ? input.partID : undefined
            next = {
              messageID: !partID && lastUser ? lastUser.id : msg.info.id,
              partID,
            }
          }
          remaining.push(part)
        }
      }
    }

    if (!next) return session

    const range = all.filter((msg) => msg.info.id >= next.messageID)
    const diffs = await SessionSummary.computeDiff({ messages: range })
    const summary = {
      additions: diffs.reduce((sum, x) => sum + x.additions, 0),
      deletions: diffs.reduce((sum, x) => sum + x.deletions, 0),
      files: diffs.length,
    }

    const pts = session.revert?.points ?? []
    const idx = session.revert?.index ?? pts.length - 1
    const hit = pts.findIndex((item) => item.messageID === next!.messageID && item.partID === next!.partID)

    if (hit >= 0) {
      const point = pts[hit]
      if (point?.snapshot) await Snapshot.restore(point.snapshot)
      if (point?.mode === "conversation_and_code") {
        await Storage.write(["session_diff", input.sessionID], diffs)
        Bus.publish(Session.Event.Diff, {
          sessionID: input.sessionID,
          diff: diffs,
        })
      }
      return Session.setRevert({
        sessionID: input.sessionID,
        revert: {
          ...next,
          snapshot: session.revert?.snapshot,
          mode: point?.mode ?? mode,
          points: pts,
          index: hit,
        },
        summary,
      })
    }

    const root = session.revert?.snapshot ?? (await Snapshot.track())
    const keep = idx >= 0 ? pts.slice(0, idx + 1) : []

    if (mode === "conversation") {
      const point = {
        ...next,
        mode,
        snapshot: await Snapshot.track(),
      }
      const points = [...keep, point]
      return Session.setRevert({
        sessionID: input.sessionID,
        revert: {
          ...next,
          snapshot: root,
          mode,
          points,
          index: points.length - 1,
        },
        summary,
      })
    }

    await Snapshot.revert(patches)
    const point = {
      ...next,
      mode,
      snapshot: await Snapshot.track(),
    }
    const points = [...keep, point]
    const revert = {
      ...next,
      snapshot: root,
      mode,
      points,
      index: points.length - 1,
      diff: root ? await Snapshot.diff(root) : undefined,
    }
    await Storage.write(["session_diff", input.sessionID], diffs)
    Bus.publish(Session.Event.Diff, {
      sessionID: input.sessionID,
      diff: diffs,
    })
    return Session.setRevert({
      sessionID: input.sessionID,
      revert,
      summary,
    })
  }

  export async function unrevert(input: { sessionID: string }) {
    log.info("unreverting", input)
    SessionPrompt.assertNotBusy(input.sessionID)
    const session = await Session.get(input.sessionID)
    if (!session.revert) return session
    if (session.revert.snapshot) await Snapshot.restore(session.revert.snapshot)
    return Session.clearRevert(input.sessionID)
  }

  export async function cleanup(session: Session.Info) {
    if (!session.revert) return
    const sessionID = session.id
    const msgs = await Session.messages({ sessionID })
    const messageID = session.revert.messageID
    const preserve = [] as MessageV2.WithParts[]
    const remove = [] as MessageV2.WithParts[]
    let target: MessageV2.WithParts | undefined
    for (const msg of msgs) {
      if (msg.info.id < messageID) {
        preserve.push(msg)
        continue
      }
      if (msg.info.id > messageID) {
        remove.push(msg)
        continue
      }
      if (session.revert.partID) {
        preserve.push(msg)
        target = msg
        continue
      }
      remove.push(msg)
    }
    for (const msg of remove) {
      Database.use((db) => db.delete(MessageTable).where(eq(MessageTable.id, msg.info.id)).run())
      await Bus.publish(MessageV2.Event.Removed, { sessionID: sessionID, messageID: msg.info.id })
    }
    if (session.revert.partID && target) {
      const partID = session.revert.partID
      const removeStart = target.parts.findIndex((part) => part.id === partID)
      if (removeStart >= 0) {
        const preserveParts = target.parts.slice(0, removeStart)
        const removeParts = target.parts.slice(removeStart)
        target.parts = preserveParts
        for (const part of removeParts) {
          Database.use((db) => db.delete(PartTable).where(eq(PartTable.id, part.id)).run())
          await Bus.publish(MessageV2.Event.PartRemoved, {
            sessionID: sessionID,
            messageID: target.info.id,
            partID: part.id,
          })
        }
      }
    }
    await Session.clearRevert(sessionID)
  }
}
