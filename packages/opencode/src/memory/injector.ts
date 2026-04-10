import { Config } from "@/config/config"
import { Log } from "@/util/log"
import { MemoryFile } from "./file"
import { MemoryStore } from "./store"
import { Instance } from "@/project/instance"
import type { Memory } from "./types"

const log = Log.create({ service: "memory.injector" })

// Rough token estimate: ~4 chars per token for English/code mixed content
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function relevanceWeight(entry: Memory.Info): number {
  const daysSinceUpdate = (Date.now() - entry.timeUpdated) / (1000 * 60 * 60 * 24)
  const recencyWeight = 1.0 / (1 + daysSinceUpdate / 30)
  return entry.relevanceScore * recencyWeight * Math.log2(entry.accessCount + 2)
}

export namespace MemoryInjector {
  export async function load(agent?: string): Promise<string | undefined> {
    const config = await Config.get()
    if (config.memory?.enabled === false) return undefined

    const maxTokens = config.memory?.max_memory_tokens ?? 5000

    // Try DB-first, fallback to file-based
    let entries: Memory.Info[] = []
    try {
      entries = await MemoryStore.runPromise((svc) => svc.list(Instance.directory))
    } catch {
      // DB not available, fallback to file-based loading
      return loadFromFile(config.memory?.max_memory_lines ?? 200)
    }

    // Load agent-specific entries if agent is specified
    let agentEntries: Memory.Info[] = []
    if (agent) {
      try {
        agentEntries = await MemoryStore.runPromise((svc) => svc.listByAgent(Instance.directory, agent))
      } catch {
        // Ignore agent memory load failures
      }
    }

    if (entries.length === 0 && agentEntries.length === 0) {
      return loadFromFile(config.memory?.max_memory_lines ?? 200)
    }

    // Sort by relevance weight (highest first)
    entries.sort((a, b) => relevanceWeight(b) - relevanceWeight(a))
    agentEntries.sort((a, b) => relevanceWeight(b) - relevanceWeight(a))

    // Deduplicate agent entries that are already in general entries
    const generalIds = new Set(entries.map((e) => e.id))
    agentEntries = agentEntries.filter((e) => !generalIds.has(e.id))

    // Build sections within token budget
    const sections: string[] = []
    let tokenBudget = maxTokens

    // Agent-specific section first (highest priority)
    if (agentEntries.length > 0) {
      const agentSection = buildSection("Agent-Specific Knowledge", agentEntries, tokenBudget)
      if (agentSection.text) {
        sections.push(agentSection.text)
        tokenBudget -= agentSection.tokens
      }
    }

    // Group general entries by type
    const projectEntries = entries.filter((e) => e.type === "project")
    const userEntries = entries.filter((e) => e.type === "user")
    const feedbackEntries = entries.filter((e) => e.type === "feedback")
    const referenceEntries = entries.filter((e) => e.type === "reference")

    for (const [title, group] of [
      ["Project Knowledge", projectEntries],
      ["User Preferences", userEntries],
      ["Feedback & Patterns", feedbackEntries],
      ["Reference", referenceEntries],
    ] as const) {
      if (group.length === 0 || tokenBudget <= 0) continue
      const section = buildSection(title, group, tokenBudget)
      if (section.text) {
        sections.push(section.text)
        tokenBudget -= section.tokens
      }
    }

    if (sections.length === 0) return undefined

    return [
      "# Memory",
      "The following memory entries were loaded from the project memory system.",
      "These represent learned patterns, preferences, and context from previous sessions.",
      "Note: verify referenced files/functions still exist before acting on these memories.",
      "",
      ...sections,
    ].join("\n")
  }

  function buildSection(title: string, entries: Memory.Info[], tokenBudget: number): { text: string; tokens: number } {
    const header = `## ${title}\n`
    let tokens = estimateTokens(header)
    const lines: string[] = [header]

    for (const entry of entries) {
      const desc = entry.description ? ` -- ${entry.description}` : ""
      const line = `- **${entry.name}** (${entry.type}): ${entry.content.split("\n")[0]}${desc}\n`
      const lineTokens = estimateTokens(line)
      if (tokens + lineTokens > tokenBudget) break
      lines.push(line)
      tokens += lineTokens
    }

    if (lines.length <= 1) return { text: "", tokens: 0 }
    return { text: lines.join(""), tokens }
  }

  async function loadFromFile(maxLines: number): Promise<string | undefined> {
    const content = await MemoryFile.readIndex(maxLines).catch((err) => {
      log.warn("failed to read MEMORY.md", { error: err })
      return undefined
    })

    if (!content || !content.trim()) return undefined

    return [
      "# Memory",
      "The following memory entries were loaded from MEMORY.md in the project directory.",
      "These represent learned patterns, preferences, and context from previous sessions.",
      "Note: verify referenced files/functions still exist before acting on these memories.",
      "",
      content,
    ].join("\n")
  }
}
