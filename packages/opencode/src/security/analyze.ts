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
import { Config } from "@/config/config"
import {
  DEFAULT_CONTROLS_PATH,
  DEFAULT_MAX_CHARS,
  DEFAULT_OUT_DIR,
  DEFAULT_TOPK,
  DEFAULT_VECTOR_COLLECTION,
  SecurityAnalyzeInput,
  type SecurityAnalyzeResult,
} from "./schema"
import { buildAuditPrompt } from "./prompt-builder"
import { loadControls, retrieveVector } from "./retrieval"
import { verifyReport } from "./verification"
import { writeRun } from "./logger"
import { ingest } from "./ingest"

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
  const report = (await result.text).trim()
  return {
    report,
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
  target: string
  mode: "baseline" | "rag"
  model?: string
  agent?: string
}) {
  const ag = await resolveAgent(input.agent)
  const mdl = await resolveModel({ model: input.model, agent: ag })
  const stat = Filesystem.stat(input.target)
  if (!stat) throw new Error(`Input not found: ${input.target}`)
  const msg = await SessionPrompt.prompt({
    sessionID: input.sessionID,
    agent: ag.name,
    model: { providerID: mdl.providerID, modelID: mdl.id },
    parts: [
      {
        type: "file",
        url: pathToFileURL(input.target).href,
        filename: path.basename(input.target),
        mime: stat.isDirectory() ? "application/x-directory" : "text/plain",
      },
      { type: "text", text: input.prompt },
    ],
  })
  const report = msg.parts
    .filter((part): part is MessageV2.TextPart => part.type === "text")
    .map((part) => part.text.trim())
    .filter((part) => part.length > 0)
    .join("\n\n")
  const metadata =
    msg.info.role === "assistant"
      ? {
          provider_id: msg.info.providerID,
          model_id: msg.info.modelID,
          agent: msg.info.agent,
          mode: input.mode,
          message_id: msg.info.id,
        }
      : {
          provider_id: msg.info.model.providerID,
          model_id: msg.info.model.modelID,
          agent: msg.info.agent,
          mode: input.mode,
          message_id: msg.info.id,
        }
  return {
    report,
    metadata,
  }
}

export async function analyze(raw: SecurityAnalyzeInput): Promise<SecurityAnalyzeResult> {
  const input = SecurityAnalyzeInput.parse(raw)
  const targetInput = input.path ?? input.file
  if (!targetInput) {
    throw new Error("Provide --path (or --file) to analyze.")
  }
  const target = path.resolve(targetInput)
  if (!(await Filesystem.exists(target))) {
    throw new Error(`Input not found: ${targetInput}`)
  }
  const cfg = await Config.get()
  const cap = input.maxchars ?? DEFAULT_MAX_CHARS
  const loaded = await ingest({ path: target, max: cap })

  const sessionID = await ensureSession(input.sessionID)
  const topk = input.topk ?? DEFAULT_TOPK

  const controlsPath = path.resolve(input.controls ?? DEFAULT_CONTROLS_PATH)
  const provider = input.vector ?? cfg.experimental?.security_audit?.vector
  const collection = input.collection ?? cfg.experimental?.security_audit?.collection ?? DEFAULT_VECTOR_COLLECTION
  const namespace = input.namespace ?? cfg.experimental?.security_audit?.namespace
  const controls =
    input.mode === "rag"
      ? await (async () => {
          if (!provider) throw new Error("RAG mode requires vector backend config (pinecone or qdrant).")
          if (!(await Filesystem.exists(controlsPath))) {
            throw new Error(
              `RAG mode requires a controls file. Missing: ${controlsPath}. Use --controls or add data/security_controls.json.`,
            )
          }
          const base = await loadControls(controlsPath)
          return retrieveVector({
            backend: provider,
            controls: base,
            text: loaded.text,
            topk,
            collection,
            namespace,
            pineconeIndex: cfg.experimental?.security_audit?.pinecone_index,
            qdrantUrl: cfg.experimental?.security_audit?.qdrant_url,
            qdrantKey: cfg.experimental?.security_audit?.qdrant_api_key,
          })
        })()
      : []

  const prompt = buildAuditPrompt({
    mode: input.mode,
    userPrompt: input.prompt,
    filePath: target,
    fileText: loaded.text,
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
          target,
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
    file: target,
    fileText: loaded.text,
    prompt,
    controls,
    report: generated.report,
    verification,
    metadata: {
      timestamp: new Date().toISOString(),
      topk,
      controls_file: input.mode === "rag" ? controlsPath : null,
      vector_backend: provider ?? null,
      vector_collection: input.mode === "rag" ? collection : null,
      vector_namespace: input.mode === "rag" ? namespace ?? null : null,
      session_id: sessionID,
      files: loaded.files.length,
      clipped: loaded.clipped,
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
