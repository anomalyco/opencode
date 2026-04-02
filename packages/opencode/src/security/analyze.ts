import path from "path"
import { pathToFileURL } from "url"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { LLM } from "@/session/llm"
import { SessionPrompt } from "@/session/prompt"
import { MessageID, SessionID } from "@/session/schema"
import type { Permission } from "@/permission"
import { Filesystem } from "@/util/filesystem"
import {
  DEFAULT_CONTROLS_PATH,
  DEFAULT_OUT_DIR,
  DEFAULT_TOPK,
  SecurityAnalyzeInput,
  type SecurityAnalyzeResult,
} from "./schema"
import { buildAuditPrompt } from "./prompt-builder"
import { loadControls, retrieveRelevantControls } from "./retrieval"
import { verifyReport } from "./verification"
import { writeRun } from "./logger"

const rules: Permission.Ruleset = [
  { permission: "question", action: "deny", pattern: "*" },
  { permission: "plan_enter", action: "deny", pattern: "*" },
  { permission: "plan_exit", action: "deny", pattern: "*" },
]

async function resolveAgent(agent?: string) {
  return Agent.get(agent ?? (await Agent.defaultAgent()))
}

async function resolveModel(input: { model?: string; agent: Awaited<ReturnType<typeof resolveAgent>> }) {
  if (input.model) {
    const parsed = Provider.parseModel(input.model)
    return Provider.getModel(parsed.providerID, parsed.modelID)
  }
  if (input.agent.model) {
    return Provider.getModel(input.agent.model.providerID, input.agent.model.modelID)
  }
  const ref = await Provider.defaultModel()
  return Provider.getModel(ref.providerID, ref.modelID)
}

async function ensureSession(input?: string) {
  if (input) return SessionID.make(input)
  const session = await Session.create({ title: "Security Audit Prototype", permission: rules })
  return session.id
}

async function direct(input: {
  sessionID: SessionID
  prompt: string
  mode: "direct"
  model?: string
  agent?: string
}) {
  const ag = await resolveAgent(input.agent)
  const mdl = await resolveModel({ model: input.model, agent: ag })
  const user: MessageV2.User = {
    id: MessageID.ascending(),
    role: "user",
    sessionID: input.sessionID,
    time: { created: Date.now() },
    agent: ag.name,
    model: { providerID: mdl.providerID, modelID: mdl.id },
  }
  const ctrl = new AbortController()
  const result = await LLM.stream({
    user,
    sessionID: input.sessionID,
    model: mdl,
    agent: ag,
    system: [],
    messages: [{ role: "user", content: input.prompt }],
    tools: {},
    toolChoice: "none",
    retries: 1,
    abort: ctrl.signal,
  })
  return {
    report: result.text.trim(),
    metadata: {
      provider_id: mdl.providerID,
      model_id: mdl.id,
      agent: ag.name,
      mode: input.mode,
    },
  }
}

async function agentic(input: {
  sessionID: SessionID
  prompt: string
  file: string
  mode: "baseline" | "rag"
  model?: string
  agent?: string
}) {
  const ag = await resolveAgent(input.agent)
  const mdl = await resolveModel({ model: input.model, agent: ag })
  const msg = await SessionPrompt.prompt({
    sessionID: input.sessionID,
    agent: ag.name,
    model: { providerID: mdl.providerID, modelID: mdl.id },
    parts: [
      {
        type: "file",
        url: pathToFileURL(input.file).href,
        filename: path.basename(input.file),
        mime: "text/plain",
      },
      { type: "text", text: input.prompt },
    ],
  })
  const report = msg.parts
    .filter((part): part is MessageV2.TextPart => part.type === "text")
    .map((part) => part.text.trim())
    .filter((part) => part.length > 0)
    .join("\n\n")
  return {
    report,
    metadata: {
      provider_id: msg.info.providerID,
      model_id: msg.info.modelID,
      agent: msg.info.agent,
      mode: input.mode,
      message_id: msg.info.id,
    },
  }
}

export async function analyze(raw: SecurityAnalyzeInput): Promise<SecurityAnalyzeResult> {
  const input = SecurityAnalyzeInput.parse(raw)
  const file = path.resolve(input.file)
  if (!(await Filesystem.exists(file))) {
    throw new Error(`Input file not found: ${input.file}`)
  }

  const text = await Filesystem.readText(file)
  const sessionID = await ensureSession(input.sessionID)
  const topk = input.topk ?? DEFAULT_TOPK

  const controlsPath = path.resolve(input.controls ?? DEFAULT_CONTROLS_PATH)
  const controls =
    input.mode === "rag"
      ? await (async () => {
          if (!(await Filesystem.exists(controlsPath))) {
            throw new Error(
              `RAG mode requires a controls file. Missing: ${controlsPath}. Use --controls or add data/security_controls.json.`,
            )
          }
          const base = await loadControls(controlsPath)
          return retrieveRelevantControls(text, topk, base)
        })()
      : []

  const prompt = buildAuditPrompt({
    mode: input.mode,
    userPrompt: input.prompt,
    filePath: file,
    fileText: text,
    controls,
  })

  const generated =
    input.mode === "direct"
      ? await direct({
          sessionID,
          prompt,
          mode: "direct",
          model: input.model,
          agent: input.agent,
        })
      : await agentic({
          sessionID,
          prompt,
          file,
          mode: input.mode,
          model: input.model,
          agent: input.agent,
        })

  const verification = verifyReport({
    report: generated.report,
    mode: input.mode,
    controls,
  })
  const runDir = await writeRun({
    base: path.resolve(input.out ?? DEFAULT_OUT_DIR),
    mode: input.mode,
    file,
    fileText: text,
    prompt,
    controls,
    report: generated.report,
    verification,
    metadata: {
      timestamp: new Date().toISOString(),
      topk,
      controls_file: input.mode === "rag" ? controlsPath : null,
      session_id: sessionID,
      ...generated.metadata,
    },
  })

  return {
    mode: input.mode,
    sessionID,
    prompt,
    report: generated.report,
    retrieved_controls: controls,
    verification,
    run_dir: runDir,
    metadata: generated.metadata,
  }
}
