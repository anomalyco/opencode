import { Provider } from "@/provider/provider"

import { fn } from "@/util/fn"
import z from "zod"
import { Session } from "."

import { MessageV2 } from "./message-v2"
import { Identifier } from "@/id/id"
import { Snapshot } from "@/snapshot"

import { Log } from "@/util/log"
import path from "path"
import { Instance } from "@/project/instance"
import { Storage } from "@/storage/storage"
import { Bus } from "@/bus"

import { LLM } from "./llm"
import { Agent } from "@/agent/agent"
import { FileTracking } from "./file-tracking"

export namespace SessionSummary {
  const log = Log.create({ service: "session.summary" })

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
    // Get files modified by patch operations (edit/write/patch tools)
    const patchedFiles = new Set(
      input.messages
        .flatMap((x) => x.parts)
        .filter((x) => x.type === "patch")
        .flatMap((x) => x.files)
        .map((x) => path.relative(Instance.worktree, x)),
    )

    // Compute files modified by git operations by looking at gitHead changes between steps
    // This detects both internal (via bash tool) and external (user's terminal) git operations
    const gitModifiedFromHeads = await computeGitModifiedFiles({ messages: input.messages })

    // Also include files tracked via the bash tool (for immediate detection during the session)
    const gitModifiedFromTracking = FileTracking.getGitModified(input.sessionID)

    // Combine both sources of git-modified files
    const gitModifiedRelative = new Set([
      ...gitModifiedFromHeads,
      ...Array.from(gitModifiedFromTracking).map((x) => path.relative(Instance.worktree, x)),
    ])

    const diffs = await computeDiff({ messages: input.messages }).then((x) =>
      x.filter((diff) => {
        // Include file if it was patched by a tool AND not modified by a git operation
        // This allows user external edits to show (they appear in snapshot diff but NOT in gitModifiedFiles)
        // while excluding files pulled in by git operations
        if (gitModifiedRelative.has(diff.file)) {
          // File was modified by git - only include if also explicitly patched by a tool
          // This handles the case where user does `git pull` then edits a file that was in the pull
          return patchedFiles.has(diff.file)
        }
        // File was not modified by git - include if it was in a patch
        return patchedFiles.has(diff.file)
      }),
    )
    await Session.update(input.sessionID, (draft) => {
      draft.summary = {
        additions: diffs.reduce((sum, x) => sum + x.additions, 0),
        deletions: diffs.reduce((sum, x) => sum + x.deletions, 0),
        files: diffs.length,
      }
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

    const textPart = msgWithParts.parts.find((p) => p.type === "text" && !p.synthetic) as MessageV2.TextPart
    if (textPart && !userMsg.summary?.title) {
      const agent = await Agent.get("title")
      const stream = await LLM.stream({
        agent,
        user: userMsg,
        tools: {},
        model: agent.model
          ? await Provider.getModel(agent.model.providerID, agent.model.modelID)
          : ((await Provider.getSmallModel(userMsg.model.providerID)) ??
            (await Provider.getModel(userMsg.model.providerID, userMsg.model.modelID))),
        small: true,
        messages: [
          {
            role: "user" as const,
            content: `
              The following is the text to summarize:
              <text>
              ${textPart?.text ?? ""}
              </text>
            `,
          },
        ],
        abort: new AbortController().signal,
        sessionID: userMsg.sessionID,
        system: [],
        retries: 3,
      })
      const result = await stream.text
      log.info("title", { title: result })
      userMsg.summary.title = result
      await Session.updateMessage(userMsg)
    }
  }

  export const diff = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message").optional(),
    }),
    async (input) => {
      return Storage.read<Snapshot.FileDiff[]>(["session_diff", input.sessionID]).catch(() => [])
    },
  )

  async function computeDiff(input: { messages: MessageV2.WithParts[] }) {
    let from: string | undefined
    let to: string | undefined

    // scan assistant messages to find earliest from and latest to
    // snapshot
    for (const item of input.messages) {
      if (!from) {
        for (const part of item.parts) {
          if (part.type === "step-start" && part.snapshot) {
            from = part.snapshot
            break
          }
        }
      }

      for (const part of item.parts) {
        if (part.type === "step-finish" && part.snapshot) {
          to = part.snapshot
          break
        }
      }
    }

    if (from && to) return Snapshot.diffFull(from, to)
    return []
  }

  /**
   * Compute files that were modified by git operations (pull, merge, checkout, etc.)
   * by comparing gitHead values between step-start and step-finish parts.
   * This detects both internal (via bash tool) and external (user's terminal) git operations.
   */
  async function computeGitModifiedFiles(input: { messages: MessageV2.WithParts[] }): Promise<string[]> {
    const allGitModified: string[] = []

    // Find pairs of step-start and step-finish to detect git HEAD changes
    for (const msg of input.messages) {
      let stepStartHead: string | undefined

      for (const part of msg.parts) {
        if (part.type === "step-start" && part.gitHead) {
          stepStartHead = part.gitHead
        }
        if (part.type === "step-finish" && part.gitHead && stepStartHead) {
          // If HEAD changed between step-start and step-finish, get the changed files
          if (stepStartHead !== part.gitHead) {
            const files = await Snapshot.getProjectChangedFiles(stepStartHead, part.gitHead)
            allGitModified.push(...files)
            log.info("detected git HEAD change", {
              from: stepStartHead.slice(0, 8),
              to: part.gitHead.slice(0, 8),
              files: files.length,
            })
          }
          stepStartHead = undefined
        }
      }
    }

    return allGitModified
  }
}
