import path from "path"
import { Session } from "."
import { Agent } from "../agent/agent"
import { Identifier } from "../id/id"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { SessionPrompt } from "./prompt"

export namespace SessionKnowledge {
  const log = Log.create({ service: "session.knowledge" })

  export interface ExtractResult {
    knowledgeFiles: string[]
    hasSubstantialKnowledge: boolean
    childSessionID: string
  }

  export async function extract(input: {
    sessionID: string
    transcriptPath: string
    model: { providerID: string; modelID: string }
    onStart?: (childSessionID: string) => void | Promise<void>
  }): Promise<ExtractResult> {
    log.info("extracting knowledge", { sessionID: input.sessionID })

    const agent = await Agent.get("knowledge-extractor")
    if (!agent) {
      log.error("knowledge-extractor agent not found")
      return { knowledgeFiles: [], hasSubstantialKnowledge: false, childSessionID: "" }
    }

    const session = await Session.create({
      parentID: input.sessionID,
      title: `Knowledge extraction (@${agent.name} subagent)`,
    })

    // Notify caller that extraction has started with child session ID
    if (input.onStart) {
      await input.onStart(session.id)
    }

    const messageID = Identifier.ascending("message")
    const prompt = buildExtractionPrompt(input.transcriptPath, input.sessionID)

    const result = await SessionPrompt.prompt({
      messageID,
      sessionID: session.id,
      model: input.model,
      agent: agent.name,
      tools: agent.tools,
      parts: [{ type: "text", text: prompt }],
    })

    const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""
    const parsed = parseExtractionResult(text)
    return { ...parsed, childSessionID: session.id }
  }

  function buildExtractionPrompt(transcriptPath: string, sessionID: string): string {
    return [
      `Extract knowledge from the following session transcript.`,
      ``,
      `Transcript path: ${transcriptPath}`,
      `Session ID: ${sessionID}`,
      `Knowledge directory: ${path.join(Instance.directory, ".opencode", "knowledge")}`,
      ``,
      `Instructions:`,
      `1. Read the transcript file`,
      `2. Identify valuable, reusable knowledge`,
      `3. Check existing knowledge files in .opencode/knowledge/`,
      `4. Create new or merge into existing knowledge files`,
      `5. Return structured result with KNOWLEDGE_RESULT format`,
    ].join("\n")
  }

  function parseExtractionResult(text: string): Omit<ExtractResult, "childSessionID"> {
    const match = text.match(/KNOWLEDGE_RESULT:\s*\nfiles:\s*\[(.*?)\]\s*\nsubstantial:\s*(true|false)\s*\nsummary:/s)
    if (!match) {
      log.warn("could not parse knowledge result", { text: text.slice(-500) })
      return { knowledgeFiles: [], hasSubstantialKnowledge: false }
    }

    const filesStr = match[1].trim()
    const files = filesStr
      ? filesStr
          .split(",")
          .map((f) => f.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean)
      : []

    const substantial = match[2] === "true"

    log.info("parsed knowledge result", { files, substantial })
    return { knowledgeFiles: files, hasSubstantialKnowledge: substantial }
  }

  export async function list(): Promise<string[]> {
    const knowledgeDir = path.join(Instance.directory, ".opencode", "knowledge")
    const glob = new Bun.Glob("*.md")
    const files = await Array.fromAsync(glob.scan({ cwd: knowledgeDir, absolute: true })).catch(() => [])
    return files
  }

  export async function load(files: string[]): Promise<string[]> {
    const contents = await Promise.all(
      files.map(async (file) => {
        const filepath = path.isAbsolute(file) ? file : path.join(Instance.directory, file)
        const text = await Bun.file(filepath)
          .text()
          .catch(() => "")
        if (!text) return ""
        return `Knowledge from: ${filepath}\n${text}`
      }),
    )
    return contents.filter(Boolean)
  }

  export async function ensureDirectories(): Promise<void> {
    const sessDir = path.join(Instance.directory, ".opencode", "sess")
    const knowledgeDir = path.join(Instance.directory, ".opencode", "knowledge")

    await Bun.write(path.join(sessDir, ".gitkeep"), "")
    await Bun.write(path.join(knowledgeDir, ".gitkeep"), "")
  }

  export function parseKnowledgeReferences(text: string): string[] {
    const refs: string[] = []
    const pattern = /(?:knowledge files?|referenced?):?\s*\[?([^\]\n]+)\]?/gi
    let match
    while ((match = pattern.exec(text)) !== null) {
      const paths = match[1]
        .split(",")
        .map((p) => p.trim().replace(/^["']|["']$/g, ""))
        .filter((p) => p.includes(".opencode/knowledge/") || p.endsWith(".md"))
      refs.push(...paths)
    }
    return [...new Set(refs)]
  }
}
