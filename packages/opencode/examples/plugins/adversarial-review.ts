import type { Plugin } from "@opencode-ai/plugin"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

// ============================================================================
// CONFIGURATION
// ============================================================================

interface LoggingConfig {
  enabled: boolean
  path: string
  level: "error" | "info" | "debug"
}

interface AdversarialReviewConfig {
  enabled?: boolean
  totalRounds?: number
  models?: string[]
  markers?: string[]
  logging?: Partial<LoggingConfig>
}

interface ResolvedConfig {
  enabled: boolean
  totalRounds: number
  models: string[]
  markers: string[]
  logging: Required<LoggingConfig>
}

const VALID_LOG_LEVELS: readonly LogLevel[] = ["error", "info", "debug"]
type LogLevel = "error" | "info" | "debug"

function expandHomePath(filePath: string): string {
  if (filePath === "~") return os.homedir()
  if (filePath.startsWith("~/")) {
    return path.join(os.homedir(), filePath.slice(2))
  }
  return filePath
}

const DEFAULT_CONFIG: ResolvedConfig = {
  enabled: true,
  totalRounds: 3,
  models: [
    "zai-coding-plan/glm-5",
    "opencode/nemotron-3-super-free",
    "openai/gpt-5.4",
  ],
  markers: [
    "ROUND_COMPLETE",
  ],
  logging: {
    enabled: false,
    path: path.join(os.homedir(), ".config", "opencode", "adversarial-review.log"),
    level: "debug",
  },
}

const CONFIG_FILE_PATH = path.join(
  os.homedir(),
  ".config",
  "opencode",
  "adversarial-review.json"
)

const STATE_FILE_DIR = path.join(
  os.homedir(),
  ".config",
  "opencode"
)

const STATE_FILE_PATH = path.join(STATE_FILE_DIR, "adversarial-review-state.json")

const PROCESSED_KEYS_CAP = 200
const PROCESSED_KEYS_PRUNE = 100

// ============================================================================
// PERSISTENT STATE
// ============================================================================

interface PersistedState {
  enabled: boolean
  currentRound: number
  totalRounds: number
  modelsUsed: string[]
  startedAt: number | null
  sessionTitle: string
  currentSessionId: string | null
  currentModelId: string | null
  processedMessageKeys: string[]
}

const FRESH_STATE: PersistedState = {
  enabled: false,
  currentRound: 0,
  totalRounds: DEFAULT_CONFIG.totalRounds,
  modelsUsed: [],
  startedAt: null,
  sessionTitle: "",
  currentSessionId: null,
  currentModelId: null,
  processedMessageKeys: [],
}

function freshState(): PersistedState {
  return { ...FRESH_STATE }
}

function resetStateInMemory(state: PersistedState): void {
  Object.assign(state, FRESH_STATE)
}

// ============================================================================
// STATE VALIDATION
// ============================================================================

function isValidState(raw: unknown): raw is PersistedState {
  if (typeof raw !== "object" || raw === null) return false
  const s = raw as Record<string, unknown>
  return (
    typeof s.enabled === "boolean" &&
    typeof s.currentRound === "number" &&
    Number.isInteger(s.currentRound) &&
    s.currentRound >= 0 &&
    typeof s.totalRounds === "number" &&
    Number.isInteger(s.totalRounds) &&
    s.totalRounds > 0 &&
    (s.modelsUsed === undefined || Array.isArray(s.modelsUsed)) &&
    (typeof s.startedAt === "number" || s.startedAt === null) &&
    (typeof s.sessionTitle === "string" || s.sessionTitle === undefined) &&
    (typeof s.currentSessionId === "string" || s.currentSessionId === null) &&
    (typeof s.currentModelId === "string" || s.currentModelId === null || s.currentModelId === undefined) &&
    Array.isArray(s.processedMessageKeys)
  )
}

// ============================================================================
// STRUCTURED LOGGER
// ============================================================================

const LOG_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  error: 2,
}

function writeLog(logPath: string, entry: object): void {
  try {
    const logDir = path.dirname(logPath)
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true })
    }
    fs.appendFileSync(logPath, JSON.stringify(entry) + "\n")
  } catch (_e) {
    // Silently ignore log write failures
  }
}

class Logger {
  public enabled: boolean
  public path: string
  public level: LogLevel

  constructor(cfg: ResolvedConfig["logging"]) {
    this.enabled = cfg.enabled
    this.path = cfg.path
    this.level = cfg.level
  }

  private shouldLog(level: LogLevel): boolean {
    if (!this.enabled) return false
    return LOG_PRIORITY[level] >= LOG_PRIORITY[this.level]
  }

  error(event: string, data?: Record<string, unknown>): void {
    writeLog(this.path, {
      event,
      level: "error",
      timestamp: new Date().toISOString(),
      ...data,
    })
  }

  info(event: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog("info")) return
    writeLog(this.path, {
      event,
      level: "info",
      timestamp: new Date().toISOString(),
      ...data,
    })
  }

  debug(event: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog("debug")) return
    writeLog(this.path, {
      event,
      level: "debug",
      timestamp: new Date().toISOString(),
      ...data,
    })
  }
}

let logger: Logger | null = null

// ============================================================================
// STATE PERSISTENCE
// ============================================================================

function ensureStateDir(): void {
  try {
    if (!fs.existsSync(STATE_FILE_DIR)) {
      fs.mkdirSync(STATE_FILE_DIR, { recursive: true })
    }
  } catch (_e) {
    // Silently ignore; save will fail gracefully
  }
}

function loadState(): PersistedState {
  try {
    const raw = fs.readFileSync(STATE_FILE_PATH, "utf-8")
    const parsed = JSON.parse(raw)
    if (!isValidState(parsed)) {
      logger?.debug("state.loaded", { reason: "invalid schema, using fresh" })
      return freshState()
    }
    logger?.debug("state.loaded", {
      enabled: parsed.enabled,
      currentRound: parsed.currentRound,
      totalRounds: parsed.totalRounds,
    })
    return { ...FRESH_STATE, ...parsed }
  } catch (_e) {
    logger?.debug("state.loaded", { reason: "no persisted state, using fresh" })
    return freshState()
  }
}

function saveState(state: PersistedState): void {
  try {
    ensureStateDir()
    const temp = STATE_FILE_PATH + ".tmp"
    fs.writeFileSync(temp, JSON.stringify(state, null, 2))
    fs.renameSync(temp, STATE_FILE_PATH)
    try {
      fs.chmodSync(STATE_FILE_PATH, 0o600)
    } catch (_e) {
      // chmod may fail on some filesystems; continue
    }
    logger?.debug("state.saved", {
      enabled: state.enabled,
      currentRound: state.currentRound,
    })
  } catch (e) {
    logger?.error("state.save_failed", { error: String(e) })
  }
}

function clearState(): void {
  try {
    fs.unlinkSync(STATE_FILE_PATH)
    logger?.debug("state.cleared")
  } catch (_e) {
    // File may not exist; ignore
  }
}

// ============================================================================
// CONFIG LOADING AND VALIDATION
// ============================================================================

function validateLogLevel(level: unknown): LogLevel {
  if (VALID_LOG_LEVELS.includes(level as LogLevel)) {
    return level as LogLevel
  }
  return DEFAULT_CONFIG.logging.level
}

function normalizeConfig(raw: AdversarialReviewConfig): ResolvedConfig {
  const models = Array.isArray(raw.models)
    ? raw.models.filter((m): m is string => typeof m === "string" && m.includes("/") && m.trim().length > 0)
    : DEFAULT_CONFIG.models

  if (models.length === 0) {
    throw new Error("models array must be non-empty")
  }

  const markers = Array.isArray(raw.markers)
    ? raw.markers.filter((m): m is string => typeof m === "string" && m.trim().length > 0)
    : DEFAULT_CONFIG.markers

  if (markers.length === 0) {
    throw new Error("markers array must be non-empty")
  }

  const loggingLevel = validateLogLevel(raw.logging?.level ?? DEFAULT_CONFIG.logging.level)

  const resolved: ResolvedConfig = {
    enabled: raw.enabled ?? DEFAULT_CONFIG.enabled,
    totalRounds: Math.max(
      1,
      Math.min(
        typeof raw.totalRounds === "number" && raw.totalRounds > 0
          ? Math.floor(raw.totalRounds)
          : models.length,
        models.length,
      ),
    ),
    models,
    markers,
    logging: {
      enabled: raw.logging?.enabled ?? DEFAULT_CONFIG.logging.enabled,
      path: expandHomePath(raw.logging?.path ?? DEFAULT_CONFIG.logging.path),
      level: loggingLevel,
    },
  }

  return resolved
}

function loadPluginConfig(): ResolvedConfig {
  try {
    const raw = fs.readFileSync(CONFIG_FILE_PATH, "utf-8")
    const parsed = JSON.parse(raw) as AdversarialReviewConfig
    const resolved = normalizeConfig(parsed)
    logger?.info("config.loaded", {
      enabled: resolved.enabled,
      totalRounds: resolved.totalRounds,
      models: resolved.models,
    })
    return resolved
  } catch (e) {
    logger?.error("config.load_failed", { error: String(e) })
    throw e
  }
}

function ensureConfigFile(): void {
  try {
    fs.accessSync(CONFIG_FILE_PATH, fs.constants.R_OK)
    return
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      logger?.error("config.access_failed", { error: String(e) })
      return
    }
    try {
      const dir = path.dirname(CONFIG_FILE_PATH)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      const temp = CONFIG_FILE_PATH + ".tmp"
      fs.writeFileSync(temp, JSON.stringify(DEFAULT_CONFIG, null, 2))
      fs.renameSync(temp, CONFIG_FILE_PATH)
      try {
        fs.chmodSync(CONFIG_FILE_PATH, 0o600)
      } catch (_e) {
        // chmod may fail on some filesystems; continue
      }
      logger?.info("config.created_default", { path: CONFIG_FILE_PATH })
    } catch (writeErr) {
      logger?.error("config.create_failed", { error: String(writeErr) })
    }
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function detectRoundCompletion(text: string, markers: string[]): string | null {
  if (typeof text !== "string") return null
  const upper = text.toUpperCase()
  for (const marker of markers) {
    const normalized = marker.trim().toUpperCase()
    if (upper.includes(normalized)) {
      return marker
    }
  }
  return null
}

function isExplicitReviewSessionTitle(title: string): boolean {
  if (typeof title !== "string") return false
  const lower = title.toLowerCase()
  return lower.includes("adversarial-review") || lower.includes("adversarial review")
}

function isSubagentTitle(title: string): boolean {
  if (typeof title !== "string") return false
  return title.toLowerCase().includes("subagent")
}

function getEffectiveRounds(state: PersistedState, config: ResolvedConfig): number {
  return Math.max(1, Math.min(state.totalRounds, config.models.length))
}

function parseModelId(modelId: string): { providerID: string; modelID: string } | null {
  if (typeof modelId !== "string") return null
  const slashIdx = modelId.indexOf("/")
  if (slashIdx < 1 || slashIdx >= modelId.length - 1) return null
  return {
    providerID: modelId.slice(0, slashIdx),
    modelID: modelId.slice(slashIdx + 1),
  }
}

function getModelName(modelId: string): string {
  const parsed = parseModelId(modelId)
  if (parsed) return `${parsed.modelID} (${parsed.providerID})`
  return modelId
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}

function capProcessedKeys(keys: string[]): string[] {
  if (keys.length <= PROCESSED_KEYS_CAP) return keys
  return keys.slice(-(PROCESSED_KEYS_CAP - PROCESSED_KEYS_PRUNE))
}

const messageModelMap: Map<string, string> = new Map()

function clearMessageModelMap(): void {
  messageModelMap.clear()
}

// ============================================================================
// PLUGIN
// ============================================================================

export const AdversarialReviewPlugin: Plugin = async ({ client }) => {
  const state = loadState()
  ensureConfigFile()

  let resolvedConfig: ResolvedConfig
  try {
    resolvedConfig = loadPluginConfig()
  } catch (e) {
    resolvedConfig = { ...DEFAULT_CONFIG }
    logger?.error("plugin.init_config_fallback", { error: String(e) })
    await safeToast(client, {
      message: "Adversarial review config is invalid; plugin disabled.",
      variant: "error",
    })
  }

  if (logger === null || !(logger instanceof Logger)) {
    logger = new Logger(resolvedConfig.logging)
  }

  if (!resolvedConfig.enabled) {
    resetStateInMemory(state)
    clearState()
  }

  logger?.info("plugin.init", {
    enabled: state.enabled,
    currentRound: state.currentRound,
    totalRounds: state.totalRounds,
  })

  return {
    config: async () => {
      logger?.debug("config.hook", {})
      try {
        resolvedConfig = loadPluginConfig()
      } catch (e) {
        logger?.error("config.hook_failed", { error: String(e) })
        return
      }

      if (!resolvedConfig.enabled) {
        resetStateInMemory(state)
        clearState()
        clearMessageModelMap()
      }

      if (logger) {
        logger.enabled = resolvedConfig.logging.enabled
        logger.path = resolvedConfig.logging.path
        logger.level = resolvedConfig.logging.level
      }
    },

    "chat.message": async (input, output) => {
      if (!resolvedConfig.enabled) return

      const { sessionID, model } = input
      const { message } = output

      if (!sessionID || !message) return
      if (message.role !== "user") return

      if (state.currentSessionId !== sessionID) return
      if (!state.enabled || state.currentRound === 0) return

      const roundModel = resolvedConfig.models[state.currentRound - 1]
      if (!roundModel) return

      const parsed = parseModelId(roundModel)
      if (!parsed) return

      const previousModel = model
        ? `${model.providerID}/${model.modelID}`
        : "default"

      message.model = {
        providerID: parsed.providerID,
        modelID: parsed.modelID,
      }

      const effective = `${parsed.providerID}/${parsed.modelID}`

      logger?.info("chat.message.reroute", {
        sessionID,
        round: state.currentRound,
        previousModel,
        effectiveModel: effective,
        reason: "adversarial-review-round-routing",
      })

      await safeToast(client, {
        message: `Routing round ${state.currentRound} to ${effective} automatically.`,
        variant: "info",
      })
    },

    event: async (input) => {
      const event = input.event

      try {
        await handleEvent(event, state, resolvedConfig, client)
      } catch (e) {
        logger?.error("event.handler_error", { event: event.type, error: String(e) })
      }
    },
  }
}

async function safeToast(
  client: { tui: { showToast: (opts: { body: { message: string; variant?: string } }) => Promise<void> } },
  opts: { message: string; variant?: string }
): Promise<void> {
  try {
    await client.tui.showToast({ body: opts })
  } catch (_e) {
    // Toast failure should not crash event handling
  }
}

async function handleEvent(
  event: { type: string; [key: string]: unknown },
  state: PersistedState,
  resolvedConfig: ResolvedConfig,
  client: { tui: { showToast: (opts: { body: { message: string; variant?: string } }) => Promise<void> } }
): Promise<void> {
  // ── session.created / session.updated ──────────────────────────────────
  if (event.type === "session.created" || event.type === "session.updated") {
    const session = (event as Record<string, unknown>).properties as Record<string, unknown> | undefined
    const info = session?.info as Record<string, unknown> | undefined
    if (!info) return

    const title = (info.title as string) || ""
    if (isSubagentTitle(title)) return

    const isReview = isExplicitReviewSessionTitle(title)
    if (!isReview) return

    const sessionId = info.id as string | undefined
    if (!sessionId) return

    if (state.enabled && state.currentSessionId && state.currentSessionId !== sessionId) {
      await safeToast(client, {
        message: "Another adversarial review is already active. Finish or reset it first.",
        variant: "error",
      })
      logger?.info("review.session.rejected_concurrent", {
        rejectedSessionId: sessionId,
        activeSessionId: state.currentSessionId,
      })
      return
    }

    if (!state.enabled) {
      logger?.info("review.session.activated", { sessionId, title })
      state.enabled = true
      state.currentRound = 1
      state.modelsUsed = []
      state.startedAt = Date.now()
      state.sessionTitle = title
      state.currentSessionId = sessionId
      state.currentModelId = null
      state.processedMessageKeys = []
      state.totalRounds = resolvedConfig.totalRounds
      clearMessageModelMap()
      saveState(state)
    } else {
      state.sessionTitle = title
      saveState(state)
    }
    return
  }

  // ── message.updated (model tracking, scoped to active session) ───────────
  if (event.type === "message.updated") {
    const properties = (event as Record<string, unknown>).properties as Record<string, unknown> | undefined
    const message = properties?.info as Record<string, unknown> | undefined
    if (!message) return
    if (message.role !== "assistant") return

    const msgSessionId = message.sessionID as string | undefined
    if (state.currentSessionId && msgSessionId !== state.currentSessionId) return

    const providerID = message.providerID as string | undefined
    const modelID = message.modelID as string | undefined
    if (!providerID || !modelID) return

    const modelId = `${providerID}/${modelID}`
    const msgId = message.id as string | undefined
    if (msgId) messageModelMap.set(msgId, modelId)
    state.currentModelId = modelId
    return
  }

  // ── message.part.updated (marker detection) ─────────────────────────────
  if (event.type === "message.part.updated") {
    const properties = (event as Record<string, unknown>).properties as Record<string, unknown> | undefined
    const part = properties?.part as Record<string, unknown> | undefined
    if (!part) return
    if (part.type !== "text") return
    if (!resolvedConfig.enabled) return

    const text = part.text as string | undefined
    const partSessionId = part.sessionID as string | undefined
    const messageId = part.messageID as string | undefined

    if (typeof text !== "string") return
    if (!partSessionId || !messageId) return

    const key = `${partSessionId}:${messageId}`

    // Activation trigger — only if review is not already active
    if (!state.enabled && text.trim().toUpperCase() === "START_ADVERSARIAL_REVIEW") {
      if (state.enabled && state.currentSessionId && state.currentSessionId !== partSessionId) {
        await safeToast(client, {
          message: "Another adversarial review is already active. Finish or reset it first.",
          variant: "error",
        })
        logger?.info("review.trigger.rejected_concurrent", { sessionId: partSessionId })
        return
      }
      logger?.info("review.activated_via_trigger", { sessionId: partSessionId })
      state.enabled = true
      state.currentRound = 1
      state.modelsUsed = []
      state.startedAt = Date.now()
      state.currentSessionId = partSessionId
      state.processedMessageKeys = []
      state.totalRounds = resolvedConfig.totalRounds
      clearMessageModelMap()
      saveState(state)
      return
    }

    if (!state.enabled || state.currentSessionId !== partSessionId) return
    if (state.processedMessageKeys.includes(key)) return

    const matchedMarker = detectRoundCompletion(text, resolvedConfig.markers)
    if (!matchedMarker) return

    state.processedMessageKeys = capProcessedKeys([...state.processedMessageKeys, key])

    const currentModel = messageModelMap.get(messageId) || state.currentModelId
    if (currentModel && !state.modelsUsed.includes(currentModel)) {
      state.modelsUsed.push(currentModel)
    }

    const elapsed = state.startedAt ? formatDuration(Date.now() - state.startedAt) : "unknown"
    const effectiveRounds = getEffectiveRounds(state, resolvedConfig)

    if (state.currentRound < effectiveRounds) {
      const nextRound = state.currentRound + 1
      const nextModelStr = resolvedConfig.models[nextRound - 1]
      state.currentRound = nextRound
      saveState(state)

      logger?.info("review.round.complete", {
        round: state.currentRound - 1,
        observedModel: currentModel || "unknown",
        nextRound,
        nextModel: nextModelStr,
        elapsed,
      })

      await safeToast(client, {
        message: `Round ${state.currentRound - 1} complete. Sending "continue adversarial review" will automatically route to ${getModelName(nextModelStr)}.`,
        variant: "info",
      })
    } else {
      saveState(state)

      logger?.info("review.complete", {
        totalRounds: effectiveRounds,
        elapsed,
        modelsUsed: state.modelsUsed,
      })

      await safeToast(client, {
        message: `All ${effectiveRounds} rounds complete (${elapsed}). Ready for synthesis.`,
        variant: "success",
      })

      resetStateInMemory(state)
      clearState()
      clearMessageModelMap()
    }
  }
}

export default AdversarialReviewPlugin
