import fs from "fs/promises"
import os from "os"
import path from "path"
import type { Hooks, PluginInput } from "@opencode-ai/plugin"

type SessionState = {
  question?: string
  agent?: string
  lastRecordedMessageID?: string
}

const sessions = new Map<string, SessionState>()

function getState(sessionID: string): SessionState {
  const existing = sessions.get(sessionID)
  if (existing) return existing
  const created: SessionState = {}
  sessions.set(sessionID, created)
  return created
}

function formatDate(date: Date): string {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function formatTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${formatDate(date)} ${hours}:${minutes}`
}

function resolveMode(agent?: string): "plan" | "build" | "unknown" {
  if (agent === "plan") return "plan"
  if (agent === "build") return "build"
  return "unknown"
}

function isCommandTemplate(text: string): boolean {
  const normalized = text.trim()
  if (!normalized) return false
  const templateMarkers = [
    "Append a Q&A entry",
    "Rules:",
    "Entry format:",
    "Write or append the entry",
    "Mode: {plan|build|unknown}",
  ]
  const hits = templateMarkers.filter((marker) => normalized.includes(marker)).length
  return hits >= 3
}

function buildEntry(
  question: string,
  answer: string,
  mode: string,
  directory: string,
  timeLabel: string
): string {
  return [
    "<details>",
    `<summary>Question: ${question}</summary>`,
    "",
    `Time: ${timeLabel}`,
    `Mode: ${mode}`,
    `Directory: ${directory}`,
    `Answer: ${answer}`,
    "</details>",
  ].join("\n")
}

export async function AutoRecordPlugin(input: PluginInput): Promise<Hooks> {
  return {
    "chat.message": async (evt, output) => {
      const question = output.parts
        .filter((part) => part.type === "text" && !(part as any).ignored)
        .map((part) => (part as any).text)
        .join("\n")
        .trim()

      if (!question) return
      const normalized = question.trim()
      if (normalized.startsWith("/record")) return
      if (isCommandTemplate(normalized)) return
      const state = getState(evt.sessionID)
      state.question = question
      state.agent = evt.agent
    },
    "experimental.text.complete": async (evt, output) => {
      const state = getState(evt.sessionID)
      if (!state.question) return output
      if (state.lastRecordedMessageID === evt.messageID) return output

      const answer = output.text.trim()
      if (!answer) return output

      const now = new Date()
      const date = formatDate(now)
      const timeLabel = formatTime(now)
      const mode = resolveMode(state.agent)
      const baseDir = process.env.OPENCODE_RECORD_DIR || path.join(os.homedir(), "daily")
      const entry = buildEntry(state.question, answer, mode, input.directory, timeLabel)
      const filePath = path.join(baseDir, `${date}.md`)

      await fs.mkdir(baseDir, { recursive: true })
      let fileExists = true
      try {
        await fs.stat(filePath)
      } catch {
        fileExists = false
      }

      if (!fileExists) {
        const header = `# ${date}\n\n`
        await fs.writeFile(filePath, `${header}${entry}\n`, "utf8")
      } else {
        await fs.appendFile(filePath, `\n${entry}\n`, "utf8")
      }

      state.lastRecordedMessageID = evt.messageID
      return output
    },
  }
}

export default AutoRecordPlugin
