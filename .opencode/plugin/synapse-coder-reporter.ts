import type { Plugin } from "@opencode-ai/plugin"
import path from "node:path"

const LANGUAGE_MAP: Record<string, string> = {
  ".ts": "typescript", ".tsx": "typescript",
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".cs": "csharp",
  ".rb": "ruby",
  ".php": "php",
  ".swift": "swift",
  ".kt": "kotlin", ".kts": "kotlin",
  ".dart": "dart",
  ".css": "css",
  ".html": "html",
  ".json": "json",
  ".yaml": "yaml", ".yml": "yaml",
  ".md": "markdown",
  ".sql": "sql",
  ".sh": "shell", ".bash": "shell",
}

const EDIT_TOOLS = new Set(["edit", "write", "apply_patch"])
const SYNAPSE_URL = "https://synapse-coder-mcp-staging.greenbay-703e5a45.australiaeast.azurecontainerapps.io/mcp"
const QUEUE_PATH = ".opencode/synapse-coder-queue.json"
const PROMPT_MARKER_PATH = ".opencode/synapse-coder-prompted"
const MAX_QUEUE = 100
const RETRY_INTERVAL_MS = 5 * 60 * 1000

interface ReportPayload {
  tool: string
  model: string
  original: string
  corrected: string
  reason: string
  reporterModel?: string
  category?: string
  language?: string
}

interface PendingCorrection {
  tool: string
  model: string
  language: string
  original: string
  reason: string
  reporterModel: string
  at: number
}

// A failing edit is only reported once a follow-up edit to the same file in the
// same session lands with clean diagnostics — coder_report_correction requires a
// non-empty `corrected`, so one-sided detections are held (and dropped after the
// window) instead of polluting the learning corpus.
function pendingWindowMs(): number {
  return Number(process.env.SYNAPSE_CODER_PENDING_WINDOW_MS) || 30 * 60 * 1000
}

function deriveLanguage(filePath: string): string {
  const ext = filePath.match(/\.[^.]+$/)?.[0]?.toLowerCase()
  return (ext && LANGUAGE_MAP[ext]) || "text"
}

function extractOriginal(tool: string, args: any): string {
  if (tool === "edit") return args?.newString ?? ""
  if (tool === "write") return args?.content ?? ""
  if (tool === "apply_patch") return args?.patchText ?? ""
  return ""
}

function extractFilePath(args: any): string {
  return args?.filePath ?? args?.path ?? ""
}

function hasDiagnostics(metadata: any): boolean {
  const d = metadata?.diagnostics
  if (!d) return false
  if (Array.isArray(d)) return d.length > 0
  return Object.keys(d).length > 0
}

function formatDiagnostics(metadata: any): string {
  return JSON.stringify(metadata?.diagnostics ?? {})
}

async function reportToSynapse(payload: ReportPayload): Promise<void> {
  const token = process.env.SYNAPSE_CODER_STAGING_BEARER_TOKEN
  if (!token) return

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  try {
    const body = {
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "coder_report_correction",
        arguments: payload,
      },
      id: Date.now(),
    }

    const res = await fetch(SYNAPSE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`synapse-coder responded ${res.status}`)
  } finally {
    clearTimeout(timeout)
  }
}

const plugin: Plugin = async (input) => {
  const sessionModels = new Map<string, string>()
  const pending = new Map<string, PendingCorrection>()
  const queuePath = path.join(input.directory, QUEUE_PATH)
  const promptMarkerPath = path.join(input.directory, PROMPT_MARKER_PATH)
  let intervalHandle: ReturnType<typeof setInterval> | undefined
  let prompted = false

  // First-use opt-in prompt (AC-010): toast once per project when a correction is
  // first detected while reporting is disabled. Headless (no TUI) skips the prompt
  // and leaves the marker unwritten so a later TUI session still prompts.
  async function promptOptInOnce(): Promise<void> {
    if (prompted) return
    prompted = true
    if (await Bun.file(promptMarkerPath).exists()) return
    try {
      await input.client.tui.showToast({
        body: {
          title: "Synapse Coder learning loop",
          message: "Correction detected. Reporting is off — set SYNAPSE_CODER_REPORTER_ENABLED=true to opt in.",
          variant: "info",
        },
      })
      await Bun.write(promptMarkerPath, new Date().toISOString())
    } catch {
      prompted = false
    }
  }

  async function loadQueue(): Promise<ReportPayload[]> {
    try {
      const text = await Bun.file(queuePath).text()
      const parsed = JSON.parse(text)
      return Array.isArray(parsed) ? parsed.slice(-MAX_QUEUE) : []
    } catch {
      return []
    }
  }

  async function saveQueue(queue: ReportPayload[]): Promise<void> {
    await Bun.write(queuePath, JSON.stringify(queue.slice(-MAX_QUEUE), null, 2))
  }

  async function enqueue(payload: ReportPayload): Promise<void> {
    const queue = await loadQueue()
    queue.push(payload)
    await saveQueue(queue)
  }

  let flushing = false
  async function flushQueue(): Promise<void> {
    if (flushing) return
    flushing = true
    try {
      const queue = await loadQueue()
      if (queue.length === 0) return
      const remaining: ReportPayload[] = []
      for (const payload of queue) {
        try {
          await reportToSynapse(payload)
        } catch {
          remaining.push(payload)
        }
      }
      await saveQueue(remaining)
    } finally {
      flushing = false
    }
  }

  flushQueue().catch((err) => console.error("[synapse-coder-reporter] initial flush failed", err))
  intervalHandle = setInterval(() => {
    flushQueue().catch((err) => console.error("[synapse-coder-reporter] flush failed", err))
  }, RETRY_INTERVAL_MS)

  return {
    "chat.message": async (hookInput) => {
      if (hookInput.model) {
        sessionModels.set(hookInput.sessionID, `${hookInput.model.providerID}/${hookInput.model.modelID}`)
      } else {
        try {
          const result = await input.client.session.get({ path: { id: hookInput.sessionID } })
          const session: any = (result as any)?.data ?? result
          const modelId = session?.modelID ?? "unknown"
          const providerId = session?.providerID ?? "unknown"
          sessionModels.set(hookInput.sessionID, `${providerId}/${modelId}`)
        } catch {
          sessionModels.set(hookInput.sessionID, "unknown")
        }
      }
    },

    "tool.execute.after": async (hookInput, hookOutput) => {
      if (!EDIT_TOOLS.has(hookInput.tool)) return

      const filePath = extractFilePath(hookInput.args)
      const pendingKey = `${hookInput.sessionID}:${filePath}`
      const reporterModel = sessionModels.get(hookInput.sessionID) ?? "unknown"

      if (hasDiagnostics(hookOutput.metadata)) {
        const held: PendingCorrection = {
          tool: hookInput.tool,
          model: reporterModel,
          language: deriveLanguage(filePath),
          original: extractOriginal(hookInput.tool, hookInput.args),
          reason: formatDiagnostics(hookOutput.metadata),
          reporterModel,
          at: Date.now(),
        }
        pending.set(pendingKey, held)

        if (process.env.SYNAPSE_CODER_REPORTER_ENABLED !== "true") {
          console.log(
            JSON.stringify({
              event: "synapse_correction_detected",
              reported: false,
              reason: "opt_in_disabled",
              category: "lsp-typecheck",
              language: held.language,
            }),
          )
          promptOptInOnce().catch((err) => console.error("[synapse-coder-reporter] opt-in prompt failed", err))
          return
        }

        console.log(
          JSON.stringify({
            event: "synapse_correction_detected",
            reported: false,
            reason: "awaiting_fix",
            category: "lsp-typecheck",
            language: held.language,
          }),
        )
        return
      }

      const held = pending.get(pendingKey)
      if (!held) return
      pending.delete(pendingKey)

      if (process.env.SYNAPSE_CODER_REPORTER_ENABLED !== "true") return

      const corrected = extractOriginal(hookInput.tool, hookInput.args)
      if (!corrected || corrected === held.original) return
      if (Date.now() - held.at > pendingWindowMs()) {
        console.log(
          JSON.stringify({
            event: "synapse_correction_dropped",
            reported: false,
            reason: "pending_window_expired",
            category: "lsp-typecheck",
            language: held.language,
          }),
        )
        return
      }

      const payload: ReportPayload = {
        tool: held.tool,
        model: held.model,
        original: held.original,
        corrected,
        reason: held.reason,
        reporterModel: held.reporterModel,
        category: "lsp-typecheck",
        language: held.language,
      }

      Promise.resolve()
        .then(() => reportToSynapse(payload))
        .then(() =>
          console.log(
            JSON.stringify({
              event: "synapse_correction_reported",
              reported: true,
              category: payload.category,
              language: payload.language,
            }),
          ),
        )
        .catch((err) => {
          console.error("[synapse-coder-reporter] report failed", err)
          enqueue(payload).catch((e) =>
            console.error("[synapse-coder-reporter] enqueue failed", e),
          )
        })
    },

    dispose: async () => {
      if (intervalHandle) clearInterval(intervalHandle)
      await Promise.race([
        flushQueue().catch(() => {}),
        new Promise<void>((r) => setTimeout(() => r(), 5_000)),
      ])
    },
  }
}

export default plugin
