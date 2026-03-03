import { Log } from "../util/log"
import { Lock } from "../util/lock"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { Bus } from "../bus"
import { TeamEvent } from "./events"
import path from "path"
import fs from "fs/promises"

const log = Log.create({ service: "team.inbox" })

export interface InboxMessage {
  id: string
  from: string
  text: string
  timestamp: number
  read: boolean
}

/** Resolve the JSONL file path for an agent's inbox */
function filepath(teamName: string, agentName: string): string {
  return path.join(Global.Path.data, "storage", "team_inbox", Instance.project.id, teamName, agentName + ".jsonl")
}

/** Parse a JSONL file into an array of InboxMessage */
function parse(content: string): InboxMessage[] {
  if (!content.trim()) return []
  return content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as InboxMessage)
}

export namespace Inbox {
  /**
   * Write a message to an agent's inbox.
   * Appends a single JSON line — O(1), no read-modify-write.
   */
  export async function write(teamName: string, to: string, message: Omit<InboxMessage, "read">): Promise<void> {
    const target = filepath(teamName, to)
    using _ = await Lock.write(target)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.appendFile(target, JSON.stringify({ ...message, read: false }) + "\n")
    log.info("inbox write", { teamName, to, from: message.from, id: message.id })
  }

  /**
   * Read all unread messages from an agent's inbox.
   */
  export async function unread(teamName: string, agentName: string): Promise<InboxMessage[]> {
    const target = filepath(teamName, agentName)
    using _ = await Lock.read(target)
    const content = await Bun.file(target)
      .text()
      .catch(() => "")
    return parse(content).filter((m) => !m.read)
  }

  /**
   * Read all messages (read and unread) from an agent's inbox.
   */
  export async function all(teamName: string, agentName: string): Promise<InboxMessage[]> {
    const target = filepath(teamName, agentName)
    using _ = await Lock.read(target)
    const content = await Bun.file(target)
      .text()
      .catch(() => "")
    return parse(content)
  }

  /**
   * Mark all unread messages as read for an agent.
   * Returns the newly-read messages so callers can send delivery receipts.
   * Publishes TeamEvent.MessageRead with the count.
   *
   * This is the only operation that rewrites the entire file.
   */
  export async function markRead(teamName: string, agentName: string): Promise<InboxMessage[]> {
    const target = filepath(teamName, agentName)
    using _ = await Lock.write(target)
    const content = await Bun.file(target)
      .text()
      .catch(() => "")
    const messages = parse(content)
    const read: InboxMessage[] = []
    for (const msg of messages) {
      if (msg.read) continue
      msg.read = true
      read.push({ ...msg })
    }
    if (read.length === 0) return []
    // Rewrite entire file with updated read flags
    await Bun.write(target, messages.map((m) => JSON.stringify(m)).join("\n") + "\n")
    log.info("inbox marked read", { teamName, agentName, count: read.length })
    await Bus.publish(TeamEvent.MessageRead, { teamName, agentName, count: read.length })
    return read
  }

  /**
   * Remove an agent's inbox entirely.
   */
  export async function remove(teamName: string, agentName: string): Promise<void> {
    const target = filepath(teamName, agentName)
    await fs.unlink(target).catch(() => {})
  }

  /**
   * Remove all inboxes for a team.
   */
  export async function removeAll(teamName: string, agentNames: string[]): Promise<void> {
    for (const name of agentNames) {
      await remove(teamName, name)
    }
    // Also remove the lead inbox
    await remove(teamName, "lead")
  }
}
