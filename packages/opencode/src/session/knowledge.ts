import path from "path"
import { Session } from "."
import { Agent } from "../agent/agent"
import { Identifier } from "../id/id"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { SessionPrompt } from "./prompt"
import { Provider } from "../provider/provider"
import { ProviderTransform } from "../provider/transform"
import { generateText, type ModelMessage } from "ai"
import { mergeDeep, pipe } from "remeda"

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

  export interface CheckResult {
    hasNewKnowledge: boolean
  }

  export async function check(input: {
    transcriptPath: string
    model: { providerID: string; modelID: string }
  }): Promise<CheckResult> {
    log.info("checking for new knowledge", { transcriptPath: input.transcriptPath })

    const model =
      (await Provider.getSmallModel(input.model.providerID)) ??
      (await Provider.getModel(input.model.providerID, input.model.modelID))
    const language = await Provider.getLanguage(model)

    const transcript = await Bun.file(input.transcriptPath)
      .text()
      .catch(() => "")
    if (!transcript) {
      log.warn("could not read transcript for knowledge check")
      return { hasNewKnowledge: false }
    }

    const existingFiles = await list()
    const existingKnowledge = await load(existingFiles)

    const options = pipe(
      {},
      mergeDeep(ProviderTransform.options(model, "knowledge-check")),
      mergeDeep(ProviderTransform.smallOptions(model)),
      mergeDeep(model.options),
    )

    const systemPrompt = `You determine if a conversation transcript contains new, valuable knowledge worth extracting.

New knowledge includes:
- Design decisions and architectural choices with rationale
- Technical specifications, schemas, or protocols
- Bug resolutions with root causes and solutions
- Codebase patterns, conventions, or important file locations
- User preferences or project-specific rules

NOT new knowledge:
- Information already captured in existing knowledge files
- Step-by-step debugging logs or raw tool outputs
- Routine operations or transient discussion
- Generic information not specific to this project

Respond with ONLY "true" or "false" - nothing else.`

    const userPrompt =
      existingKnowledge.length > 0
        ? `Existing knowledge files:\n${existingKnowledge.join("\n\n---\n\n")}\n\n---\n\nSession transcript:\n${transcript}\n\nDoes this transcript contain valuable NEW knowledge not already in the existing files?`
        : `Session transcript:\n${transcript}\n\nDoes this transcript contain valuable knowledge worth extracting?`

    const result = await generateText({
      model: language,
      maxOutputTokens: model.capabilities.reasoning ? 500 : 10,
      providerOptions: ProviderTransform.providerOptions(model.api.npm, model.providerID, options),
      messages: [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: userPrompt },
      ],
      headers: model.headers,
    }).catch((err) => {
      log.error("knowledge check failed", { error: err })
      return undefined
    })

    if (!result) return { hasNewKnowledge: true } // err on side of extraction

    const answer = result.text.toLowerCase().trim()
    const hasNewKnowledge = answer === "true" || answer.startsWith("true")
    log.info("knowledge check result", { hasNewKnowledge, answer })

    return { hasNewKnowledge }
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
