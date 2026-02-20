import { fn } from "@/util/fn"
import z from "zod"
import { Session } from "."

import { MessageV2 } from "./message-v2"
import { Identifier } from "@/id/id"
import { Snapshot } from "@/snapshot"

import { Storage } from "@/storage/storage"
import { Bus } from "@/bus"

export namespace SessionSummary {
  const syncGit = new Set(["pull", "fetch", "switch", "checkout", "merge", "rebase", "reset", "restore"])
  const readGit = new Set([
    "status",
    "branch",
    "log",
    "show",
    "diff",
    "rev-parse",
    "remote",
    "symbolic-ref",
    "for-each-ref",
    "ls-remote",
  ])
  const readTool = new Set([
    "read",
    "glob",
    "grep",
    "ls",
    "question",
    "webfetch",
    "websearch",
    "codesearch",
    "skill",
    "todowrite",
    "todoread",
    "plan_enter",
    "plan_exit",
    "lsp",
  ])
  const gitFlagsWithValue = new Set([
    "-C",
    "-c",
    "--git-dir",
    "--work-tree",
    "--namespace",
    "--super-prefix",
    "--config-env",
    "--exec-path",
  ])

  type Step = {
    from: string
    to: string
    sync: boolean
  }

  function unquoteGitPath(input: string) {
    if (!input.startsWith('"')) return input
    if (!input.endsWith('"')) return input
    const body = input.slice(1, -1)
    const bytes: number[] = []

    for (let i = 0; i < body.length; i++) {
      const char = body[i]!
      if (char !== "\\") {
        bytes.push(char.charCodeAt(0))
        continue
      }

      const next = body[i + 1]
      if (!next) {
        bytes.push("\\".charCodeAt(0))
        continue
      }

      if (next >= "0" && next <= "7") {
        const chunk = body.slice(i + 1, i + 4)
        const match = chunk.match(/^[0-7]{1,3}/)
        if (!match) {
          bytes.push(next.charCodeAt(0))
          i++
          continue
        }
        bytes.push(parseInt(match[0], 8))
        i += match[0].length
        continue
      }

      const escaped =
        next === "n"
          ? "\n"
          : next === "r"
            ? "\r"
            : next === "t"
              ? "\t"
              : next === "b"
                ? "\b"
                : next === "f"
                  ? "\f"
                  : next === "v"
                    ? "\v"
                    : next === "\\" || next === '"'
                      ? next
                      : undefined

      bytes.push((escaped ?? next).charCodeAt(0))
      i++
    }

    return Buffer.from(bytes).toString()
  }

  function words(input: string) {
    return input
      .split(/\s+/)
      .map((x) => x.trim())
      .filter(Boolean)
  }

  function commandParts(input: string) {
    return input
      .split(/&&|\|\||;|\n/)
      .map((x) => x.trim())
      .filter(Boolean)
  }

  function isGitBinary(input: string) {
    return /(^|[\\/])git(\.exe)?$/i.test(input)
  }

  function gitSubcommand(input: string) {
    const list = words(input.replace(/^[()]+|[()]+$/g, ""))
    if (!list.length) return

    let i = 0
    while (i < list.length && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(list[i]!)) i++
    while (i < list.length && (list[i] === "env" || list[i] === "command" || list[i] === "sudo")) i++
    if (!list[i]) return
    if (!isGitBinary(list[i]!)) return
    i++

    while (i < list.length) {
      const token = list[i]!
      if (token === "--") {
        i++
        break
      }
      if (!token.startsWith("-")) break
      if (token.includes("=")) {
        i++
        continue
      }
      if (gitFlagsWithValue.has(token)) {
        i += 2
        continue
      }
      i++
    }

    const sub = list[i]
    if (!sub) return
    return sub.toLowerCase()
  }

  function gitCommand(input: string) {
    const list = commandParts(input)
    if (!list.length) return

    let sync = false
    for (const item of list) {
      const sub = gitSubcommand(item)
      if (!sub) return
      if (syncGit.has(sub)) {
        sync = true
        continue
      }
      if (readGit.has(sub)) continue
      return
    }

    return sync ? "sync" : "read"
  }

  export function isGitSyncBashCommand(input: string) {
    return gitCommand(input) === "sync"
  }

  function bashCommand(input: MessageV2.ToolPart) {
    if (input.tool !== "bash") return
    const command = input.state.input.command
    if (typeof command !== "string") return
    return command
  }

  function isSyncStep(input: MessageV2.ToolPart[]) {
    if (!input.length) return false
    let sync = false

    for (const part of input) {
      if (part.tool === "bash") {
        const command = bashCommand(part)
        if (!command) return false
        const git = gitCommand(command)
        if (!git) return false
        if (git === "sync") sync = true
        continue
      }
      if (readTool.has(part.tool)) continue
      return false
    }

    return sync
  }

  function steps(input: MessageV2.WithParts[]) {
    const result: Step[] = []

    for (const msg of input) {
      if (msg.info.role !== "assistant") continue
      let from: string | undefined
      const tools: MessageV2.ToolPart[] = []

      for (const part of msg.parts) {
        if (part.type === "step-start") {
          from = part.snapshot
          tools.length = 0
          continue
        }
        if (!from) continue
        if (part.type === "tool") {
          tools.push(part)
          continue
        }
        if (part.type !== "step-finish") continue
        if (part.snapshot) {
          result.push({
            from,
            to: part.snapshot,
            sync: isSyncStep(tools),
          })
        }
        from = undefined
        tools.length = 0
      }
    }

    return result
  }

  export function diffWindow(input: { messages: MessageV2.WithParts[] }) {
    const all = steps(input.messages)
    if (!all.length) return

    const local = all.map((step, index) => ({ step, index })).filter((item) => !item.step.sync)
    if (!local.length) return

    const end = local[local.length - 1]!.index
    let boundary = -1
    for (let i = end - 1; i >= 0; i--) {
      if (!all[i]!.sync) continue
      boundary = i
      break
    }

    let start = -1
    for (let i = boundary + 1; i <= end; i++) {
      if (all[i]!.sync) continue
      start = i
      break
    }
    if (start < 0) return

    return {
      from: all[start]!.from,
      to: all[end]!.to,
    }
  }

  export const summarize = fn(
    z.object({
      sessionID: z.string(),
      messageID: z.string(),
    }),
    async (input) => {
      const all = await Session.messages({ sessionID: input.sessionID })
      await Promise.all([
        summarizeSession({ sessionID: input.sessionID, messages: all }),
        summarizeMessage({ messageID: input.messageID, messages: all }),
      ])
    },
  )

  async function summarizeSession(input: { sessionID: string; messages: MessageV2.WithParts[] }) {
    const diffs = await computeDiff({ messages: input.messages })
    await Session.setSummary({
      sessionID: input.sessionID,
      summary: {
        additions: diffs.reduce((sum, x) => sum + x.additions, 0),
        deletions: diffs.reduce((sum, x) => sum + x.deletions, 0),
        files: diffs.length,
      },
    })
    await Storage.write(["session_diff", input.sessionID], diffs)
    Bus.publish(Session.Event.Diff, {
      sessionID: input.sessionID,
      diff: diffs,
    })
  }

  async function summarizeMessage(input: { messageID: string; messages: MessageV2.WithParts[] }) {
    const messages = input.messages.filter(
      (m) => m.info.id === input.messageID || (m.info.role === "assistant" && m.info.parentID === input.messageID),
    )
    const msgWithParts = messages.find((m) => m.info.id === input.messageID)!
    const userMsg = msgWithParts.info as MessageV2.User
    const diffs = await computeDiff({ messages })
    userMsg.summary = {
      ...userMsg.summary,
      diffs,
    }
    await Session.updateMessage(userMsg)
  }

  export const diff = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message").optional(),
    }),
    async (input) => {
      const diffs = await Storage.read<Snapshot.FileDiff[]>(["session_diff", input.sessionID]).catch(() => [])
      const next = diffs.map((item) => {
        const file = unquoteGitPath(item.file)
        if (file === item.file) return item
        return {
          ...item,
          file,
        }
      })
      const changed = next.some((item, i) => item.file !== diffs[i]?.file)
      if (changed) Storage.write(["session_diff", input.sessionID], next).catch(() => {})
      return next
    },
  )

  export async function computeDiff(input: { messages: MessageV2.WithParts[] }) {
    const window = diffWindow(input)
    if (window) return Snapshot.diffFull(window.from, window.to)
    return []
  }
}
