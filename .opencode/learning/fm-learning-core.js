// fm-learning-core.js — shared logic for the opencode learning system.
//
// The learning system auto-captures repeatable procedures and durable facts
// from finished sessions, stages them for captain approval, and promotes
// approved candidates into the live skill library and memory store.
//
// Layout (all under the captain's home, independent of firstmate's data dirs):
//   ~/.agents/learning-staging/skills/<name>.json   staged skill candidates
//   ~/.agents/learning-staging/memory/<id>.json     staged memory candidates
//   ~/.agents/skills/<name>/SKILL.md                live skills (promoted)
//   ~/.agents/memory/facts.md                       live memory (promoted)
//
// The plugin never writes to the live library directly: capture only stages.
// Promotion happens on captain approval via /learn-review.
//
// MIT — self-contained, no opencode core changes.

import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, renameSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export const DESCRIPTION_BUDGET = 200

export function learningHome() {
  return process.env.FM_LEARNING_HOME || join(homedir(), ".agents")
}

export function stagingSkills() {
  return join(learningHome(), "learning-staging", "skills")
}

export function stagingMemory() {
  return join(learningHome(), "learning-staging", "memory")
}

export function liveSkills() {
  return join(learningHome(), "skills")
}

export function liveMemory() {
  return join(learningHome(), "memory", "facts.md")
}

export function ensureDirs() {
  mkdirSync(stagingSkills(), { recursive: true })
  mkdirSync(stagingMemory(), { recursive: true })
  mkdirSync(join(learningHome(), "memory"), { recursive: true })
}

export function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "candidate"
}

export function trimDescription(description) {
  const trimmed = description.trim().replace(/\s+/g, " ")
  return trimmed.length <= DESCRIPTION_BUDGET ? trimmed : `${trimmed.slice(0, DESCRIPTION_BUDGET - 1)}…`
}

export function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"))
  } catch {
    return null
  }
}

export function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

export function listCandidates(kind) {
  const dir = kind === "memory" ? stagingMemory() : stagingSkills()
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => ({ file: join(dir, name), ...readJson(join(dir, name)) }))
      .filter((candidate) => candidate && candidate.name)
  } catch {
    return []
  }
}

export function listSkills() {
  try {
    return readdirSync(liveSkills())
      .filter((name) => existsSync(join(liveSkills(), name, "SKILL.md")))
      .map((name) => name)
  } catch {
    return []
  }
}

export function promoteSkill(candidate) {
  const dir = join(liveSkills(), candidate.name)
  mkdirSync(dir, { recursive: true })
  const description = trimDescription(candidate.description || "")
  const body = candidate.body || `# ${candidate.name}\n\n${description}\n`
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${candidate.name}\ndescription: ${description}\n---\n\n${body}\n`,
    "utf8",
  )
}

export function promoteMemory(candidate) {
  const line = `- ${candidate.fact}`
  const existing = existsSync(liveMemory()) ? readFileSync(liveMemory(), "utf8") : ""
  const lines = existing.split("\n").filter((l) => l.trim() !== "")
  if (lines.some((l) => l === line)) return
  lines.push(line)
  writeFileSync(liveMemory(), `${lines.join("\n")}\n`, "utf8")
}

export function removeCandidate(kind, name) {
  const dir = kind === "memory" ? stagingMemory() : stagingSkills()
  const file = join(dir, `${name}.json`)
  if (existsSync(file)) renameSync(file, `${file}.rejected`)
}

export function promoteCandidate(kind, name) {
  const dir = kind === "memory" ? stagingMemory() : stagingSkills()
  const file = join(dir, `${name}.json`)
  if (!existsSync(file)) return false
  const candidate = readJson(file)
  if (!candidate) return false
  if (kind === "memory") promoteMemory(candidate)
  else promoteSkill(candidate)
  renameSync(file, `${file}.promoted`)
  return true
}

// Classify a finished session into learning candidates.
// Heuristic, deliberately simple: tool calls that wrote files, committed, or
// installed things signal a repeatable procedure (skill candidate); a session
// that revealed durable facts about the captain's environment or preferences
// signals a memory candidate. Neither → nothing.
export function classifySession({ messages, session }) {
  const candidates = { skills: [], memory: [] }
  if (!Array.isArray(messages) || messages.length === 0) return candidates

  const toolNames = new Set()
  const userTexts = []
  for (const message of messages) {
    const info = message?.info
    const parts = message?.parts ?? []
    if (info?.role === "user") {
      for (const part of parts) {
        if (part?.type === "text" && !part.synthetic) userTexts.push(part.text)
      }
    }
    for (const part of parts) {
      if (part?.type === "tool" && part.tool) toolNames.add(part.tool)
    }
  }

  const wroteSomething = ["write", "edit", "patch", "commit", "install", "add", "create"].some((t) =>
    [...toolNames].some((name) => name.toLowerCase().includes(t)),
  )
  if (wroteSomething) {
    const title = session?.title || "untitled"
    candidates.skills.push({
      name: slugify(title),
      description: trimDescription(`Repeatable procedure captured from a session: ${title}`),
      body: `# ${title}\n\nCaptured from a completed session. Review and refine before relying on it.\n`,
      source: "session-capture",
      capturedAt: Date.now(),
    })
  }

  const fact = extractDurableFact(userTexts)
  if (fact) {
    candidates.memory.push({
      name: slugify(fact).slice(0, 40),
      fact,
      source: "session-capture",
      capturedAt: Date.now(),
    })
  }

  return candidates
}

// Durable-fact extraction: look for explicit statements about the captain's
// environment or preferences. Conservative — only clear signals, no thesaurus.
function extractDurableFact(userTexts) {
  const text = userTexts.join("\n")
  const patterns = [
    /(?:my|our|the captain's|i (?:prefer|use|run|work|like|want))[^.\n]{10,200}/i,
    /(?:prefers?|uses?|runs?|works? (?:with|on))[^.\n]{10,200}/i,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) return match[0].trim()
  }
  return ""
}

export * as FmLearning from "./fm-learning-core.js"
