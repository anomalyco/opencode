// fm-primary-learning.js — auto-capture plugin for the opencode learning system.
//
// Hooks session.idle at turn end (same event the watcher and turnend-guard
// plugins use; this plugin only reads, never prompts, so it cannot conflict).
// Classifies what happened in the finished session and writes candidates to
// ~/.agents/learning-staging/{skills,memory}. Never writes to the live skill
// library — promotion happens only on captain approval via /learn-review.
//
// Also injects durable memory facts (~/.agents/memory/facts.md) into the first
// user prompt of a new session, following the sessionstart-nudge pattern.
//
// MIT — self-contained, no opencode core changes.

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { FmLearning } from "../learning/fm-learning-core.js"

const capturedSessions = new Set()
const nudgedSessions = new Set()

function memoryFacts() {
  const file = FmLearning.liveMemory()
  if (!existsSync(file)) return ""
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .join("\n")
}

export const FmPrimaryLearning = async ({ client }) => {
  return {
    event: async ({ event }) => {
      if (event.type === "session.created") {
        const sessionID = event.properties?.info?.id ?? event.properties?.sessionID
        if (!sessionID || nudgedSessions.has(sessionID)) return
        nudgedSessions.add(sessionID)
        const facts = memoryFacts()
        if (!facts) return
        try {
          await client.session.promptAsync({
            path: { id: sessionID },
            body: {
              parts: [
                {
                  type: "text",
                  text: `Durable facts about the captain (from ~/.agents/memory/facts.md):\n\n${facts}\n\nUse them when relevant; do not repeat them back.`,
                },
              ],
            },
          })
        } catch {
          // Injection is best-effort; never break session start.
        }
        return
      }

      if (event.type !== "session.idle") return
      const sessionID = event.properties?.sessionID
      if (!sessionID || capturedSessions.has(sessionID)) return
      capturedSessions.add(sessionID)

      try {
        const result = await client.session.messages({ path: { id: sessionID } })
        const messages = result?.data ?? result
        if (!Array.isArray(messages) || messages.length === 0) return

        const session = await client.session.get({ path: { id: sessionID } }).catch(() => null)
        const info = session?.data ?? session

        FmLearning.ensureDirs()
        const { skills, memory } = FmLearning.classifySession({ messages, session: info })
        for (const candidate of skills) {
          FmLearning.writeJson(
            join(FmLearning.stagingSkills(), `${candidate.name}.json`),
            candidate,
          )
        }
        for (const candidate of memory) {
          FmLearning.writeJson(
            join(FmLearning.stagingMemory(), `${candidate.name}.json`),
            candidate,
          )
        }
      } catch {
        // Capture is best-effort; never break the turn.
      }
    },
  }
}
