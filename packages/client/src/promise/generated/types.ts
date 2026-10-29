export type JsonValue = null | boolean | number | string | Array<JsonValue> | { [key: string]: JsonValue }

export type ServerInfo = {
  version: string
  pid: number
  hostname?: string | undefined
  urls: Array<string>
  paths: { tmp: string }
  capabilities?: { persistentPty?: boolean | undefined } | undefined
}

export type PairingCode = { code: string; expires_in: number }

export type PairingSession = { token: string }

export type AbsolutePath = string

export type ProjectID = string

export type AgentID = string

export type ProviderID = string

export type ProviderCompaction = { type: "summary" } | { type: "native" }

export type ProviderCacheTTL = `${number}${"ms" | "s" | "m" | "h" | "d"}`

export type ProviderTransport = "http" | "websocket"

export type ProviderEncoding = "zstd" | "gzip" | "none"

export type AgentColor = string

export type PermissionEffect = "allow" | "deny" | "ask"

export type PluginID = string

export type PluginSource =
  | { type: "builtin" }
  | { type: "package"; target: string; version?: string; outdated?: true; updating?: true }
  | { type: "local"; path: string }
  | { type: "sdk" }

export type PluginFeatures = { server?: true; tui?: true; rpc?: true; gui?: true }

export type PluginState = { status: "active" } | { status: "failed"; error: string; ref?: string }

export type PluginGuiBundle = { code: string; revision: string; options: { [x: string]: JsonValue } }

export type SessionID = string

export type SessionMessageID = string

export type MoneyUSD = number

export type TokenUsageInfo = {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

export type RelativePath = string

export type SessionMetadata = { [x: string]: JsonValue }

export type SnapshotID = string

export type FileDiffInfo = {
  file: string
  patch: string
  additions: number
  deletions: number
  status: "added" | "deleted" | "modified"
  more?: true
}

export type SessionsCursor = string

export type SessionActive = { type: "running" }

export type PromptBase64 = string

export type PromptFileSource = { type: "inline" } | { type: "uri"; uri: string }

export type PromptMention = { start: number; end: number; text: string }

export type SkillID = string

export type SkillName = string

export type SessionInboxDelivery = "steer" | "queue"

export type SessionInboxSyntheticPayload = { text: string; description?: string; metadata?: { [x: string]: JsonValue } }

export type SessionInboxCompactionPayload = {}

export type ShellID = string

export type SessionMessageNative = { [x: string]: JsonValue }

export type SessionMessageToolStateStreaming = { status: "streaming"; input: string }

export type SessionMessageToolStateRunning = {
  status: "running"
  input: { [x: string]: JsonValue }
  metadata: { [x: string]: JsonValue }
}

export type ToolTextContent = { type: "text"; text: string }

export type ToolFileContent = { type: "file"; uri: string; mime: string; name?: string | null }

export type SessionStructuredError = {
  type: string
  message: string
  status?: number
  response?: { body: string }
  retryAfterMs?: number
}

export type SessionGenerateResponse = { data: { text: string } }

export type SessionInterruptResponse = { interrupted: boolean }

export type FormID = string

export type FormMetadata = { [x: string]: JsonValue }

export type FormWhen = {
  key: string
  op: "eq" | "neq"
  value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
}

export type FormOption = { value: string; label: string; description?: string }

export type FormExternalField = { key: string; type: "external"; url: string; title?: string; description?: string }

export type FormValue = string | number | "Infinity" | "-Infinity" | "NaN" | boolean | Array<string>

export type SessionStatsToolTotals = { calls: number; succeeded: number; failed: number; unfinished: number }

export type SessionStatsToolUsage = {
  name: string
  calls: number
  succeeded: number
  failed: number
  unfinished: number
  durationP50?: number
}

export type SessionStatsActivity = { date: string; steps: number }

export type InstructionEntryKey = string

export type EventID = string

export type EventSeq = number

export type WorkspaceID = string

export type InstructionKey = string

export type InstructionHash = string

export type SessionInboxSyntheticPayload1 = { text: string; description?: string; metadata?: { [x: string]: any } }

export type SessionMessageNative1 = { [x: string]: any }

export type ToolFileContent1 = { type: "file"; uri: string; mime: string; name?: string | undefined }

export type SessionMessageToolStateRunning1 = {
  status: "running"
  input: { [x: string]: any }
  metadata: { [x: string]: JsonValue }
}

export type ModelType = "chat" | "decision" | "image" | (string & {})

export type ModelReasoningField = "reasoning" | "reasoning_content" | "reasoning_text" | (string & {})

export type ModelMaxTokensField = "max_completion_tokens" | "max_tokens"

export type ModelCacheFormat = "anthropic" | "alibaba"

export type ModelMediaInput = "assets" | "state" | "root"

export type ModelCapabilities = { tools: boolean; input: Array<string>; output: Array<string>; temperature?: boolean }

export type MoneyUSDPerMillionTokens = number

export type GenerateTextResponse = { data: { text: string } }

export type GenerateUsage = { input?: number; output?: number }

export type GenerateNative = { [x: string]: JsonValue }

export type GeneratePredicateAnswer = { type: "predicate"; name: string; probability: number }

export type GenerateChoiceValue = string | boolean

export type GenerateScoreAnswer = {
  type: "score"
  name: string
  score: number
  probabilities: Array<{ value: number; label: string; probability: number }>
  confidence: number
}

export type GenerateErrorAnswer = { type: "error"; name: string; reason: string; message?: string }

export type VoiceTransportType = "webrtc" | "websocket"

export type VoiceWebRTCTransport = { type: "webrtc"; sdp: string }

export type VoiceWebSocketTransport = { type: "websocket"; url: string; token: string; expiresAt: number }

export type IntegrationID = string

export type IntegrationMethodID = string

export type IntegrationEnvMethod = { type: "env"; names: Array<string> }

export type CredentialID = string

export type ConnectionStatus = { status: "needs_auth"; message: string; url?: string }

export type IntegrationAttemptID = string

export type IntegrationAttemptStatus =
  | { status: "pending"; time: { created: number; expires: number } }
  | { status: "complete"; time: { created: number; expires: number } }
  | { status: "failed"; message: string; time: { created: number; expires: number } }
  | { status: "expired"; time: { created: number; expires: number } }

export type IntegrationCommandAttemptStatus =
  | {
      status: "pending"
      message?: string
      time: { created: number | "Infinity" | "-Infinity" | "NaN"; expires: number | "Infinity" | "-Infinity" | "NaN" }
    }
  | {
      status: "complete"
      time: { created: number | "Infinity" | "-Infinity" | "NaN"; expires: number | "Infinity" | "-Infinity" | "NaN" }
    }
  | {
      status: "failed"
      message: string
      time: { created: number | "Infinity" | "-Infinity" | "NaN"; expires: number | "Infinity" | "-Infinity" | "NaN" }
    }
  | {
      status: "expired"
      time: { created: number | "Infinity" | "-Infinity" | "NaN"; expires: number | "Infinity" | "-Infinity" | "NaN" }
    }

export type McpStatusConnected = { status: "connected" }

export type McpStatusPending = { status: "pending" }

export type McpStatusDisabled = { status: "disabled" }

export type McpStatusFailed = { status: "failed"; error: string }

export type McpStatusNeedsAuth = { status: "needs_auth"; error: string }

export type McpResource = { server: string; name: string; uri: string; description?: string; mimeType?: string }

export type McpResourceTemplate = {
  server: string
  name: string
  uriTemplate: string
  description?: string
  mimeType?: string
}

export type PtyTicketConnectToken = { ticket: string; expires_in: number }

export type CredentialKey = { type: "key"; key: string; metadata?: { [x: string]: JsonValue } }

export type ProjectVcs = string

export type ProjectIcon = { url?: string; override?: string; color?: string }

export type ProjectCommands = { start?: string }

export type ProjectTime = { created: number; updated: number; active: number; archived?: number }

export type PermissionID = string

export type PermissionSource = { type: "tool"; messageID: string; id: string }

export type PermissionSavedID = string

export type CommandInfo = { name: string; description?: string }

export type RpcOutput = { output?: any }

export type PermissionReply = "once" | "always" | "reject"

export type PtyID = string

export type FormMetadata1 = { [x: string]: any }

export type FormWhen1 = { key: string; op: "eq" | "neq"; value: string | number | boolean }

export type FormValue1 = string | number | boolean | Array<string>

export type SessionStatus =
  | { type: "idle" }
  | {
      type: "retry"
      attempt: number
      message: string
      action?: { reason: string; provider: string; title: string; message: string; label: string; link?: string }
      next: number
    }
  | { type: "busy" }

export type PersistentPtyHandoff = { directory: string; instanceID: string; ticket: string; expiresAt: number }

export type ScheduleID = string

export type ScheduleDuration = string

export type ScheduleWhenAt = { type: "at"; at: string; tz?: string }

export type ScheduleWhenCron = { type: "cron"; cron: string; tz?: string }

export type ScheduleConditionShell = { type: "shell"; run: string; is?: string; matches?: string; changes?: boolean }

export type ScheduleActionPrompt = { type: "prompt"; prompt: string }

export type ScheduleStatus = "active" | "paused" | "done"

export type ScheduleOutcome = "fired" | "late" | "checked" | "expired" | "skipped" | "disabled" | "failed"

export type ReferenceGitSource = { type: "git"; repository: string; branch?: string }

export type VcsBranch = { current?: string; default?: string }

export type VcsBase = { name: string; ref: string; source: "reflog" | "default" }

export type VcsFileStatus = {
  file: string
  additions: number
  deletions: number
  status: "added" | "deleted" | "modified"
}

export type VcsBranchList = Array<string>

export type WebSearchID = string

export type WebSearchResult = { url: string; title?: string; content?: string; time: { published?: number } }

export type UsageLimitsMeter = { percent: number; limited: boolean; resetsAt: number }

export type McpProtocol = "legacy" | "auto" | "2026-07-28"

export type ConfigWorktree = { directory: string }

export type ConfigModelReasoning =
  | { supported: false }
  | { supported: true; toggle?: boolean; effort?: Array<string>; budget?: { min?: number; max?: number } }

export type ConfigShellOption = { path: string; name: string; acceptable: boolean }

export type LocationPublicRef = { directory: AbsolutePath }

export type FileSystemWrite = { path: AbsolutePath }

export type ReferenceLocalSource = { type: "local"; path: AbsolutePath }

export type WorktreeDirectory = { directory: AbsolutePath; strategy?: string }

export type WorktreeInfo = { directory: AbsolutePath }

export type LocationPublicInfo = {
  directory: AbsolutePath
  project: { id: ProjectID; directory: AbsolutePath; canonical: AbsolutePath }
}

export type ModelRef = { id: string; providerID: ProviderID; variant?: string }

export type ProviderCache = { ttl?: ProviderCacheTTL }

export type ModelVariantSettings = { compaction?: ProviderCompaction; encoding?: ProviderEncoding } & {
  [x: string]: any
}

export type ConfigModelVariantSettings = { compaction?: ProviderCompaction; encoding?: ProviderEncoding } & {
  [x: string]: JsonValue | null
}

export type PermissionRule = { action: string; resource: string; effect: PermissionEffect }

export type PluginInfo = { id?: PluginID; source: PluginSource; features: PluginFeatures; state: PluginState }

export type SessionForkBoundary =
  | { type: "before"; messageID: SessionMessageID }
  | { type: "through"; messageID: SessionMessageID }

export type SessionMessageAgentSelected = {
  id: SessionMessageID
  metadata?: { [x: string]: JsonValue }
  time: { created: number }
  type: "agent-switched"
  agent: AgentID
  previous?: AgentID
}

export type SessionMessageSynthetic = {
  id: SessionMessageID
  metadata?: { [x: string]: JsonValue }
  time: { created: number }
  text: string
  description?: string
  type: "synthetic"
}

export type SessionMessageSystem = {
  id: SessionMessageID
  metadata?: { [x: string]: JsonValue }
  time: { created: number }
  type: "system"
  text: string
  description?: string
}

export type SessionMessageCompactionRunning = {
  type: "compaction"
  id: SessionMessageID
  metadata?: { [x: string]: JsonValue }
  time: { created: number }
  status: "running"
  reason: "auto" | "manual"
  summary: string
}

export type UsageLimitsBudgetModel = { providerID: ProviderID; modelID: string; name: string; spent?: MoneyUSD }

export type FileSystemEntry = { path: RelativePath; type: "file" | "directory" }

export type SessionRevert = {
  messageID: SessionMessageID
  partID?: string
  snapshot?: SnapshotID
  files?: Array<FileDiffInfo>
}

export type GenerateImageOutput2 = { type: "image"; data: PromptBase64; mime: string; name?: string }

export type PromptFileAttachment = {
  data: PromptBase64
  mime: string
  source: PromptFileSource
  name?: string
  description?: string
  mention?: PromptMention
}

export type PromptAgentAttachment = { name: string; mention?: PromptMention }

export type PromptSkillAttachment = { id: SkillID; name: SkillName; text?: string; mention?: PromptMention }

export type SessionMessageSkill = {
  id: SessionMessageID
  metadata?: { [x: string]: JsonValue }
  time: { created: number }
  type: "skill"
  skill: SkillID
  name: SkillName
  text: string
}

export type SkillInfo = {
  id: SkillID
  name: SkillName
  description?: string
  autoinvoke?: boolean
  path: AbsolutePath
  content: string
}

export type SessionInboxSynthetic = {
  id: SessionMessageID
  sessionID: SessionID
  time: { created: number }
  type: "synthetic"
  payload: SessionInboxSyntheticPayload
  delivery: SessionInboxDelivery
}

export type SessionInboxCompaction = {
  id: SessionMessageID
  sessionID: SessionID
  time: { created: number }
  type: "compaction"
  payload: SessionInboxCompactionPayload
  delivery: SessionInboxDelivery
}

export type SessionMessageShell = {
  id: SessionMessageID
  metadata?: { [x: string]: JsonValue }
  time: { created: number; completed?: number }
  type: "shell"
  shellID: ShellID
  command: string
  status: "running" | "exited" | "timeout" | "killed"
  exit?: number | "Infinity" | "-Infinity" | "NaN"
  output?: { output: string; cursor: number; size: number; truncated: boolean }
}

export type ShellInfo = {
  id: ShellID
  status: "running" | "exited" | "timeout" | "killed"
  command: string
  cwd: string
  shell: string
  file: string
  pid?: number
  exit?: number
  signal?: string
  metadata: { [x: string]: any }
  time: { started: number; completed?: number }
}

export type ShellInfo1 = {
  id: ShellID
  status: "running" | "exited" | "timeout" | "killed"
  command: string
  cwd: string
  shell: string
  file: string
  pid?: number
  exit?: number
  signal?: string
  metadata: { [x: string]: JsonValue }
  time: { started: number; completed?: number }
}

export type SessionMessageAssistantText = { type: "text"; text: string; native?: SessionMessageNative }

export type SessionMessageAssistantReasoning = {
  type: "reasoning"
  text: string
  native?: SessionMessageNative
  time?: { created: number; completed?: number }
}

export type ToolContent = ToolTextContent | ToolFileContent

export type SessionMessageAssistantRetry = { attempt: number; at: number; error: SessionStructuredError }

export type SessionMessageCompactionFailed = {
  type: "compaction"
  id: SessionMessageID
  metadata?: { [x: string]: JsonValue }
  time: { created: number }
  status: "failed"
  reason: "auto" | "manual"
  error: SessionStructuredError
  cost?: MoneyUSD
  tokens?: TokenUsageInfo
}

export type SessionMessageIdle = {
  id: SessionMessageID
  metadata?: { [x: string]: JsonValue }
  time: { created: number }
  type: "idle"
  outcome: "succeeded" | "failed" | "interrupted"
  error?: SessionStructuredError
}

export type FormNumberField = {
  key: string
  title?: string
  description?: string
  required?: boolean
  hidden?: boolean
  when?: Array<FormWhen>
  type: "number"
  minimum?: number | "Infinity" | "-Infinity" | "NaN"
  maximum?: number | "Infinity" | "-Infinity" | "NaN"
  default?: number | "Infinity" | "-Infinity" | "NaN"
}

export type FormIntegerField = {
  key: string
  title?: string
  description?: string
  required?: boolean
  hidden?: boolean
  when?: Array<FormWhen>
  type: "integer"
  minimum?: number | "Infinity" | "-Infinity" | "NaN"
  maximum?: number | "Infinity" | "-Infinity" | "NaN"
  default?: number | "Infinity" | "-Infinity" | "NaN"
}

export type FormBooleanField = {
  key: string
  title?: string
  description?: string
  required?: boolean
  hidden?: boolean
  when?: Array<FormWhen>
  type: "boolean"
  default?: boolean
}

export type FormStringField = {
  key: string
  title?: string
  description?: string
  required?: boolean
  hidden?: boolean
  when?: Array<FormWhen>
  type: "string"
  format?: "email" | "uri" | "date" | "date-time"
  minLength?: number
  maxLength?: number
  pattern?: string
  placeholder?: string
  default?: string
  options?: Array<FormOption>
  custom?: boolean
}

export type FormMultiselectField = {
  key: string
  title?: string
  description?: string
  required?: boolean
  hidden?: boolean
  when?: Array<FormWhen>
  type: "multiselect"
  options: Array<FormOption>
  minItems?: number
  maxItems?: number
  custom?: boolean
  default?: Array<string>
}

export type FormAnswer = { [x: string]: FormValue }

export type SessionStatsTools =
  | { mode: "none" }
  | { mode: "summary"; totals: SessionStatsToolTotals }
  | { mode: "detail"; totals: SessionStatsToolTotals; usage: Array<SessionStatsToolUsage> }

export type InstructionEntryInfo = { key: InstructionEntryKey; value: JsonValue }

export type InstructionEntrySnapshot = Array<{ key: InstructionEntryKey; value: JsonValue; removed: boolean }>

export type EventLogSynced = { type: "log.synced"; aggregateID: string; seq?: EventSeq }

export type LocationRef = { directory: AbsolutePath; workspaceID?: WorkspaceID }

export type SessionMessageAssistantText1 = { type: "text"; text: string; native?: SessionMessageNative1 }

export type SessionMessageAssistantReasoning1 = {
  type: "reasoning"
  text: string
  native?: SessionMessageNative1
  time?: { created: number; completed?: number }
}

export type ToolContent1 = ToolTextContent | ToolFileContent1

export type ModelCompatibility = {
  reasoningField?: ModelReasoningField
  requireReasoning?: boolean
  maxTokensField?: ModelMaxTokensField
  requireFinishReason?: boolean
  requireAssistantAfterTool?: boolean
  supportsPromptCacheKey?: boolean
  streamUsage?: boolean
  cacheFormat?: ModelCacheFormat
  supportsThinkingBlockBinding?: boolean
  supportsEffortUpdates?: boolean
  mediaInput?: ModelMediaInput
}

export type ProviderCompatibility = {
  reasoningField?: ModelReasoningField
  requireReasoning?: boolean
  maxTokensField?: ModelMaxTokensField
  requireFinishReason?: boolean
  requireAssistantAfterTool?: boolean
  supportsPromptCacheKey?: boolean
  streamUsage?: boolean
  cacheFormat?: ModelCacheFormat
  mediaInput?: ModelMediaInput
}

export type ModelCost = {
  tier?: { type: "context"; size: number }
  input: MoneyUSDPerMillionTokens
  output: MoneyUSDPerMillionTokens
  cache: { read: MoneyUSDPerMillionTokens; write: MoneyUSDPerMillionTokens }
}

export type GenerateChoiceAnswer = {
  type: "choice"
  name: string
  choice: GenerateChoiceValue
  probabilities: Array<{ value: GenerateChoiceValue; probability: number }>
  confidence: number
}

export type VoiceModel = { model: string; provider: string; transports: Array<VoiceTransportType>; available: boolean }

export type VoiceTransport = VoiceWebRTCTransport | VoiceWebSocketTransport

export type IntegrationCommandMethod = {
  id: IntegrationMethodID
  type: "command"
  label: string
  command: Array<string>
}

export type CredentialOAuth = {
  type: "oauth"
  methodID: IntegrationMethodID
  refresh: string
  access: string
  expires: number
  metadata?: { [x: string]: JsonValue }
}

export type CredentialExternal = {
  type: "external"
  methodID: IntegrationMethodID
  metadata?: { [x: string]: JsonValue }
}

export type ConnectionCredentialInfo = {
  type: "credential"
  id: CredentialID
  label: string
  method: "key" | "oauth" | "external"
  status?: ConnectionStatus
}

export type ConnectionEnvInfo = { type: "env"; name: string; status?: ConnectionStatus }

export type IntegrationAttempt = {
  attemptID: IntegrationAttemptID
  url: string
  instructions: string
  mode: "auto" | "code"
  time: { created: number; expires: number }
}

export type IntegrationCommandAttempt = { attemptID: IntegrationAttemptID; time: { created: number; expires: number } }

export type McpServer = {
  name: string
  status: McpStatusConnected | McpStatusPending | McpStatusDisabled | McpStatusFailed | McpStatusNeedsAuth
  title?: string
  integrationID?: IntegrationID
}

export type McpResourceCatalog = { resources: Array<McpResource>; templates: Array<McpResourceTemplate> }

export type Project = {
  id: ProjectID
  canonical: AbsolutePath
  vcs?: ProjectVcs
  name?: string
  icon?: ProjectIcon
  commands?: ProjectCommands
  time: ProjectTime
  sandboxes: Array<string>
}

export type PermissionRequest = {
  id: PermissionID
  sessionID: SessionID
  action: string
  resources: Array<string>
  save?: Array<string>
  metadata?: { [x: string]: JsonValue }
  source?: PermissionSource
  message?: string
}

export type PermissionSavedInfo = {
  id: PermissionSavedID
  projectID: ProjectID
  action: string
  resource: string
  time: { created: number; updated: number }
}

export type Pty = {
  id: PtyID
  title: string
  command: string
  args: Array<string>
  cwd: string
  status: "running" | "exited"
  pid: number
  exitCode?: number
}

export type PersistentPtyInfo = {
  id: PtyID
  title: string
  command: string
  args: Array<string>
  cwd: string
  status: "running" | "exited"
  pid: number
  exitCode?: number
  sessionID: SessionID
  foregroundProcess: string | null
  size: { cols: number; rows: number }
  output: { head: number; tail: number }
}

export type PersistentPtyReadResult = {
  ptyID: PtyID
  title: string
  cwd: string
  foregroundProcess: string | null
  screen: { text: string; cols: number; rows: number; cursor: { x: number; y: number } }
}

export type FormStringField1 = {
  key: string
  title?: string
  description?: string
  required?: boolean
  hidden?: boolean
  when?: Array<FormWhen1>
  type: "string"
  format?: "email" | "uri" | "date" | "date-time"
  minLength?: number
  maxLength?: number
  pattern?: string
  placeholder?: string
  default?: string
  options?: Array<FormOption>
  custom?: boolean
}

export type FormNumberField1 = {
  key: string
  title?: string
  description?: string
  required?: boolean
  hidden?: boolean
  when?: Array<FormWhen1>
  type: "number"
  minimum?: number
  maximum?: number
  default?: number
}

export type FormIntegerField1 = {
  key: string
  title?: string
  description?: string
  required?: boolean
  hidden?: boolean
  when?: Array<FormWhen1>
  type: "integer"
  minimum?: number
  maximum?: number
  default?: number
}

export type FormBooleanField1 = {
  key: string
  title?: string
  description?: string
  required?: boolean
  hidden?: boolean
  when?: Array<FormWhen1>
  type: "boolean"
  default?: boolean
}

export type FormMultiselectField1 = {
  key: string
  title?: string
  description?: string
  required?: boolean
  hidden?: boolean
  when?: Array<FormWhen1>
  type: "multiselect"
  options: Array<FormOption>
  minItems?: number
  maxItems?: number
  custom?: boolean
  default?: Array<string>
}

export type FormAnswer1 = { [x: string]: FormValue1 }

export type ScheduleWhenIn = { type: "in"; in: ScheduleDuration; tz?: string }

export type ScheduleWhenEvery = { type: "every"; every: ScheduleDuration; tz?: string }

export type ScheduleCondition = ScheduleConditionShell

export type ScheduleAction = ScheduleActionPrompt

export type VcsInfo = { provider?: string; branch: VcsBranch }

export type WebSearchProvider = { id: WebSearchID; name: string }

export type UsageLimitsGo = { rolling: UsageLimitsMeter; weekly: UsageLimitsMeter; monthly: UsageLimitsMeter }

export type ConfigModelCapabilities = {
  tools?: boolean
  input?: Array<string>
  output?: Array<string>
  temperature?: boolean
  reasoning?: ConfigModelReasoning
}

export type SessionMessageLocationSwitched = {
  id: SessionMessageID
  metadata?: { [x: string]: JsonValue }
  time: { created: number }
  type: "location-switched"
  projectID?: ProjectID
  subpath?: RelativePath
  location: LocationPublicRef
  previous?: { location: LocationPublicRef; projectID?: ProjectID; subpath?: RelativePath } | null
}

export type SessionInboxMovePayload = { projectID: ProjectID; subpath?: RelativePath; location: LocationPublicRef }

export type V2EventRpc = {
  id: EventID
  created: number
  metadata?: { [x: string]: any } | undefined
  type: `${"rpc."}${string}`
  location: LocationPublicRef
  data: { [x: string]: any }
}

export type V2EventServerConnected = {
  id: EventID
  metadata?: { [x: string]: any } | undefined
  location?: LocationPublicRef | undefined
  type: "server.connected"
  data: {}
}

export type ReferenceSource = ReferenceLocalSource | ReferenceGitSource

export type WorktreeList = Array<WorktreeDirectory>

export type SessionMessageModelSelected = {
  id: SessionMessageID
  metadata?: { [x: string]: JsonValue }
  time: { created: number }
  type: "model-switched"
  model: ModelRef
  previous?: ModelRef
}

export type SessionMessageCompactionCompleted = {
  type: "compaction"
  id: SessionMessageID
  metadata?: { [x: string]: JsonValue }
  time: { created: number }
  status: "completed"
  reason: "auto" | "manual"
  model?: ModelRef
  native?: SessionMessageNative
  summary: string
  cost?: MoneyUSD
  tokens?: TokenUsageInfo
}

export type SessionStatsModelUsage = { model: ModelRef; steps: number; tokens: TokenUsageInfo; cost: MoneyUSD }

export type ProviderSettings = {
  timeout?: number | false
  headerTimeout?: number | false
  chunkTimeout?: number | false
  compaction?: ProviderCompaction
  cache?: ProviderCache
  transport?: ProviderTransport
  encoding?: ProviderEncoding
} & { [x: string]: any }

export type ModelSettings = { compaction?: ProviderCompaction; cache?: ProviderCache; encoding?: ProviderEncoding } & {
  [x: string]: any
}

export type ConfigProviderSettings = {
  timeout?: number | false
  headerTimeout?: number | false
  chunkTimeout?: number | false
  compaction?: ProviderCompaction
  cache?: ProviderCache
  transport?: ProviderTransport
  encoding?: ProviderEncoding
} & { [x: string]: JsonValue | null }

export type ConfigModelSettings = {
  compaction?: ProviderCompaction
  cache?: ProviderCache
  encoding?: ProviderEncoding
} & { [x: string]: JsonValue | null }

export type ModelVariant = {
  id: string
  settings?: ModelVariantSettings
  headers?: { [x: string]: string }
  body?: { [x: string]: any }
}

export type PermissionRuleset = Array<PermissionRule>

export type UsageLimitsBudget = {
  id: string
  limit: MoneyUSD
  spent: MoneyUSD
  scope: "each" | "combined"
  per: "set" | "model"
  coverage: "all" | "models"
  models: Array<UsageLimitsBudgetModel>
  vendors: Array<string>
  inputPriceAtLeast?: MoneyUSDPerMillionTokens
  picked: boolean
  shared: boolean
  resetsAt: number
}

export type GenerateImageResult = {
  images: Array<GenerateImageOutput2>
  cost?: MoneyUSD
  tokens?: GenerateUsage
  native?: GenerateNative
}

export type SessionInboxUserPayload = {
  text: string
  files?: Array<PromptFileAttachment>
  agents?: Array<PromptAgentAttachment>
  skills?: Array<PromptSkillAttachment>
  metadata?: { [x: string]: JsonValue }
}

export type SessionMessageUser = {
  id: SessionMessageID
  metadata?: { [x: string]: JsonValue }
  time: { created: number }
  text: string
  files?: Array<PromptFileAttachment>
  agents?: Array<PromptAgentAttachment>
  skills?: Array<PromptSkillAttachment>
  type: "user"
}

export type SessionInboxUserPayload1 = {
  text: string
  files?: Array<PromptFileAttachment>
  agents?: Array<PromptAgentAttachment>
  skills?: Array<PromptSkillAttachment>
  metadata?: { [x: string]: any }
}

export type SessionMessageToolStateCompleted = {
  status: "completed"
  input: { [x: string]: JsonValue }
  content: [ToolContent, ...Array<ToolContent>]
  metadata?: { [x: string]: JsonValue }
}

export type SessionMessageToolStateError = {
  status: "error"
  input: { [x: string]: JsonValue }
  error: SessionStructuredError
  content?: [ToolContent, ...Array<ToolContent>]
  metadata?: { [x: string]: JsonValue }
}

export type FormField =
  | FormStringField
  | FormNumberField
  | FormIntegerField
  | FormBooleanField
  | FormMultiselectField
  | FormExternalField

export type FormState =
  | { status: "pending" }
  | { status: "answered"; answer: FormAnswer }
  | { status: "cancelled"; message?: string }

export type SessionAgentSelected = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.agent.selected"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: { sessionID: SessionID; agent: AgentID; previous?: AgentID }
}

export type SessionModelSelected = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.model.selected"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: { sessionID: SessionID; model: ModelRef; previous?: ModelRef }
}

export type SessionMoved = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.moved"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: { sessionID: SessionID; location: LocationRef; projectID: ProjectID; subpath?: RelativePath }
}

export type SessionRenamed = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.renamed"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: { sessionID: SessionID; title: string }
}

export type SessionMetadataUpdated = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.metadata.updated"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: { sessionID: SessionID; metadata: SessionMetadata }
}

export type SessionViewed = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.viewed"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: { sessionID: SessionID; idle: number }
}

export type SessionArchived = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.archived"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: { sessionID: SessionID }
}

export type SessionUnarchived = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.unarchived"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: { sessionID: SessionID }
}

export type SessionDeleted = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.deleted"
  durable: { aggregateID: string; seq: EventSeq; version: 2 }
  location?: LocationRef
  data: { sessionID: SessionID }
}

export type SessionForked = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.forked"
  durable: { aggregateID: string; seq: EventSeq; version: 2 }
  location?: LocationRef
  data: {
    sessionID: SessionID
    parentID: SessionID
    boundary: SessionForkBoundary
    instructions?: { [x: InstructionKey]: InstructionHash }
    instructionEntries?: InstructionEntrySnapshot
  }
}

export type SessionInboxDelivered = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.inbox.delivered"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: { sessionID: SessionID; inboxID: SessionMessageID }
}

export type SessionInboxMovePayload1 = { location: LocationRef; projectID: ProjectID; subpath?: RelativePath }

export type SessionInboxCancelled = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.inbox.cancelled"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: { sessionID: SessionID; inboxID: SessionMessageID }
}

export type SessionInboxDeliveryChanged = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.inbox.delivery.changed"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: { sessionID: SessionID; inboxID: SessionMessageID; delivery: SessionInboxDelivery }
}

export type SessionExecutionStarted = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.execution.started"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: { sessionID: SessionID }
}

export type SessionExecutionSucceeded = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.execution.succeeded"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: { sessionID: SessionID }
}

export type SessionExecutionFailed = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.execution.failed"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: { sessionID: SessionID; error: SessionStructuredError }
}

export type SessionExecutionInterrupted = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.execution.interrupted"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: { sessionID: SessionID; reason: "user" | "shutdown" | "superseded" | "inactivity" }
}

export type SessionInstructionsUpdated = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.instructions.updated"
  durable: { aggregateID: string; seq: EventSeq; version: 2 }
  location?: LocationRef
  data: { sessionID: SessionID; delta: { [x: string]: InstructionHash | "removed" }; text?: string }
}

export type SessionSynthetic = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.synthetic"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: { sessionID: SessionID; text: string; description?: string; metadata?: { [x: string]: any } }
}

export type SessionSkillActivated = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.skill.activated"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: { sessionID: SessionID; id: SkillID; name: SkillName; text: string }
}

export type SessionShellStarted = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.shell.started"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: { sessionID: SessionID; shell: ShellInfo }
}

export type SessionShellEnded = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.shell.ended"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: {
    sessionID: SessionID
    shell: ShellInfo
    output: { output: string; cursor: number; size: number; truncated: boolean }
  }
}

export type SessionStepStarted = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.step.started"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: {
    sessionID: SessionID
    assistantMessageID: SessionMessageID
    agent: AgentID
    model: ModelRef
    snapshot?: SnapshotID
    started: number
  }
}

export type SessionStepStreamed = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.step.streamed"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: { sessionID: SessionID; assistantMessageID: SessionMessageID }
}

export type SessionStepEnded = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.step.ended"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: {
    sessionID: SessionID
    assistantMessageID: SessionMessageID
    finish: "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown"
    rawFinish?: string
    native?: SessionMessageNative1
    cost: MoneyUSD
    tokens: TokenUsageInfo
    snapshot?: SnapshotID
    files?: Array<RelativePath>
  }
}

export type SessionStepFailed = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.step.failed"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: {
    sessionID: SessionID
    assistantMessageID: SessionMessageID
    error: SessionStructuredError
    finish?: "content-filter"
    rawFinish?: string
    native?: SessionMessageNative1
    cost?: MoneyUSD
    tokens?: TokenUsageInfo
    snapshot?: SnapshotID
    files?: Array<RelativePath>
  }
}

export type SessionTextStarted = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.text.started"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: { sessionID: SessionID; assistantMessageID: SessionMessageID; ordinal: number }
}

export type SessionTextEnded = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.text.ended"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: {
    sessionID: SessionID
    assistantMessageID: SessionMessageID
    ordinal: number
    text: string
    native?: SessionMessageNative1
  }
}

export type SessionReasoningStarted = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.reasoning.started"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: { sessionID: SessionID; assistantMessageID: SessionMessageID; ordinal: number; native?: SessionMessageNative1 }
}

export type SessionReasoningEnded = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.reasoning.ended"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: {
    sessionID: SessionID
    assistantMessageID: SessionMessageID
    ordinal: number
    text: string
    native?: SessionMessageNative1
  }
}

export type SessionToolInputStarted = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.tool.input.started"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: { sessionID: SessionID; assistantMessageID: SessionMessageID; id: string; name: string }
}

export type SessionToolInputEnded = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.tool.input.ended"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: { sessionID: SessionID; assistantMessageID: SessionMessageID; id: string; text: string }
}

export type SessionToolCalled = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.tool.called"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: {
    sessionID: SessionID
    assistantMessageID: SessionMessageID
    id: string
    input: { [x: string]: any }
    executed: boolean
    native?: SessionMessageNative1
  }
}

export type SessionRetryScheduled = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.retry.scheduled"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: {
    sessionID: SessionID
    assistantMessageID: SessionMessageID
    attempt: number
    at: number
    error: SessionStructuredError
  }
}

export type SessionCompactionStarted = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.compaction.started"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: { sessionID: SessionID; reason: "auto" | "manual"; inputID?: SessionMessageID }
}

export type SessionCompactionEnded = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.compaction.ended"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: {
    sessionID: SessionID
    reason: "auto" | "manual"
    model?: ModelRef
    native?: SessionMessageNative1
    text: string
    cost?: MoneyUSD
    tokens?: TokenUsageInfo
  }
}

export type SessionCompactionFailed = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.compaction.failed"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: {
    sessionID: SessionID
    reason: "auto" | "manual"
    error: SessionStructuredError
    inputID?: SessionMessageID
    cost?: MoneyUSD
    tokens?: TokenUsageInfo
  }
}

export type SessionRevertStaged = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.revert.staged"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: { sessionID: SessionID; revert: SessionRevert }
}

export type SessionRevertCleared = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.revert.cleared"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: { sessionID: SessionID }
}

export type SessionRevertCommitted = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.revert.committed"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: { sessionID: SessionID; to: SessionMessageID }
}

export type SessionUsageRecorded = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.usage.recorded"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: { sessionID: SessionID; source: "title" | "compaction"; cost: MoneyUSD; tokens: TokenUsageInfo }
}

export type LocationShutdown = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "location.shutdown"
  location?: LocationRef
  data: {}
}

export type ModelsDevRefreshed = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "models-dev.refreshed"
  location?: LocationRef
  data: {}
}

export type CredentialUpdated = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "credential.updated"
  location?: LocationRef
  data: {}
}

export type CredentialSwitched = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "credential.switched"
  location?: LocationRef
  data: { integrationID: IntegrationID; credentialID: CredentialID | null }
}

export type IntegrationUpdated = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "integration.updated"
  location?: LocationRef
  data: {}
}

export type ProviderUpdated = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "provider.updated"
  location?: LocationRef
  data: {}
}

export type ModelUpdated = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "model.updated"
  location?: LocationRef
  data: {}
}

export type AgentUpdated = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "agent.updated"
  location?: LocationRef
  data: {}
}

export type SessionUsageUpdated = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.usage.updated"
  location?: LocationRef
  data: { sessionID: SessionID; cost: MoneyUSD; tokens: TokenUsageInfo }
}

export type SessionTextDelta = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.text.delta"
  location?: LocationRef
  data: { sessionID: SessionID; assistantMessageID: SessionMessageID; ordinal: number; delta: string }
}

export type SessionReasoningDelta = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.reasoning.delta"
  location?: LocationRef
  data: { sessionID: SessionID; assistantMessageID: SessionMessageID; ordinal: number; delta: string }
}

export type SessionToolInputDelta = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.tool.input.delta"
  location?: LocationRef
  data: { sessionID: SessionID; assistantMessageID: SessionMessageID; id: string; delta: string }
}

export type SessionToolProgress = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.tool.progress"
  location?: LocationRef
  data: { sessionID: SessionID; assistantMessageID: SessionMessageID; id: string; metadata: { [x: string]: JsonValue } }
}

export type SessionCompactionDelta = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.compaction.delta"
  location?: LocationRef
  data: { sessionID: SessionID; text: string }
}

export type FilesystemChanged = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "filesystem.changed"
  location?: LocationRef
  data: { file: string; event: "add" | "change" | "unlink" }
}

export type ReferenceUpdated = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "reference.updated"
  location?: LocationRef
  data: {}
}

export type PermissionAsked = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "permission.asked"
  location?: LocationRef
  data: {
    id: PermissionID
    sessionID: SessionID
    action: string
    resources: Array<string>
    save?: Array<string>
    metadata?: { [x: string]: any }
    source?: PermissionSource
    message?: string
  }
}

export type PermissionReplied = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "permission.replied"
  location?: LocationRef
  data: { sessionID: SessionID; requestID: PermissionID; reply: PermissionReply }
}

export type PluginUpdated = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "plugin.updated"
  location?: LocationRef
  data: {}
}

export type ProjectUpdated = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "project.updated"
  location?: LocationRef
  data: {
    id: ProjectID
    canonical: AbsolutePath
    vcs?: ProjectVcs
    name?: string
    icon?: ProjectIcon
    commands?: ProjectCommands
    time: ProjectTime
    sandboxes: Array<string>
  }
}

export type WorktreeUpdated = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "worktree.updated"
  location?: LocationRef
  data: { projectID: ProjectID }
}

export type WorktreeResolved = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "worktree.resolved"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: { projectID: ProjectID; directory: AbsolutePath; previous: ProjectID; adopted?: Array<ProjectID> }
}

export type CommandUpdated = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "command.updated"
  location?: LocationRef
  data: {}
}

export type ConfigUpdated = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "config.updated"
  location?: LocationRef
  data: {}
}

export type SkillUpdated = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "skill.updated"
  location?: LocationRef
  data: {}
}

export type PtyExited = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "pty.exited"
  location?: LocationRef
  data: { id: PtyID; exitCode: number }
}

export type PtyDeleted = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "pty.deleted"
  location?: LocationRef
  data: { id: PtyID }
}

export type PersistentPtyRemoved = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "persistent-pty.removed"
  location?: LocationRef
  data: { sessionID: SessionID; ptyID: PtyID }
}

export type ShellCreated = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "shell.created"
  location?: LocationRef
  data: { info: ShellInfo }
}

export type ShellExited = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "shell.exited"
  location?: LocationRef
  data: { id: ShellID; exit?: number; status: "running" | "exited" | "timeout" | "killed" }
}

export type ShellDeleted = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "shell.deleted"
  location?: LocationRef
  data: { id: ShellID }
}

export type FormCancelled = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "form.cancelled"
  location?: LocationRef
  data: { id: FormID; sessionID: string }
}

export type WebsearchUpdated = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "websearch.updated"
  location?: LocationRef
  data: {}
}

export type SessionStatusUpdated = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.status"
  location?: LocationRef
  data: { sessionID: SessionID; status: SessionStatus }
}

export type SessionIdle = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.idle"
  location?: LocationRef
  data: { sessionID: SessionID }
}

export type TuiPromptAppend = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "tui.prompt.append"
  location?: LocationRef
  data: { text: string }
}

export type TuiCommandExecute = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "tui.command.execute"
  location?: LocationRef
  data: {
    command:
      | "session.list"
      | "session.new"
      | "session.interrupt"
      | "session.background"
      | "session.compact"
      | "session.page.up"
      | "session.page.down"
      | "session.line.up"
      | "session.line.down"
      | "session.half.page.up"
      | "session.half.page.down"
      | "session.first"
      | "session.last"
      | "prompt.clear"
      | "prompt.submit"
      | "agent.cycle"
      | (string & {})
  }
}

export type TuiToastShow = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "tui.toast.show"
  location?: LocationRef
  data: {
    title?: string
    message: string
    variant: "info" | "success" | "warning" | "error"
    duration?: number | undefined
  }
}

export type TuiSessionSelect = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "tui.session.select"
  location?: LocationRef
  data: { sessionID: SessionID }
}

export type InstallationUpdated = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "installation.updated"
  location?: LocationRef
  data: { version: string }
}

export type InstallationUpdateAvailable = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "installation.update-available"
  location?: LocationRef
  data: { version: string }
}

export type VcsBranchUpdated = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "vcs.branch.updated"
  location?: LocationRef
  data: { branch?: string }
}

export type McpStatusChanged = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "mcp.status.changed"
  location?: LocationRef
  data: { server: string }
}

export type McpResourcesChanged = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "mcp.resources.changed"
  location?: LocationRef
  data: { server: string }
}

export type SessionToolSuccess = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.tool.success"
  durable: { aggregateID: string; seq: EventSeq; version: 2 }
  location?: LocationRef
  data: {
    sessionID: SessionID
    assistantMessageID: SessionMessageID
    id: string
    content: [ToolContent1, ...Array<ToolContent1>]
    metadata?: { [x: string]: JsonValue }
    executed: boolean
    native?: SessionMessageNative1
  }
}

export type SessionToolFailed = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.tool.failed"
  durable: { aggregateID: string; seq: EventSeq; version: 2 }
  location?: LocationRef
  data: {
    sessionID: SessionID
    assistantMessageID: SessionMessageID
    id: string
    error: SessionStructuredError
    content?: [ToolContent1, ...Array<ToolContent1>]
    metadata?: { [x: string]: JsonValue }
    executed: boolean
    native?: SessionMessageNative1
  }
}

export type SessionMessageToolStateCompleted1 = {
  status: "completed"
  input: { [x: string]: any }
  content: [ToolContent1, ...Array<ToolContent1>]
  metadata?: { [x: string]: JsonValue }
}

export type SessionMessageToolStateError1 = {
  status: "error"
  input: { [x: string]: any }
  error: SessionStructuredError
  content?: [ToolContent1, ...Array<ToolContent1>]
  metadata?: { [x: string]: JsonValue }
}

export type GenerateDecisionAnswer =
  | GeneratePredicateAnswer
  | GenerateChoiceAnswer
  | GenerateScoreAnswer
  | GenerateErrorAnswer

export type VoiceModelsResponse = { data: { models: Array<VoiceModel>; default?: string | undefined } }

export type VoiceSessionResponse = { data: { transport: VoiceTransport } }

export type CredentialValue = CredentialOAuth | CredentialKey | CredentialExternal

export type ConnectionInfo = ConnectionCredentialInfo | ConnectionEnvInfo

export type PtyCreated = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "pty.created"
  location?: LocationRef
  data: { info: Pty }
}

export type PtyUpdated = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "pty.updated"
  location?: LocationRef
  data: { info: Pty }
}

export type PersistentPtyAdded = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "persistent-pty.added"
  location?: LocationRef
  data: { sessionID: SessionID; terminal: PersistentPtyInfo }
}

export type PersistentPtySnapshot = {
  info: PersistentPtyInfo
  text: string
  checkpoint: string
  cursor: { x: number; y: number }
}

export type FormField1 =
  | FormStringField1
  | FormNumberField1
  | FormIntegerField1
  | FormBooleanField1
  | FormMultiselectField1
  | FormExternalField

export type FormReplied = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "form.replied"
  location?: LocationRef
  data: { id: FormID; sessionID: string; answer: FormAnswer1 }
}

export type ScheduleWhen = ScheduleWhenIn | ScheduleWhenAt | ScheduleWhenEvery | ScheduleWhenCron

export type SessionInboxMove = {
  id: SessionMessageID
  sessionID: SessionID
  time: { created: number }
  type: "move"
  delivery: SessionInboxDelivery
  payload: SessionInboxMovePayload
}

export type ReferenceInfo = {
  name: string
  path: AbsolutePath
  description?: string
  hidden?: boolean
  source: ReferenceSource
}

export type SessionMessageCompaction =
  | SessionMessageCompactionRunning
  | SessionMessageCompactionCompleted
  | SessionMessageCompactionFailed

export type SessionStatsInfo = {
  range: { from: number; to: number }
  sessions: number
  subagents: number
  prompts: number
  steps: number
  tokens: TokenUsageInfo
  cost: MoneyUSD
  tools: SessionStatsTools
  activeDays: number
  streak: number
  activity: Array<SessionStatsActivity>
  models: Array<SessionStatsModelUsage>
}

export type ProviderRequest = {
  settings: ProviderSettings
  headers: { [x: string]: string }
  body: { [x: string]: any }
}

export type ProviderInfo = {
  id: ProviderID
  canonical?: ProviderID
  integrationID?: IntegrationID
  name: string
  activation: "auto" | "enabled" | "disabled"
  package: string
  compatibility?: ProviderCompatibility
  settings?: ProviderSettings
  headers?: { [x: string]: string }
  body?: { [x: string]: any }
}

export type ModelInfo = {
  id: string
  modelID: string
  providerID: ProviderID
  canonical?: ProviderID
  type?: ModelType
  family?: string
  name: string
  compatibility?: ModelCompatibility
  package?: string
  settings?: ModelSettings
  headers?: { [x: string]: string }
  body?: { [x: string]: any }
  capabilities: ModelCapabilities
  variants: Array<ModelVariant>
  time: { released: number }
  cost: Array<ModelCost>
  status: "alpha" | "beta" | "deprecated" | "active"
  enabled: boolean
  limit: { context: number; input?: number; output: number }
}

export type SessionInfo = {
  id: SessionID
  parentID?: SessionID
  fork?: { sessionID: SessionID; boundary: SessionForkBoundary }
  projectID: ProjectID
  agent?: AgentID
  model?: ModelRef
  cost: MoneyUSD
  tokens: TokenUsageInfo
  outcome?: "succeeded" | "failed" | "interrupted"
  time: { created: number; updated: number; busy?: number; idle?: number; viewed?: number; archived?: number }
  title?: string
  subpath?: RelativePath
  metadata?: SessionMetadata
  permissions?: PermissionRuleset
  revert?: SessionRevert
  location: LocationPublicRef
}

export type SessionCreated = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.created"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: {
    sessionID: SessionID
    projectID: ProjectID
    location: LocationRef
    subpath?: RelativePath
    parentID?: SessionID
    slug: string
    title?: string
    agent?: AgentID
    model?: ModelRef
    metadata?: SessionMetadata
    permissions?: PermissionRuleset
    version: string
  }
}

export type SessionPermissions = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.permissions"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: { sessionID: SessionID; permissions: PermissionRuleset }
}

export type ConfigEntry =
  | {
      type: "document"
      path?: AbsolutePath
      info: {
        $schema?: string
        shell?: string
        model?: string | { providerID: string; model: string; variant?: string }
        default_agent?: string
        update?: "disable" | "notify" | "auto"
        share?: "manual" | "auto" | "disabled"
        enterprise?: { url?: string }
        username?: string
        timezone?: string
        permissions?: PermissionRuleset
        policies?: Array<{
          action:
            | "provider.use"
            | "tool.use"
            | "integration.connect"
            | "integration.use"
            | "mcp.use"
            | "skill.use"
            | "plugin.use"
          resource: string
          effect: "allow" | "deny"
        }>
        agents?: {
          [x: string]: {
            model?: string | { providerID: string; model: string; variant?: string }
            request?: { headers?: { [x: string]: string }; body?: { [x: string]: JsonValue } }
            system?: string
            description?: string
            mode?: "subagent" | "primary" | "all"
            hidden?: boolean
            color?: string
            steps?: number
            disabled?: boolean
            permissions?: PermissionRuleset
          }
        }
        snapshots?: boolean
        watcher?: { ignore?: Array<string> }
        formatter?:
          | boolean
          | {
              [x: string]: {
                disabled?: boolean
                command?: Array<string>
                environment?: { [x: string]: string }
                extensions?: Array<string>
              }
            }
        lsp?:
          | boolean
          | {
              [x: string]:
                | { disabled: true }
                | {
                    command: Array<string>
                    extensions?: Array<string>
                    disabled?: boolean
                    env?: { [x: string]: string }
                    initialization?: { [x: string]: JsonValue }
                  }
            }
        media?: {
          image?: { auto_resize?: boolean; max_width?: number; max_height?: number; max_base64_bytes?: number }
        }
        tool_output?: { max_lines?: number; max_bytes?: number }
        mcp?: {
          timeout?: { startup?: number; catalog?: number; execution?: number }
          servers?: {
            [x: string]:
              | {
                  type: "local"
                  command: Array<string>
                  cwd?: string
                  environment?: { [x: string]: string }
                  disabled?: boolean
                  codemode?: boolean
                  timeout?: { startup?: number; catalog?: number; execution?: number }
                  protocol?: McpProtocol
                }
              | {
                  type: "remote"
                  url: string
                  headers?: { [x: string]: string }
                  oauth?:
                    | {
                        client_id?: string
                        client_secret?: string
                        scope?: string
                        callback_port?: number
                        redirect_uri?: string
                        auth_server_metadata_url?: string
                      }
                    | false
                  disabled?: boolean
                  codemode?: boolean
                  timeout?: { startup?: number; catalog?: number; execution?: number }
                  protocol?: McpProtocol
                }
          }
        }
        compaction?: { auto?: boolean; keep?: { tokens?: number }; buffer?: number }
        skills?: Array<string>
        commands?: {
          [x: string]: {
            template: string
            description?: string
            agent?: string
            model?: string | { providerID: string; model: string; variant?: string }
            subagent?: boolean
            subtask?: boolean
          }
        }
        instructions?: Array<string>
        references?: {
          [x: string]:
            | string
            | { repository: string; branch?: string; description?: string; hidden?: boolean }
            | { path: string; description?: string; hidden?: boolean }
        }
        websearch?: false | { provider: "random" | WebSearchID }
        plugins?: Array<string | { package: string; options?: { [x: string]: JsonValue } }>
        worktree?: ConfigWorktree
        warming?: boolean | { prompt?: string; interval?: string; duration?: string }
        providers?: {
          [x: string]: {
            canonical?: ProviderID
            name?: string
            env?: Array<string>
            package?: string
            compatibility?: ProviderCompatibility
            settings?: ConfigProviderSettings
            headers?: { [x: string]: string }
            body?: { [x: string]: JsonValue }
            models?: {
              [x: string]: {
                modelID?: string
                type?: ModelType
                family?: string
                name?: string
                releaseDate?: string
                compatibility?: ModelCompatibility
                package?: string
                settings?: ConfigModelSettings
                headers?: { [x: string]: string }
                body?: { [x: string]: JsonValue }
                capabilities?: ConfigModelCapabilities
                variants?: Array<{
                  id: string
                  settings?: ConfigModelVariantSettings
                  headers?: { [x: string]: string }
                  body?: { [x: string]: JsonValue }
                }>
                cost?:
                  | {
                      tier?: { type: "context"; size: number }
                      input: MoneyUSDPerMillionTokens
                      output: MoneyUSDPerMillionTokens
                      cache?: { read?: MoneyUSDPerMillionTokens; write?: MoneyUSDPerMillionTokens }
                    }
                  | Array<{
                      tier?: { type: "context"; size: number }
                      input: MoneyUSDPerMillionTokens
                      output: MoneyUSDPerMillionTokens
                      cache?: { read?: MoneyUSDPerMillionTokens; write?: MoneyUSDPerMillionTokens }
                    }>
                disabled?: boolean
                limit?: { context?: number; input?: number; output?: number }
              }
            }
          }
        }
        experimental?: {
          portable_shell_scanner?: boolean
          todo?: boolean
          background_compaction?: boolean
          media_blob?: boolean
          image_generate?: boolean | { model?: string | { providerID: string; model: string; variant?: string } }
          schedules?: boolean
          subagent_depth?: number
          location_idle_timeout?: string | false
          policies?: Array<{
            action:
              | "provider.use"
              | "tool.use"
              | "integration.connect"
              | "integration.use"
              | "mcp.use"
              | "skill.use"
              | "plugin.use"
            resource: string
            effect: "allow" | "deny"
          }>
        }
      }
    }
  | { type: "directory"; path: AbsolutePath }

export type UsageLimitsInfo = {
  workspace: { id: string; name?: string; usageURL: string }
  go?: UsageLimitsGo
  budgets: Array<UsageLimitsBudget>
}

export type GenerateImageResponse = { data: GenerateImageResult }

export type SessionInboxUser = {
  id: SessionMessageID
  sessionID: SessionID
  time: { created: number }
  type: "user"
  payload: SessionInboxUserPayload
  delivery: SessionInboxDelivery
}

export type SessionMessageAssistantTool = {
  type: "tool"
  id: string
  name: string
  executed?: boolean
  native?: SessionMessageNative
  state:
    | SessionMessageToolStateStreaming
    | SessionMessageToolStateRunning
    | SessionMessageToolStateCompleted
    | SessionMessageToolStateError
  time: { created: number; ran?: number; completed?: number }
}

export type FormFields = [FormField, ...Array<FormField>]

export type SessionInboxItem =
  | { type: "user"; payload: SessionInboxUserPayload1; delivery: SessionInboxDelivery }
  | { type: "synthetic"; payload: SessionInboxSyntheticPayload1; delivery: SessionInboxDelivery }
  | { type: "compaction"; payload: SessionInboxCompactionPayload; delivery: SessionInboxDelivery }
  | { type: "move"; payload: SessionInboxMovePayload1; delivery: SessionInboxDelivery }

export type SessionMessageAssistantTool1 = {
  type: "tool"
  id: string
  name: string
  executed?: boolean
  native?: SessionMessageNative1
  state:
    | SessionMessageToolStateStreaming
    | SessionMessageToolStateRunning1
    | SessionMessageToolStateCompleted1
    | SessionMessageToolStateError1
  time: { created: number; ran?: number; completed?: number }
}

export type GenerateDecisionResult = {
  answers: Array<GenerateDecisionAnswer>
  cost?: MoneyUSD
  tokens?: GenerateUsage
  native?: GenerateNative
}

export type CredentialEntry = {
  id: CredentialID
  integrationID: IntegrationID
  label: string
  active: boolean
  value: CredentialValue
}

export type FormFields1 = [FormField1, ...Array<FormField1>]

export type ScheduleInfo = {
  id: ScheduleID
  sessionID?: SessionID
  name?: string
  when: ScheduleWhen
  tz: string
  if?: ScheduleCondition
  until?: ScheduleCondition
  action: ScheduleAction
  status: ScheduleStatus
  nextDueAt?: number
  endsAt?: number
  remainingRuns?: number
  runCount: number
  lastFiredAt?: number
  lastOutcome?: ScheduleOutcome
  lastOutput?: string
  time: { created: number; updated: number }
}

export type AgentInfo = {
  id: AgentID
  name: string
  model?: ModelRef
  request: ProviderRequest
  system?: string
  description?: string
  mode: "subagent" | "primary" | "all"
  hidden: boolean
  color?: AgentColor
  steps?: number
  permissions: PermissionRuleset
}

export type SessionsResponse = {
  data: Array<SessionInfo>
  cursor: { previous?: SessionsCursor | null; next?: SessionsCursor | null }
}

export type SessionInboxInfo = SessionInboxUser | SessionInboxSynthetic | SessionInboxCompaction | SessionInboxMove

export type SessionMessageAssistant = {
  id: SessionMessageID
  metadata?: { [x: string]: JsonValue }
  time: { created: number; streamed?: number; completed?: number }
  type: "assistant"
  agent: AgentID
  model: ModelRef
  content: Array<SessionMessageAssistantText | SessionMessageAssistantReasoning | SessionMessageAssistantTool>
  snapshot?: { start?: SnapshotID; end?: SnapshotID; files?: Array<RelativePath> }
  finish?: "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown"
  rawFinish?: string
  native?: SessionMessageNative
  cost?: MoneyUSD
  tokens?: TokenUsageInfo
  error?: SessionStructuredError
  retry?: SessionMessageAssistantRetry
}

export type FormInfo = { id: FormID; sessionID: string; title: string; metadata?: FormMetadata; fields: FormFields }

export type FormDetail = {
  id: FormID
  sessionID: string
  title: string
  metadata?: FormMetadata
  fields: FormFields
  state: FormState
}

export type IntegrationOAuthMethod = { id: IntegrationMethodID; type: "oauth"; label: string; form?: FormFields }

export type IntegrationKeyMethod = { type: "key"; label?: string; form?: FormFields }

export type IntegrationExternalMethod = { id: IntegrationMethodID; type: "external"; label: string; form?: FormFields }

export type SessionInboxEnqueued = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.inbox.enqueued"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: { sessionID: SessionID; inboxID: SessionMessageID; item: SessionInboxItem }
}

export type SessionMessageAssistantContentEncoded =
  | SessionMessageAssistantText1
  | SessionMessageAssistantReasoning1
  | SessionMessageAssistantTool1

export type GenerateDecisionsResponse = { data: GenerateDecisionResult }

export type FormInfo1 = { id: FormID; sessionID: string; title: string; metadata?: FormMetadata1; fields: FormFields1 }

export type SessionMessageInfo =
  | SessionMessageAgentSelected
  | SessionMessageModelSelected
  | SessionMessageLocationSwitched
  | SessionMessageUser
  | SessionMessageSynthetic
  | SessionMessageSystem
  | SessionMessageSkill
  | SessionMessageShell
  | SessionMessageAssistant
  | SessionMessageCompaction
  | SessionMessageIdle

export type IntegrationMethod =
  | IntegrationOAuthMethod
  | IntegrationCommandMethod
  | IntegrationKeyMethod
  | IntegrationExternalMethod
  | IntegrationEnvMethod

export type SessionMessageContentUpdated = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "session.message.content.updated"
  durable: { aggregateID: string; seq: EventSeq; version: 1 }
  location?: LocationRef
  data: { sessionID: SessionID; messageID: SessionMessageID; content: Array<SessionMessageAssistantContentEncoded> }
}

export type FormCreated = {
  id: EventID
  created: number
  metadata?: { [x: string]: any }
  type: "form.created"
  location?: LocationRef
  data: { form: FormInfo1 }
}

export type SessionTransferData = { info: SessionInfo; messages: Array<SessionMessageInfo> }

export type SessionMessagesResponse = {
  data: Array<SessionMessageInfo>
  cursor: { previous?: string | null; next?: string | null }
}

export type IntegrationInfo = {
  id: IntegrationID
  name: string
  metadata?: { [x: string]: any }
  methods: Array<IntegrationMethod>
  connections: Array<ConnectionInfo>
}

export type SessionEventDurable =
  | SessionCreated
  | SessionAgentSelected
  | SessionModelSelected
  | SessionMoved
  | SessionRenamed
  | SessionMetadataUpdated
  | SessionPermissions
  | SessionViewed
  | SessionArchived
  | SessionUnarchived
  | SessionDeleted
  | SessionForked
  | SessionInboxDelivered
  | SessionInboxEnqueued
  | SessionInboxCancelled
  | SessionInboxDeliveryChanged
  | SessionExecutionStarted
  | SessionExecutionSucceeded
  | SessionExecutionFailed
  | SessionExecutionInterrupted
  | SessionInstructionsUpdated
  | SessionSynthetic
  | SessionSkillActivated
  | SessionShellStarted
  | SessionShellEnded
  | SessionStepStarted
  | SessionStepStreamed
  | SessionStepEnded
  | SessionStepFailed
  | SessionTextStarted
  | SessionTextEnded
  | SessionReasoningStarted
  | SessionReasoningEnded
  | SessionToolInputStarted
  | SessionToolInputEnded
  | SessionToolCalled
  | SessionToolSuccess
  | SessionToolFailed
  | SessionRetryScheduled
  | SessionCompactionStarted
  | SessionCompactionEnded
  | SessionCompactionFailed
  | SessionRevertStaged
  | SessionRevertCleared
  | SessionRevertCommitted
  | SessionUsageRecorded
  | SessionMessageContentUpdated

export type V2Event =
  | LocationShutdown
  | ModelsDevRefreshed
  | CredentialUpdated
  | CredentialSwitched
  | IntegrationUpdated
  | ProviderUpdated
  | ModelUpdated
  | AgentUpdated
  | SessionCreated
  | SessionAgentSelected
  | SessionModelSelected
  | SessionMoved
  | SessionRenamed
  | SessionMetadataUpdated
  | SessionPermissions
  | SessionViewed
  | SessionArchived
  | SessionUnarchived
  | SessionUsageUpdated
  | SessionDeleted
  | SessionForked
  | SessionInboxDelivered
  | SessionInboxEnqueued
  | SessionInboxCancelled
  | SessionInboxDeliveryChanged
  | SessionExecutionStarted
  | SessionExecutionSucceeded
  | SessionExecutionFailed
  | SessionExecutionInterrupted
  | SessionInstructionsUpdated
  | SessionSynthetic
  | SessionSkillActivated
  | SessionShellStarted
  | SessionShellEnded
  | SessionStepStarted
  | SessionStepStreamed
  | SessionStepEnded
  | SessionStepFailed
  | SessionTextStarted
  | SessionTextDelta
  | SessionTextEnded
  | SessionReasoningStarted
  | SessionReasoningDelta
  | SessionReasoningEnded
  | SessionToolInputStarted
  | SessionToolInputDelta
  | SessionToolInputEnded
  | SessionToolCalled
  | SessionToolProgress
  | SessionToolSuccess
  | SessionToolFailed
  | SessionRetryScheduled
  | SessionCompactionStarted
  | SessionCompactionDelta
  | SessionCompactionEnded
  | SessionCompactionFailed
  | SessionRevertStaged
  | SessionRevertCleared
  | SessionRevertCommitted
  | FilesystemChanged
  | ReferenceUpdated
  | PermissionAsked
  | PermissionReplied
  | PluginUpdated
  | ProjectUpdated
  | WorktreeUpdated
  | WorktreeResolved
  | CommandUpdated
  | ConfigUpdated
  | SkillUpdated
  | PtyCreated
  | PtyUpdated
  | PtyExited
  | PtyDeleted
  | PersistentPtyAdded
  | PersistentPtyRemoved
  | ShellCreated
  | ShellExited
  | ShellDeleted
  | FormCreated
  | FormReplied
  | FormCancelled
  | WebsearchUpdated
  | SessionStatusUpdated
  | SessionIdle
  | TuiPromptAppend
  | TuiCommandExecute
  | TuiToastShow
  | TuiSessionSelect
  | InstallationUpdated
  | InstallationUpdateAvailable
  | VcsBranchUpdated
  | McpStatusChanged
  | McpResourcesChanged
  | V2EventRpc
  | V2EventServerConnected

export type SessionLogItem = SessionEventDurable | EventLogSynced

export type InvalidRequestError = {
  readonly _tag: "InvalidRequestError"
  readonly message: string
  readonly kind?: string | undefined
  readonly field?: string | undefined
}
export const isInvalidRequestError = (value: unknown): value is InvalidRequestError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "InvalidRequestError"

export type UnauthorizedError = { readonly _tag: "UnauthorizedError"; readonly message: string }
export const isUnauthorizedError = (value: unknown): value is UnauthorizedError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "UnauthorizedError"

export type LocationNotFoundError = {
  readonly _tag: "LocationNotFoundError"
  readonly location: { readonly directory: string }
  readonly message: string
}
export const isLocationNotFoundError = (value: unknown): value is LocationNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "LocationNotFoundError"

export type ServiceUnavailableError = {
  readonly _tag: "ServiceUnavailableError"
  readonly message: string
  readonly service?: string | undefined
}
export const isServiceUnavailableError = (value: unknown): value is ServiceUnavailableError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ServiceUnavailableError"

export type AgentNotFoundError = {
  readonly _tag: "AgentNotFoundError"
  readonly agentID: string
  readonly message: string
}
export const isAgentNotFoundError = (value: unknown): value is AgentNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "AgentNotFoundError"

export type PluginNotFoundError = {
  readonly _tag: "PluginNotFoundError"
  readonly pluginID: string
  readonly message: string
}
export const isPluginNotFoundError = (value: unknown): value is PluginNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "PluginNotFoundError"

export type InvalidCursorError = { readonly _tag: "InvalidCursorError"; readonly message: string }
export const isInvalidCursorError = (value: unknown): value is InvalidCursorError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "InvalidCursorError"

export type SessionNotFoundError = {
  readonly _tag: "SessionNotFoundError"
  readonly sessionID: string
  readonly message: string
}
export const isSessionNotFoundError = (value: unknown): value is SessionNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "SessionNotFoundError"

export type MessageNotFoundError = {
  readonly _tag: "MessageNotFoundError"
  readonly sessionID: string
  readonly messageID: string
  readonly message: string
}
export const isMessageNotFoundError = (value: unknown): value is MessageNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "MessageNotFoundError"

export type ConflictError = {
  readonly _tag: "ConflictError"
  readonly message: string
  readonly resource?: string | undefined
}
export const isConflictError = (value: unknown): value is ConflictError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ConflictError"

export type CommandNotFoundError = {
  readonly _tag: "CommandNotFoundError"
  readonly command: string
  readonly message: string
}
export const isCommandNotFoundError = (value: unknown): value is CommandNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "CommandNotFoundError"

export type CommandExecutionError = {
  readonly _tag: "CommandExecutionError"
  readonly command: string
  readonly message: string
}
export const isCommandExecutionError = (value: unknown): value is CommandExecutionError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "CommandExecutionError"

export type SessionBusyError = {
  readonly _tag: "SessionBusyError"
  readonly sessionID: string
  readonly message: string
}
export const isSessionBusyError = (value: unknown): value is SessionBusyError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "SessionBusyError"

export type UnknownError = {
  readonly _tag: "UnknownError"
  readonly message: string
  readonly ref?: string | undefined
}
export const isUnknownError = (value: unknown): value is UnknownError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "UnknownError"

export type FormNotFoundError = { readonly _tag: "FormNotFoundError"; readonly id: string; readonly message: string }
export const isFormNotFoundError = (value: unknown): value is FormNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "FormNotFoundError"

export type FormInvalidAnswerError = {
  readonly _tag: "FormInvalidAnswerError"
  readonly id: string
  readonly message: string
}
export const isFormInvalidAnswerError = (value: unknown): value is FormInvalidAnswerError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "FormInvalidAnswerError"

export type FormAlreadySettledError = {
  readonly _tag: "FormAlreadySettledError"
  readonly id: string
  readonly message: string
}
export const isFormAlreadySettledError = (value: unknown): value is FormAlreadySettledError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "FormAlreadySettledError"

export type SkillNotFoundError = {
  readonly _tag: "SkillNotFoundError"
  readonly skill: string
  readonly message: string
}
export const isSkillNotFoundError = (value: unknown): value is SkillNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "SkillNotFoundError"

export type InstructionEntryValueTooLargeError = {
  readonly _tag: "InstructionEntryValueTooLargeError"
  readonly actualBytes: number
  readonly maxBytes: number
  readonly message: string
}
export const isInstructionEntryValueTooLargeError = (value: unknown): value is InstructionEntryValueTooLargeError =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  value["_tag"] === "InstructionEntryValueTooLargeError"

export type ProviderNotFoundError = {
  readonly _tag: "ProviderNotFoundError"
  readonly providerID: string
  readonly message: string
}
export const isProviderNotFoundError = (value: unknown): value is ProviderNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ProviderNotFoundError"

export type ModelNotFoundError = {
  readonly _tag: "ModelNotFoundError"
  readonly providerID: string
  readonly modelID: string
  readonly message: string
}
export const isModelNotFoundError = (value: unknown): value is ModelNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ModelNotFoundError"

export type UnsupportedModelError = {
  readonly _tag: "UnsupportedModelError"
  readonly providerID: string
  readonly modelID: string
  readonly capability: string
  readonly message: string
}
export const isUnsupportedModelError = (value: unknown): value is UnsupportedModelError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "UnsupportedModelError"

export type ProviderRequestError = {
  readonly _tag: "ProviderRequestError"
  readonly providerID: string
  readonly reason: "authentication" | "rate_limit" | "content_filter" | "invalid_request" | "overloaded" | "provider"
  readonly message: string
  readonly status?: number | undefined
  readonly retryAfterMs?: number | undefined
}
export const isProviderRequestError = (value: unknown): value is ProviderRequestError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ProviderRequestError"

export type IntegrationNotFoundError = {
  readonly _tag: "IntegrationNotFoundError"
  readonly integrationID: string
  readonly message: string
}
export const isIntegrationNotFoundError = (value: unknown): value is IntegrationNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "IntegrationNotFoundError"

export type IntegrationAttemptNotFoundError = {
  readonly _tag: "IntegrationAttemptNotFoundError"
  readonly integrationID: string
  readonly attemptID: string
  readonly message: string
}
export const isIntegrationAttemptNotFoundError = (value: unknown): value is IntegrationAttemptNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "IntegrationAttemptNotFoundError"

export type IntegrationMethodNotFoundError = {
  readonly _tag: "IntegrationMethodNotFoundError"
  readonly integrationID: string
  readonly methodID: string
  readonly message: string
}
export const isIntegrationMethodNotFoundError = (value: unknown): value is IntegrationMethodNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "IntegrationMethodNotFoundError"

export type McpServerNotFoundError = {
  readonly _tag: "McpServerNotFoundError"
  readonly server: string
  readonly message: string
}
export const isMcpServerNotFoundError = (value: unknown): value is McpServerNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "McpServerNotFoundError"

export type ForbiddenError = { readonly _tag: "ForbiddenError"; readonly message: string }
export const isForbiddenError = (value: unknown): value is ForbiddenError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ForbiddenError"

export type ProjectNotFoundError = {
  readonly _tag: "ProjectNotFoundError"
  readonly projectID: string
  readonly message: string
}
export const isProjectNotFoundError = (value: unknown): value is ProjectNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ProjectNotFoundError"

export type PermissionSavedNotFoundError = {
  readonly _tag: "PermissionSavedNotFoundError"
  readonly id: string
  readonly message: string
}
export const isPermissionSavedNotFoundError = (value: unknown): value is PermissionSavedNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "PermissionSavedNotFoundError"

export type PermissionNotFoundError = {
  readonly _tag: "PermissionNotFoundError"
  readonly requestID: string
  readonly message: string
}
export const isPermissionNotFoundError = (value: unknown): value is PermissionNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "PermissionNotFoundError"

export type FileNotFoundError = { readonly _tag: "FileNotFoundError"; readonly path: string; readonly message: string }
export const isFileNotFoundError = (value: unknown): value is FileNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "FileNotFoundError"

export type RpcError = {
  readonly _tag: "RpcError"
  readonly type: string
  readonly message: string
  readonly data?: unknown | undefined
}
export const isRpcError = (value: unknown): value is RpcError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "RpcError"

export type RpcInternalError = {
  readonly _tag: "RpcInternalError"
  readonly type: "rpc.internal" | "rpc.invalid_output"
  readonly message: string
  readonly data?: unknown | undefined
}
export const isRpcInternalError = (value: unknown): value is RpcInternalError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "RpcInternalError"

export type PtyNotFoundError = { readonly _tag: "PtyNotFoundError"; readonly ptyID: string; readonly message: string }
export const isPtyNotFoundError = (value: unknown): value is PtyNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "PtyNotFoundError"

export type ScheduleNotFoundError = {
  readonly _tag: "ScheduleNotFoundError"
  readonly scheduleID: string
  readonly message: string
}
export const isScheduleNotFoundError = (value: unknown): value is ScheduleNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ScheduleNotFoundError"

export type ShellNotFoundError = { readonly _tag: "ShellNotFoundError"; readonly id: string; readonly message: string }
export const isShellNotFoundError = (value: unknown): value is ShellNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ShellNotFoundError"

export type WorktreeError = {
  readonly _tag: "WorktreeError"
  readonly name: "WorktreeError"
  readonly data: { readonly message: string; readonly forceRequired?: boolean | undefined }
}
export const isWorktreeError = (value: unknown): value is WorktreeError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "WorktreeError"

export type VcsInitNotSupportedError = {
  readonly _tag: "VcsInitNotSupportedError"
  readonly providerID: string
  readonly message: string
}
export const isVcsInitNotSupportedError = (value: unknown): value is VcsInitNotSupportedError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "VcsInitNotSupportedError"

export type ServerInfoOutput = ServerInfo

export type ServerPairOutput = PairingCode

export type ServerConnectInput = { readonly code: string }

export type ServerConnectOutput = PairingSession

export type LocationGetInput = { readonly location?: { readonly directory?: string | undefined } | undefined }

export type LocationGetOutput = LocationPublicInfo

export type LocationReloadOutput = void

export type AgentListInput = { readonly location?: { readonly directory?: string | undefined } | undefined }

export type AgentListOutput = { location: LocationPublicRef; data: Array<AgentInfo> }

export type AgentGetInput = {
  readonly agentID: string
  readonly location?: { readonly directory?: string | undefined } | undefined
}

export type AgentGetOutput = { location: LocationPublicRef; data: AgentInfo }

export type PluginListInput = { readonly location?: { readonly directory?: string | undefined } | undefined }

export type PluginListOutput = { location: LocationPublicRef; data: Array<PluginInfo> }

export type PluginGuiInput = {
  readonly location?: { readonly directory?: string | undefined } | undefined
  readonly id: string
}

export type PluginGuiOutput = { location: LocationPublicRef; data: PluginGuiBundle }

export type PluginCheckInput = {
  readonly location?: { readonly directory?: string | undefined } | undefined
  readonly target?: string | undefined
}

export type PluginCheckOutput = { location: LocationPublicRef; data: Array<PluginInfo> }

export type PluginUpdateInput = {
  readonly location?: { readonly directory?: string | undefined } | undefined
  readonly targets: ReadonlyArray<string>
}

export type PluginUpdateOutput = void

export type SessionListInput = {
  readonly limit?: number | undefined
  readonly order?: "asc" | "desc" | undefined
  readonly search?: string | undefined
  readonly parentID?: string | null | undefined
  readonly archived?: boolean | undefined
  readonly directory?: string | undefined
  readonly project?: string | undefined
  readonly subpath?: string | undefined
  readonly cursor?: string | undefined
}

export type SessionListOutput = SessionsResponse

export type SessionCreateInput = {
  readonly id?: string | null | undefined
  readonly parentID?: string | null | undefined
  readonly title?: string | null | undefined
  readonly agent?: string | null | undefined
  readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null | undefined
  readonly location?: { readonly directory: string } | null | undefined
  readonly metadata?: { readonly [x: string]: JsonValue } | null | undefined
  readonly permissions?:
    | ReadonlyArray<{ readonly action: string; readonly resource: string; readonly effect: "allow" | "deny" | "ask" }>
    | null
    | undefined
}

export type SessionCreateOutput = { data: SessionInfo }["data"]

export type SessionActiveOutput = { data: { [x: SessionID]: SessionActive } }["data"]

export type SessionGetInput = { readonly sessionID: string }

export type SessionGetOutput = { data: SessionInfo }["data"]

export type SessionRemoveInput = { readonly sessionID: string }

export type SessionRemoveOutput = void

export type SessionForkInput = { readonly sessionID: string; readonly before?: string | undefined }

export type SessionForkOutput = { data: SessionInfo }["data"]

export type SessionSwitchAgentInput = { readonly sessionID: string; readonly agent: string }

export type SessionSwitchAgentOutput = void

export type SessionSwitchModelInput = {
  readonly sessionID: string
  readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
}

export type SessionSwitchModelOutput = void

export type SessionUpdateInput = {
  readonly sessionID: string
  readonly title?: string | undefined
  readonly metadata?: { readonly [x: string]: JsonValue } | undefined
  readonly permissions?:
    | ReadonlyArray<{ readonly action: string; readonly resource: string; readonly effect: "allow" | "deny" | "ask" }>
    | undefined
  readonly archived?: boolean | undefined
}

export type SessionUpdateOutput = void

export type SessionMoveInput = {
  readonly sessionID: string
  readonly directory: string
  readonly delivery?: ("steer" | "queue") | undefined
}

export type SessionMoveOutput = void

export type SessionPromptInput = {
  readonly sessionID: string
  readonly id?: string | null | undefined
  readonly text: string
  readonly files?:
    | ReadonlyArray<{
        readonly uri: string
        readonly source?: { readonly type: "inline" } | { readonly type: "uri"; readonly uri: string }
        readonly name?: string
        readonly description?: string
        readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
      }>
    | undefined
  readonly agents?:
    | ReadonlyArray<{
        readonly name: string
        readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
      }>
    | undefined
  readonly skills?:
    | ReadonlyArray<{
        readonly id: string
        readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
      }>
    | undefined
  readonly metadata?: { readonly [x: string]: JsonValue } | undefined
  readonly delivery?: ("steer" | "queue") | null | undefined
  readonly resume?: boolean | null | undefined
}

export type SessionPromptOutput = { data: SessionInboxUser }["data"]

export type SessionCommandInput = {
  readonly sessionID: string
  readonly name: string
  readonly text: string
  readonly files?:
    | ReadonlyArray<{
        readonly uri: string
        readonly source?: { readonly type: "inline" } | { readonly type: "uri"; readonly uri: string }
        readonly name?: string
        readonly description?: string
        readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
      }>
    | undefined
  readonly agents?:
    | ReadonlyArray<{
        readonly name: string
        readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
      }>
    | undefined
  readonly skills?:
    | ReadonlyArray<{
        readonly id: string
        readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
      }>
    | undefined
  readonly delivery?: ("steer" | "queue") | null | undefined
}

export type SessionCommandOutput = void

export type SessionSyntheticInput = {
  readonly sessionID: string
  readonly id?: string | null | undefined
  readonly text: string
  readonly description?: string | null | undefined
  readonly metadata?: { readonly [x: string]: JsonValue } | undefined
  readonly delivery?: ("steer" | "queue") | null | undefined
  readonly resume?: boolean | null | undefined
}

export type SessionSyntheticOutput = { data: SessionInboxSynthetic }["data"]

export type SessionShellInput = {
  readonly sessionID: string
  readonly id?: string | undefined
  readonly command: string
}

export type SessionShellOutput = void

export type SessionCompactInput = {
  readonly sessionID: string
  readonly id?: string | undefined
  readonly delivery?: ("steer" | "queue") | undefined
}

export type SessionCompactOutput = { data: SessionInboxCompaction }["data"]

export type SessionRevertStageInput = {
  readonly sessionID: string
  readonly messageID: string
  readonly files?: boolean | undefined
}

export type SessionRevertStageOutput = { data: SessionRevert }["data"]

export type SessionRevertClearInput = { readonly sessionID: string }

export type SessionRevertClearOutput = void

export type SessionRevertCommitInput = { readonly sessionID: string }

export type SessionRevertCommitOutput = void

export type SessionContextInput = { readonly sessionID: string }

export type SessionContextOutput = { data: Array<SessionMessageInfo> }["data"]

export type SessionDiffInput = {
  readonly sessionID: string
  readonly from?: string | undefined
  readonly to?: string | undefined
  readonly context?: number | undefined
}

export type SessionDiffOutput = { data: Array<FileDiffInfo> }["data"]

export type SessionInboxListInput = { readonly sessionID: string }

export type SessionInboxListOutput = { data: Array<SessionInboxInfo> }["data"]

export type SessionInboxCancelInput = { readonly sessionID: string; readonly inboxID: string }

export type SessionInboxCancelOutput = void

export type SessionInboxUpdateInput = {
  readonly sessionID: string
  readonly inboxID: string
  readonly delivery: "steer" | "queue"
}

export type SessionInboxUpdateOutput = void

export type SessionGenerateInput = { readonly sessionID: string; readonly prompt: string }

export type SessionGenerateOutput = SessionGenerateResponse["data"]

export type SessionInterruptInput = { readonly sessionID: string; readonly resume?: boolean | undefined }

export type SessionInterruptOutput = SessionInterruptResponse

export type SessionBackgroundInput = { readonly sessionID: string }

export type SessionBackgroundOutput = void

export type SessionMessageGetInput = { readonly sessionID: string; readonly messageID: string }

export type SessionMessageGetOutput = { data: SessionMessageInfo }["data"]

export type SessionFormListInput = { readonly sessionID: string }

export type SessionFormListOutput = { data: Array<FormInfo> }["data"]

export type SessionFormCreateInput = {
  readonly sessionID: string
  readonly id?: string | null | undefined
  readonly title: string
  readonly metadata?: { readonly [x: string]: JsonValue } | undefined
  readonly fields: readonly [
    (
      | {
          readonly key: string
          readonly title?: string
          readonly description?: string
          readonly required?: boolean
          readonly hidden?: boolean
          readonly when?: ReadonlyArray<{
            readonly key: string
            readonly op: "eq" | "neq"
            readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
          }>
          readonly type: "string"
          readonly format?: "email" | "uri" | "date" | "date-time"
          readonly minLength?: number
          readonly maxLength?: number
          readonly pattern?: string
          readonly placeholder?: string
          readonly default?: string
          readonly options?: ReadonlyArray<{
            readonly value: string
            readonly label: string
            readonly description?: string
          }>
          readonly custom?: boolean
        }
      | {
          readonly key: string
          readonly title?: string
          readonly description?: string
          readonly required?: boolean
          readonly hidden?: boolean
          readonly when?: ReadonlyArray<{
            readonly key: string
            readonly op: "eq" | "neq"
            readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
          }>
          readonly type: "number"
          readonly minimum?: number | "Infinity" | "-Infinity" | "NaN"
          readonly maximum?: number | "Infinity" | "-Infinity" | "NaN"
          readonly default?: number | "Infinity" | "-Infinity" | "NaN"
        }
      | {
          readonly key: string
          readonly title?: string
          readonly description?: string
          readonly required?: boolean
          readonly hidden?: boolean
          readonly when?: ReadonlyArray<{
            readonly key: string
            readonly op: "eq" | "neq"
            readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
          }>
          readonly type: "integer"
          readonly minimum?: number | "Infinity" | "-Infinity" | "NaN"
          readonly maximum?: number | "Infinity" | "-Infinity" | "NaN"
          readonly default?: number | "Infinity" | "-Infinity" | "NaN"
        }
      | {
          readonly key: string
          readonly title?: string
          readonly description?: string
          readonly required?: boolean
          readonly hidden?: boolean
          readonly when?: ReadonlyArray<{
            readonly key: string
            readonly op: "eq" | "neq"
            readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
          }>
          readonly type: "boolean"
          readonly default?: boolean
        }
      | {
          readonly key: string
          readonly title?: string
          readonly description?: string
          readonly required?: boolean
          readonly hidden?: boolean
          readonly when?: ReadonlyArray<{
            readonly key: string
            readonly op: "eq" | "neq"
            readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
          }>
          readonly type: "multiselect"
          readonly options: ReadonlyArray<{
            readonly value: string
            readonly label: string
            readonly description?: string
          }>
          readonly minItems?: number
          readonly maxItems?: number
          readonly custom?: boolean
          readonly default?: ReadonlyArray<string>
        }
      | {
          readonly key: string
          readonly type: "external"
          readonly url: string
          readonly title?: string
          readonly description?: string
        }
    ),
    ...Array<
      | {
          readonly key: string
          readonly title?: string
          readonly description?: string
          readonly required?: boolean
          readonly hidden?: boolean
          readonly when?: ReadonlyArray<{
            readonly key: string
            readonly op: "eq" | "neq"
            readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
          }>
          readonly type: "string"
          readonly format?: "email" | "uri" | "date" | "date-time"
          readonly minLength?: number
          readonly maxLength?: number
          readonly pattern?: string
          readonly placeholder?: string
          readonly default?: string
          readonly options?: ReadonlyArray<{
            readonly value: string
            readonly label: string
            readonly description?: string
          }>
          readonly custom?: boolean
        }
      | {
          readonly key: string
          readonly title?: string
          readonly description?: string
          readonly required?: boolean
          readonly hidden?: boolean
          readonly when?: ReadonlyArray<{
            readonly key: string
            readonly op: "eq" | "neq"
            readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
          }>
          readonly type: "number"
          readonly minimum?: number | "Infinity" | "-Infinity" | "NaN"
          readonly maximum?: number | "Infinity" | "-Infinity" | "NaN"
          readonly default?: number | "Infinity" | "-Infinity" | "NaN"
        }
      | {
          readonly key: string
          readonly title?: string
          readonly description?: string
          readonly required?: boolean
          readonly hidden?: boolean
          readonly when?: ReadonlyArray<{
            readonly key: string
            readonly op: "eq" | "neq"
            readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
          }>
          readonly type: "integer"
          readonly minimum?: number | "Infinity" | "-Infinity" | "NaN"
          readonly maximum?: number | "Infinity" | "-Infinity" | "NaN"
          readonly default?: number | "Infinity" | "-Infinity" | "NaN"
        }
      | {
          readonly key: string
          readonly title?: string
          readonly description?: string
          readonly required?: boolean
          readonly hidden?: boolean
          readonly when?: ReadonlyArray<{
            readonly key: string
            readonly op: "eq" | "neq"
            readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
          }>
          readonly type: "boolean"
          readonly default?: boolean
        }
      | {
          readonly key: string
          readonly title?: string
          readonly description?: string
          readonly required?: boolean
          readonly hidden?: boolean
          readonly when?: ReadonlyArray<{
            readonly key: string
            readonly op: "eq" | "neq"
            readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
          }>
          readonly type: "multiselect"
          readonly options: ReadonlyArray<{
            readonly value: string
            readonly label: string
            readonly description?: string
          }>
          readonly minItems?: number
          readonly maxItems?: number
          readonly custom?: boolean
          readonly default?: ReadonlyArray<string>
        }
      | {
          readonly key: string
          readonly type: "external"
          readonly url: string
          readonly title?: string
          readonly description?: string
        }
    >,
  ]
}

export type SessionFormCreateOutput = { data: FormInfo }["data"]

export type SessionFormGetInput = { readonly sessionID: string; readonly formID: string }

export type SessionFormGetOutput = { data: FormDetail }["data"]

export type SessionFormReplyInput = {
  readonly sessionID: string
  readonly formID: string
  readonly answer: { readonly [x: string]: string | number | boolean | ReadonlyArray<string> }
}

export type SessionFormReplyOutput = void

export type SessionFormCancelInput = {
  readonly sessionID: string
  readonly formID: string
  readonly message?: string | undefined
}

export type SessionFormCancelOutput = void

export type SessionEnvironmentInput = {
  readonly sessionID: string
  readonly variables: { readonly [x: string]: string }
}

export type SessionEnvironmentOutput = void

export type SessionViewInput = { readonly sessionID: string; readonly idle: number }

export type SessionViewOutput = void

export type ExperimentalSessionStatsInput = {
  readonly from?: number | undefined
  readonly to?: number | undefined
  readonly project?: string | undefined
  readonly timezone?: string | undefined
  readonly tools?: "none" | "summary" | "detail" | undefined
}

export type ExperimentalSessionStatsOutput = { data: SessionStatsInfo }["data"]

export type ExperimentalSessionImportInput = {
  readonly info: {
    readonly id: string
    readonly parentID?: string
    readonly fork?: {
      readonly sessionID: string
      readonly boundary:
        | { readonly type: "before"; readonly messageID: string }
        | { readonly type: "through"; readonly messageID: string }
    }
    readonly projectID: string
    readonly agent?: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly cost: number
    readonly tokens: {
      readonly input: number
      readonly output: number
      readonly reasoning: number
      readonly cache: { readonly read: number; readonly write: number }
    }
    readonly outcome?: "succeeded" | "failed" | "interrupted"
    readonly time: {
      readonly created: number
      readonly updated: number
      readonly busy?: number
      readonly idle?: number
      readonly viewed?: number
      readonly archived?: number
    }
    readonly title?: string
    readonly subpath?: string
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly permissions?: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
    }>
    readonly revert?: {
      readonly messageID: string
      readonly partID?: string
      readonly snapshot?: string
      readonly files?: ReadonlyArray<{
        readonly file: string
        readonly patch: string
        readonly additions: number
        readonly deletions: number
        readonly status: "added" | "deleted" | "modified"
        readonly more?: true
      }>
    }
    readonly location: { readonly directory: string }
  }
  readonly messages: ReadonlyArray<JsonValue>
  readonly location?: { readonly directory: string } | null | undefined
}

export type ExperimentalSessionImportOutput = { data: SessionInfo }["data"]

export type ExperimentalSessionExportInput = { readonly sessionID: string; readonly sanitize?: boolean | undefined }

export type ExperimentalSessionExportOutput = { data: SessionTransferData }["data"]

export type ExperimentalSessionSkillInput = {
  readonly sessionID: string
  readonly id: string
  readonly resume?: boolean | undefined
}

export type ExperimentalSessionSkillOutput = void

export type ExperimentalSessionWaitInput = { readonly sessionID: string }

export type ExperimentalSessionWaitOutput = void

export type ExperimentalSessionInstructionsEntryListInput = { readonly sessionID: string }

export type ExperimentalSessionInstructionsEntryListOutput = { data: Array<InstructionEntryInfo> }["data"]

export type ExperimentalSessionInstructionsEntryPutInput = {
  readonly sessionID: string
  readonly key: string
  readonly value: JsonValue
}

export type ExperimentalSessionInstructionsEntryPutOutput = void

export type ExperimentalSessionInstructionsEntryRemoveInput = { readonly sessionID: string; readonly key: string }

export type ExperimentalSessionInstructionsEntryRemoveOutput = void

export type ExperimentalSessionLogInput = {
  readonly sessionID: string
  readonly after?: number | undefined
  readonly follow?: boolean | undefined
}

export type ExperimentalSessionLogOutput = SessionLogItem

export type MessageListInput = {
  readonly sessionID: string
  readonly limit?: number | undefined
  readonly order?: "asc" | "desc" | undefined
  readonly cursor?: string | undefined
  readonly type?:
    | "agent-switched"
    | "model-switched"
    | "location-switched"
    | "user"
    | "synthetic"
    | "system"
    | "skill"
    | "shell"
    | "assistant"
    | "compaction"
    | "idle"
    | undefined
}

export type MessageListOutput = SessionMessagesResponse

export type ModelListInput = {
  readonly location?: { readonly directory?: string | undefined } | undefined
  readonly types?: ReadonlyArray<"chat" | "decision" | "image" | (string & {})> | undefined
}

export type ModelListOutput = { location: LocationPublicRef; data: Array<ModelInfo> }

export type ModelDefaultInput = { readonly location?: { readonly directory?: string | undefined } | undefined }

export type ModelDefaultOutput = { location: LocationPublicRef; data: ModelInfo | null }

export type ExperimentalGenerateTextInput = {
  readonly prompt: string
  readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null | undefined
}

export type ExperimentalGenerateTextOutput = GenerateTextResponse["data"]

export type ExperimentalGenerateImageInput = {
  readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
  readonly prompt: string
  readonly images?: ReadonlyArray<{ readonly data: string; readonly mime: string; readonly name?: string }> | undefined
  readonly n?: number | undefined
  readonly aspect?: `${number}${":"}${number}` | undefined
  readonly resolution?: ("1K" | "2K" | "4K" | (string & {})) | undefined
}

export type ExperimentalGenerateImageOutput = GenerateImageResponse["data"]

export type ExperimentalGenerateDecisionsInput = {
  readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
  readonly input: ReadonlyArray<
    | { readonly type: "text"; readonly text: string }
    | { readonly type: "json"; readonly value: JsonValue }
    | { readonly type: "file"; readonly data: string; readonly mime: string; readonly name?: string }
  >
  readonly questions: ReadonlyArray<
    | { readonly type: "predicate"; readonly name: string; readonly instructions: string }
    | {
        readonly type: "choice"
        readonly name: string
        readonly instructions: string
        readonly choices: ReadonlyArray<{ readonly value: string | boolean; readonly description?: string }>
      }
    | {
        readonly type: "score"
        readonly name: string
        readonly instructions: string
        readonly levels: ReadonlyArray<{ readonly label: string; readonly description?: string }>
      }
  >
}

export type ExperimentalGenerateDecisionsOutput = GenerateDecisionsResponse["data"]

export type ExperimentalVoiceModelsOutput = VoiceModelsResponse["data"]

export type ExperimentalVoiceSessionInput = {
  readonly model: string
  readonly session?: { readonly [x: string]: unknown } | undefined
  readonly transport:
    | { readonly type: "webrtc"; readonly sdp: string; readonly dcid?: number | undefined }
    | { readonly type: "websocket" }
}

export type ExperimentalVoiceSessionOutput = VoiceSessionResponse["data"]

export type ProviderListInput = { readonly location?: { readonly directory?: string | undefined } | undefined }

export type ProviderListOutput = { location: LocationPublicRef; data: Array<ProviderInfo> }

export type ProviderGetInput = {
  readonly providerID: string
  readonly location?: { readonly directory?: string | undefined } | undefined
}

export type ProviderGetOutput = { location: LocationPublicRef; data: ProviderInfo }

export type IntegrationListInput = { readonly location?: { readonly directory?: string | undefined } | undefined }

export type IntegrationListOutput = { location: LocationPublicRef; data: Array<IntegrationInfo> }

export type IntegrationGetInput = {
  readonly integrationID: string
  readonly location?: { readonly directory?: string | undefined } | undefined
}

export type IntegrationGetOutput = { location: LocationPublicRef; data: IntegrationInfo }

export type IntegrationConnectKeyInput = {
  readonly integrationID: string
  readonly location?: { readonly directory?: string | undefined } | undefined
  readonly key: string
  readonly answer?: { readonly [x: string]: string | number | boolean | ReadonlyArray<string> } | undefined
  readonly label?: string | undefined
}

export type IntegrationConnectKeyOutput = void

export type IntegrationConnectExternalInput = {
  readonly integrationID: string
  readonly location?: { readonly directory?: string | undefined } | undefined
  readonly methodID: string
  readonly answer?: { readonly [x: string]: string | number | boolean | ReadonlyArray<string> } | undefined
  readonly label?: string | undefined
}

export type IntegrationConnectExternalOutput = void

export type IntegrationOauthConnectInput = {
  readonly integrationID: string
  readonly location?: { readonly directory?: string | undefined } | undefined
  readonly methodID: string
  readonly answer?: { readonly [x: string]: string | number | boolean | ReadonlyArray<string> } | undefined
  readonly label?: string | undefined
}

export type IntegrationOauthConnectOutput = { location: LocationPublicRef; data: IntegrationAttempt }

export type IntegrationOauthStatusInput = {
  readonly integrationID: string
  readonly attemptID: string
  readonly location?: { readonly directory?: string | undefined } | undefined
}

export type IntegrationOauthStatusOutput = { location: LocationPublicRef; data: IntegrationAttemptStatus }

export type IntegrationOauthCompleteInput = {
  readonly integrationID: string
  readonly attemptID: string
  readonly location?: { readonly directory?: string | undefined } | undefined
  readonly code?: string | undefined
}

export type IntegrationOauthCompleteOutput = void

export type IntegrationOauthCancelInput = {
  readonly integrationID: string
  readonly attemptID: string
  readonly location?: { readonly directory?: string | undefined } | undefined
}

export type IntegrationOauthCancelOutput = void

export type IntegrationCommandConnectInput = {
  readonly integrationID: string
  readonly location?: { readonly directory?: string | undefined } | undefined
  readonly methodID: string
  readonly label?: string | undefined
}

export type IntegrationCommandConnectOutput = { location: LocationPublicRef; data: IntegrationCommandAttempt }

export type IntegrationCommandStatusInput = {
  readonly integrationID: string
  readonly attemptID: string
  readonly location?: { readonly directory?: string | undefined } | undefined
}

export type IntegrationCommandStatusOutput = { location: LocationPublicRef; data: IntegrationCommandAttemptStatus }

export type IntegrationCommandCancelInput = {
  readonly integrationID: string
  readonly attemptID: string
  readonly location?: { readonly directory?: string | undefined } | undefined
}

export type IntegrationCommandCancelOutput = void

export type ExperimentalIntegrationWellknownAddInput = {
  readonly location?: { readonly directory?: string | undefined } | undefined
  readonly url: string
}

export type ExperimentalIntegrationWellknownAddOutput = void

export type McpListInput = { readonly location?: { readonly directory?: string | undefined } | undefined }

export type McpListOutput = { location: LocationPublicRef; data: Array<McpServer> }

export type McpResourceCatalogInput = { readonly location?: { readonly directory?: string | undefined } | undefined }

export type McpResourceCatalogOutput = { location: LocationPublicRef; data: McpResourceCatalog }

export type ExperimentalMcpAddInput = {
  readonly server: string
  readonly location?: { readonly directory?: string | undefined } | undefined
  readonly config:
    | {
        readonly type: "local"
        readonly command: ReadonlyArray<string>
        readonly cwd?: string
        readonly environment?: { readonly [x: string]: string }
        readonly disabled?: boolean
        readonly codemode?: boolean
        readonly timeout?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
        readonly protocol?: "legacy" | "auto" | "2026-07-28"
      }
    | {
        readonly type: "remote"
        readonly url: string
        readonly headers?: { readonly [x: string]: string }
        readonly oauth?:
          | {
              readonly client_id?: string
              readonly client_secret?: string
              readonly scope?: string
              readonly callback_port?: number
              readonly redirect_uri?: string
              readonly auth_server_metadata_url?: string
            }
          | false
        readonly disabled?: boolean
        readonly codemode?: boolean
        readonly timeout?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
        readonly protocol?: "legacy" | "auto" | "2026-07-28"
      }
}

export type ExperimentalMcpAddOutput = void

export type ExperimentalMcpRemoveInput = {
  readonly server: string
  readonly location?: { readonly directory?: string | undefined } | undefined
}

export type ExperimentalMcpRemoveOutput = void

export type ExperimentalMcpConnectInput = {
  readonly server: string
  readonly location?: { readonly directory?: string | undefined } | undefined
}

export type ExperimentalMcpConnectOutput = void

export type ExperimentalMcpDisconnectInput = {
  readonly server: string
  readonly location?: { readonly directory?: string | undefined } | undefined
}

export type ExperimentalMcpDisconnectOutput = void

export type ExperimentalMcpClientTokenInput = {
  readonly location?: { readonly directory?: string | undefined } | undefined
  readonly name: string
  readonly "x-opencode-ticket"?: string | undefined
}

export type ExperimentalMcpClientTokenOutput = { location: LocationPublicRef; data: PtyTicketConnectToken }

export type CredentialListOutput = { data: Array<CredentialEntry> }["data"]

export type CredentialCreateInput = {
  readonly id?: string | undefined
  readonly integrationID: string
  readonly label?: string | undefined
  readonly value:
    | {
        readonly type: "oauth"
        readonly methodID: string
        readonly refresh: string
        readonly access: string
        readonly expires: number
        readonly metadata?: { readonly [x: string]: JsonValue }
      }
    | { readonly type: "key"; readonly key: string; readonly metadata?: { readonly [x: string]: JsonValue } }
    | { readonly type: "external"; readonly methodID: string; readonly metadata?: { readonly [x: string]: JsonValue } }
  readonly activate?: boolean | undefined
}

export type CredentialCreateOutput = { data: CredentialEntry }["data"]

export type CredentialUpdateInput = { readonly credentialID: string; readonly label: string }

export type CredentialUpdateOutput = void

export type CredentialActivateInput = { readonly credentialID: string }

export type CredentialActivateOutput = void

export type CredentialRemoveInput = { readonly credentialID: string }

export type CredentialRemoveOutput = void

export type ProjectListInput = { readonly archived?: boolean | undefined }

export type ProjectListOutput = Array<Project>

export type ProjectUpdateInput = {
  readonly projectID: string
  readonly canonical?: string | undefined
  readonly name?: string | undefined
  readonly icon?: { readonly url?: string; readonly override?: string; readonly color?: string } | undefined
  readonly commands?: { readonly start?: string } | undefined
}

export type ProjectUpdateOutput = Project

export type FormListInput = { readonly location?: { readonly directory?: string | undefined } | undefined }

export type FormListOutput = { location: LocationPublicRef; data: Array<FormInfo> }

export type PermissionRequestListInput = { readonly location?: { readonly directory?: string | undefined } | undefined }

export type PermissionRequestListOutput = { location: LocationPublicRef; data: Array<PermissionRequest> }

export type PermissionSavedListInput = { readonly projectID?: string | undefined }

export type PermissionSavedListOutput = { data: Array<PermissionSavedInfo> }["data"]

export type PermissionSavedUpdateInput = {
  readonly id: string
  readonly action?: string | undefined
  readonly resource?: string | undefined
}

export type PermissionSavedUpdateOutput = { data: PermissionSavedInfo }["data"]

export type PermissionSavedRemoveInput = { readonly id: string }

export type PermissionSavedRemoveOutput = void

export type PermissionCreateInput = {
  readonly sessionID: string
  readonly id?: string | null | undefined
  readonly action: string
  readonly resources: ReadonlyArray<string>
  readonly save?: ReadonlyArray<string> | undefined
  readonly metadata?: { readonly [x: string]: JsonValue } | undefined
  readonly source?: { readonly type: "tool"; readonly messageID: string; readonly id: string } | undefined
  readonly agent?: string | null | undefined
}

export type PermissionCreateOutput = { data: { id: PermissionID; effect: PermissionEffect } }["data"]

export type PermissionListInput = { readonly sessionID: string }

export type PermissionListOutput = { data: Array<PermissionRequest> }["data"]

export type PermissionGetInput = { readonly sessionID: string; readonly requestID: string }

export type PermissionGetOutput = { data: PermissionRequest }["data"]

export type PermissionReplyInput = {
  readonly sessionID: string
  readonly requestID: string
  readonly decision: "once" | "always" | "reject"
  readonly message?: string | undefined
}

export type PermissionReplyOutput = void

export type FileReadInput = {
  readonly location?: { readonly directory?: string | undefined } | undefined
  readonly path: string
}

export type FileReadOutput = globalThis.Uint8Array

export type FileListInput = {
  readonly location?: { readonly directory?: string | undefined } | undefined
  readonly path?: string | undefined
}

export type FileListOutput = { location: LocationPublicRef; data: Array<FileSystemEntry> }

export type FileFindInput = {
  readonly location?: { readonly directory?: string | undefined } | undefined
  readonly query: string
  readonly type?: "file" | "directory" | undefined
  readonly limit?: number | undefined
}

export type FileFindOutput = { location: LocationPublicRef; data: Array<FileSystemEntry> }

export type ExperimentalFileWriteInput = {
  readonly location?: { readonly directory?: string | undefined } | undefined
  readonly path: string
  readonly payload: globalThis.Uint8Array
}

export type ExperimentalFileWriteOutput = { location: LocationPublicRef; data: FileSystemWrite }

export type ExperimentalFileWatchInput = {
  readonly location?: { readonly directory?: string | undefined } | undefined
  readonly path: string
}

export type ExperimentalFileWatchOutput = void

export type ExperimentalFileUnwatchInput = {
  readonly location?: { readonly directory?: string | undefined } | undefined
  readonly path: string
}

export type ExperimentalFileUnwatchOutput = void

export type CommandListInput = { readonly location?: { readonly directory?: string | undefined } | undefined }

export type CommandListOutput = { location: LocationPublicRef; data: Array<CommandInfo> }

export type SkillListInput = { readonly location?: { readonly directory?: string | undefined } | undefined }

export type SkillListOutput = { location: LocationPublicRef; data: Array<SkillInfo> }

export type RpcCallInput = {
  readonly rpcID: string
  readonly method: string
  readonly location?: { readonly directory?: string | undefined } | undefined
  readonly input?: JsonValue | undefined
}

export type RpcCallOutput = RpcOutput

export type EventSubscribeInput = {
  readonly types?:
    | ReadonlyArray<
        | "location.shutdown"
        | "models-dev.refreshed"
        | "credential.updated"
        | "credential.switched"
        | "integration.updated"
        | "provider.updated"
        | "model.updated"
        | "agent.updated"
        | "session.created"
        | "session.agent.selected"
        | "session.model.selected"
        | "session.moved"
        | "session.renamed"
        | "session.metadata.updated"
        | "session.permissions"
        | "session.viewed"
        | "session.archived"
        | "session.unarchived"
        | "session.usage.updated"
        | "session.deleted"
        | "session.forked"
        | "session.inbox.delivered"
        | "session.inbox.enqueued"
        | "session.inbox.cancelled"
        | "session.inbox.delivery.changed"
        | "session.execution.started"
        | "session.execution.succeeded"
        | "session.execution.failed"
        | "session.execution.interrupted"
        | "session.instructions.updated"
        | "session.synthetic"
        | "session.skill.activated"
        | "session.shell.started"
        | "session.shell.ended"
        | "session.step.started"
        | "session.step.streamed"
        | "session.step.ended"
        | "session.step.failed"
        | "session.text.started"
        | "session.text.delta"
        | "session.text.ended"
        | "session.reasoning.started"
        | "session.reasoning.delta"
        | "session.reasoning.ended"
        | "session.tool.input.started"
        | "session.tool.input.delta"
        | "session.tool.input.ended"
        | "session.tool.called"
        | "session.tool.progress"
        | "session.tool.success"
        | "session.tool.failed"
        | "session.retry.scheduled"
        | "session.compaction.started"
        | "session.compaction.delta"
        | "session.compaction.ended"
        | "session.compaction.failed"
        | "session.revert.staged"
        | "session.revert.cleared"
        | "session.revert.committed"
        | "filesystem.changed"
        | "reference.updated"
        | "permission.asked"
        | "permission.replied"
        | "plugin.updated"
        | "project.updated"
        | "worktree.updated"
        | "worktree.resolved"
        | "command.updated"
        | "config.updated"
        | "skill.updated"
        | "pty.created"
        | "pty.updated"
        | "pty.exited"
        | "pty.deleted"
        | "persistent-pty.added"
        | "persistent-pty.removed"
        | "shell.created"
        | "shell.exited"
        | "shell.deleted"
        | "form.created"
        | "form.replied"
        | "form.cancelled"
        | "websearch.updated"
        | "session.status"
        | "session.idle"
        | "tui.prompt.append"
        | "tui.command.execute"
        | "tui.toast.show"
        | "tui.session.select"
        | "installation.updated"
        | "installation.update-available"
        | "vcs.branch.updated"
        | "mcp.status.changed"
        | "mcp.resources.changed"
        | `${"rpc."}${string}`
      >
    | undefined
}

export type EventSubscribeOutput = V2Event

export type PtyListInput = { readonly location?: { readonly directory?: string | undefined } | undefined }

export type PtyListOutput = { location: LocationPublicRef; data: Array<Pty> }

export type PtyCreateInput = {
  readonly location?: { readonly directory?: string | undefined } | undefined
  readonly command?: string | undefined
  readonly args?: ReadonlyArray<string> | undefined
  readonly cwd?: string | undefined
  readonly title?: string | undefined
  readonly env?: { readonly [x: string]: string } | undefined
}

export type PtyCreateOutput = { location: LocationPublicRef; data: Pty }

export type PtyGetInput = {
  readonly ptyID: string
  readonly location?: { readonly directory?: string | undefined } | undefined
}

export type PtyGetOutput = { location: LocationPublicRef; data: Pty }

export type PtyUpdateInput = {
  readonly ptyID: string
  readonly location?: { readonly directory?: string | undefined } | undefined
  readonly title?: string | undefined
  readonly size?: { readonly rows: number; readonly cols: number } | undefined
}

export type PtyUpdateOutput = { location: LocationPublicRef; data: Pty }

export type PtyRemoveInput = {
  readonly ptyID: string
  readonly location?: { readonly directory?: string | undefined } | undefined
}

export type PtyRemoveOutput = void

export type PtyConnectTokenInput = {
  readonly ptyID: string
  readonly location?: { readonly directory?: string | undefined } | undefined
  readonly "x-opencode-ticket"?: string | undefined
}

export type PtyConnectTokenOutput = { location: LocationPublicRef; data: PtyTicketConnectToken }

export type ExperimentalPersistentPtyReadInput = { readonly sessionID: string; readonly lines?: number | undefined }

export type ExperimentalPersistentPtyReadOutput = { data: PersistentPtyReadResult | null }["data"]

export type ExperimentalPersistentPtyListInput = { readonly sessionID: string }

export type ExperimentalPersistentPtyListOutput = { data: Array<PersistentPtyInfo> }["data"]

export type ExperimentalPersistentPtyCreateInput = {
  readonly sessionID: string
  readonly command?: string | undefined
  readonly args: ReadonlyArray<string>
  readonly cwd?: string | undefined
  readonly title: string
  readonly env: { readonly [x: string]: string }
  readonly size?: { readonly cols: number; readonly rows: number } | undefined
}

export type ExperimentalPersistentPtyCreateOutput = { data: PersistentPtyInfo }["data"]

export type ExperimentalPersistentPtyShutdownOutput = void

export type ExperimentalPersistentPtyHandoffOutput = { handoff: PersistentPtyHandoff | null }

export type ExperimentalPersistentPtyGetInput = { readonly ptyID: string }

export type ExperimentalPersistentPtyGetOutput = { data: PersistentPtyInfo }["data"]

export type ExperimentalPersistentPtyUpdateInput = {
  readonly ptyID: string
  readonly attachmentID?: string | undefined
  readonly size: { readonly cols: number; readonly rows: number }
}

export type ExperimentalPersistentPtyUpdateOutput = { data: PersistentPtyInfo }["data"]

export type ExperimentalPersistentPtySnapshotInput = { readonly ptyID: string }

export type ExperimentalPersistentPtySnapshotOutput = { data: PersistentPtySnapshot }["data"]

export type ExperimentalPersistentPtyRemoveInput = { readonly ptyID: string }

export type ExperimentalPersistentPtyRemoveOutput = void

export type ExperimentalPersistentPtyConnectTokenInput = {
  readonly ptyID: string
  readonly "x-opencode-ticket"?: string | undefined
}

export type ExperimentalPersistentPtyConnectTokenOutput = { data: PtyTicketConnectToken }["data"]

export type ExperimentalMediaGetInput = { readonly hash: string }

export type ExperimentalMediaGetOutput = globalThis.Uint8Array

export type ExperimentalScheduleCreateInput = {
  readonly sessionID: string
  readonly name?: string | undefined
  readonly when?:
    | (
        | {
            readonly in: string
            readonly at?: never
            readonly every?: never
            readonly cron?: never
            readonly tz?: string
          }
        | {
            readonly at: string
            readonly in?: never
            readonly every?: never
            readonly cron?: never
            readonly tz?: string
          }
        | {
            readonly every: string
            readonly in?: never
            readonly at?: never
            readonly cron?: never
            readonly tz?: string
          }
        | {
            readonly cron: string
            readonly in?: never
            readonly at?: never
            readonly every?: never
            readonly tz?: string
          }
      )
    | undefined
  readonly if?:
    | { readonly run: string; readonly is?: string; readonly matches?: string; readonly changes?: boolean }
    | undefined
  readonly until?:
    | { readonly run: string; readonly is?: string; readonly matches?: string; readonly changes?: boolean }
    | undefined
  readonly ends?: { readonly after?: string; readonly at?: string; readonly times?: number } | undefined
  readonly prompt: string
}

export type ExperimentalScheduleCreateOutput = { data: ScheduleInfo }["data"]

export type ExperimentalScheduleListInput = { readonly sessionID: string }

export type ExperimentalScheduleListOutput = { data: Array<ScheduleInfo> }["data"]

export type ExperimentalScheduleGetInput = { readonly scheduleID: string }

export type ExperimentalScheduleGetOutput = { data: ScheduleInfo }["data"]

export type ExperimentalSchedulePauseInput = { readonly scheduleID: string }

export type ExperimentalSchedulePauseOutput = { data: ScheduleInfo }["data"]

export type ExperimentalScheduleResumeInput = { readonly scheduleID: string }

export type ExperimentalScheduleResumeOutput = { data: ScheduleInfo }["data"]

export type ExperimentalScheduleDeleteInput = { readonly scheduleID: string }

export type ExperimentalScheduleDeleteOutput = void

export type ShellListInput = { readonly location?: { readonly directory?: string | undefined } | undefined }

export type ShellListOutput = { location: LocationPublicRef; data: Array<ShellInfo1> }

export type ShellCreateInput = {
  readonly location?: { readonly directory?: string | undefined } | undefined
  readonly command: string
  readonly cwd?: string | undefined
  readonly timeout?: number | undefined
  readonly metadata?: { readonly [x: string]: JsonValue } | undefined
}

export type ShellCreateOutput = { location: LocationPublicRef; data: ShellInfo1 }

export type ShellGetInput = {
  readonly id: string
  readonly location?: { readonly directory?: string | undefined } | undefined
}

export type ShellGetOutput = { location: LocationPublicRef; data: ShellInfo1 }

export type ShellOutputInput = {
  readonly id: string
  readonly location?: { readonly directory?: string | undefined } | undefined
  readonly cursor?: number | undefined
  readonly limit?: number | undefined
}

export type ShellOutputOutput = {
  location: LocationPublicRef
  data: { output: string; cursor: number; size: number; truncated: boolean }
}

export type ShellRemoveInput = {
  readonly id: string
  readonly location?: { readonly directory?: string | undefined } | undefined
}

export type ShellRemoveOutput = void

export type ReferenceListInput = { readonly location?: { readonly directory?: string | undefined } | undefined }

export type ReferenceListOutput = { location: LocationPublicRef; data: Array<ReferenceInfo> }

export type WorktreeListInput = { readonly projectID: string }

export type WorktreeListOutput = WorktreeList

export type WorktreeCreateInput = {
  readonly projectID: string
  readonly from?: string | undefined
  readonly branch?: string | undefined
  readonly directory?: string | undefined
  readonly name?: string | undefined
}

export type WorktreeCreateOutput = WorktreeInfo

export type WorktreeRemoveInput = { readonly projectID: string; readonly directory: string; readonly force: boolean }

export type WorktreeRemoveOutput = void

export type WorktreeRefreshInput = { readonly projectID: string }

export type WorktreeRefreshOutput = void

export type VcsInitInput = {
  readonly location?: { readonly directory?: string | undefined } | undefined
  readonly provider?: string | undefined
}

export type VcsInitOutput = void

export type VcsGetInput = { readonly location?: { readonly directory?: string | undefined } | undefined }

export type VcsGetOutput = { location: LocationPublicRef; data: VcsInfo }

export type VcsBaseInput = { readonly location?: { readonly directory?: string | undefined } | undefined }

export type VcsBaseOutput = { location: LocationPublicRef; data: VcsBase | null }

export type VcsStatusInput = { readonly location?: { readonly directory?: string | undefined } | undefined }

export type VcsStatusOutput = { location: LocationPublicRef; data: Array<VcsFileStatus> }

export type VcsBranchListInput = {
  readonly location?: { readonly directory?: string | undefined } | undefined
  readonly search?: string | undefined
  readonly limit?: number | undefined
}

export type VcsBranchListOutput = { location: LocationPublicRef; data: VcsBranchList }

export type VcsDiffInput = {
  readonly location?: { readonly directory?: string | undefined } | undefined
  readonly mode: "working" | "branch" | "committed"
  readonly base?: string | undefined
  readonly context?: number | undefined
  readonly untracked?: ("files" | "folders") | undefined
}

export type VcsDiffOutput = { location: LocationPublicRef; data: Array<FileDiffInfo> }

export type DebugHeapDumpInput = { readonly directory?: string | undefined }

export type DebugHeapDumpOutput = {
  path: string
  pid: number
  memory: { rss: number; heapTotal: number; heapUsed: number; external: number; arrayBuffers: number }
}

export type DebugLocationListOutput = Array<LocationPublicRef>

export type DebugLocationEvictInput = { readonly location?: { readonly directory?: string | undefined } | undefined }

export type DebugLocationEvictOutput = void

export type ExperimentalMigrationV1StatusOutput =
  | { status: "required" | "completed" }
  | { status: "running"; progress: { label: string; numerator?: number | undefined; denominator?: number | undefined } }
  | { status: "error"; error: string }

export type WebsearchProvidersInput = { readonly location?: { readonly directory?: string | undefined } | undefined }

export type WebsearchProvidersOutput = { location: LocationPublicRef; data: Array<WebSearchProvider> }

export type WebsearchQueryInput = {
  readonly location?: { readonly directory?: string | undefined } | undefined
  readonly query: string
  readonly providerID?: string | undefined
}

export type WebsearchQueryOutput = {
  location: LocationPublicRef
  data: { providerID: WebSearchID; results: Array<WebSearchResult> }
}

export type ExperimentalUsageLimitsInput = {
  readonly location?: { readonly directory?: string | undefined } | undefined
}

export type ExperimentalUsageLimitsOutput = { location: LocationPublicRef; data: UsageLimitsInfo | null }

export type ConfigGetInput = { readonly location?: { readonly directory?: string | undefined } | undefined }

export type ConfigGetOutput = Array<ConfigEntry>

export type ConfigShellsOutput = Array<ConfigShellOption>

export type ExperimentalConfigUpdateInput = { readonly shell: string | null }

export type ExperimentalConfigUpdateOutput = void

/** @deprecated Use `ExperimentalSessionStatsInput`. Removed in the next minor. */
export type SessionStatsInput = ExperimentalSessionStatsInput

/** @deprecated Use `ExperimentalSessionStatsOutput`. Removed in the next minor. */
export type SessionStatsOutput = ExperimentalSessionStatsOutput

/** @deprecated Use `ExperimentalSessionImportInput`. Removed in the next minor. */
export type SessionImportInput = ExperimentalSessionImportInput

/** @deprecated Use `ExperimentalSessionImportOutput`. Removed in the next minor. */
export type SessionImportOutput = ExperimentalSessionImportOutput

/** @deprecated Use `ExperimentalSessionExportInput`. Removed in the next minor. */
export type SessionExportInput = ExperimentalSessionExportInput

/** @deprecated Use `ExperimentalSessionExportOutput`. Removed in the next minor. */
export type SessionExportOutput = ExperimentalSessionExportOutput

/** @deprecated Use `ExperimentalSessionSkillInput`. Removed in the next minor. */
export type SessionSkillInput = ExperimentalSessionSkillInput

/** @deprecated Use `ExperimentalSessionSkillOutput`. Removed in the next minor. */
export type SessionSkillOutput = ExperimentalSessionSkillOutput

/** @deprecated Use `ExperimentalSessionWaitInput`. Removed in the next minor. */
export type SessionWaitInput = ExperimentalSessionWaitInput

/** @deprecated Use `ExperimentalSessionWaitOutput`. Removed in the next minor. */
export type SessionWaitOutput = ExperimentalSessionWaitOutput

/** @deprecated Use `ExperimentalSessionInstructionsEntryListInput`. Removed in the next minor. */
export type SessionInstructionsEntryListInput = ExperimentalSessionInstructionsEntryListInput

/** @deprecated Use `ExperimentalSessionInstructionsEntryListOutput`. Removed in the next minor. */
export type SessionInstructionsEntryListOutput = ExperimentalSessionInstructionsEntryListOutput

/** @deprecated Use `ExperimentalSessionInstructionsEntryPutInput`. Removed in the next minor. */
export type SessionInstructionsEntryPutInput = ExperimentalSessionInstructionsEntryPutInput

/** @deprecated Use `ExperimentalSessionInstructionsEntryPutOutput`. Removed in the next minor. */
export type SessionInstructionsEntryPutOutput = ExperimentalSessionInstructionsEntryPutOutput

/** @deprecated Use `ExperimentalSessionInstructionsEntryRemoveInput`. Removed in the next minor. */
export type SessionInstructionsEntryRemoveInput = ExperimentalSessionInstructionsEntryRemoveInput

/** @deprecated Use `ExperimentalSessionInstructionsEntryRemoveOutput`. Removed in the next minor. */
export type SessionInstructionsEntryRemoveOutput = ExperimentalSessionInstructionsEntryRemoveOutput

/** @deprecated Use `ExperimentalSessionLogInput`. Removed in the next minor. */
export type SessionLogInput = ExperimentalSessionLogInput

/** @deprecated Use `ExperimentalSessionLogOutput`. Removed in the next minor. */
export type SessionLogOutput = ExperimentalSessionLogOutput

/** @deprecated Use `ExperimentalGenerateTextInput`. Removed in the next minor. */
export type GenerateTextInput = ExperimentalGenerateTextInput

/** @deprecated Use `ExperimentalGenerateTextOutput`. Removed in the next minor. */
export type GenerateTextOutput = ExperimentalGenerateTextOutput

/** @deprecated Use `ExperimentalGenerateImageInput`. Removed in the next minor. */
export type GenerateImageInput = ExperimentalGenerateImageInput

/** @deprecated Use `ExperimentalGenerateImageOutput`. Removed in the next minor. */
export type GenerateImageOutput = ExperimentalGenerateImageOutput

/** @deprecated Use `ExperimentalGenerateDecisionsInput`. Removed in the next minor. */
export type GenerateDecisionsInput = ExperimentalGenerateDecisionsInput

/** @deprecated Use `ExperimentalGenerateDecisionsOutput`. Removed in the next minor. */
export type GenerateDecisionsOutput = ExperimentalGenerateDecisionsOutput

/** @deprecated Use `ExperimentalVoiceModelsOutput`. Removed in the next minor. */
export type VoiceModelsOutput = ExperimentalVoiceModelsOutput

/** @deprecated Use `ExperimentalVoiceSessionInput`. Removed in the next minor. */
export type VoiceSessionInput = ExperimentalVoiceSessionInput

/** @deprecated Use `ExperimentalVoiceSessionOutput`. Removed in the next minor. */
export type VoiceSessionOutput = ExperimentalVoiceSessionOutput

/** @deprecated Use `ExperimentalIntegrationWellknownAddInput`. Removed in the next minor. */
export type IntegrationWellknownAddInput = ExperimentalIntegrationWellknownAddInput

/** @deprecated Use `ExperimentalIntegrationWellknownAddOutput`. Removed in the next minor. */
export type IntegrationWellknownAddOutput = ExperimentalIntegrationWellknownAddOutput

/** @deprecated Use `ExperimentalMcpAddInput`. Removed in the next minor. */
export type McpAddInput = ExperimentalMcpAddInput

/** @deprecated Use `ExperimentalMcpAddOutput`. Removed in the next minor. */
export type McpAddOutput = ExperimentalMcpAddOutput

/** @deprecated Use `ExperimentalMcpRemoveInput`. Removed in the next minor. */
export type McpRemoveInput = ExperimentalMcpRemoveInput

/** @deprecated Use `ExperimentalMcpRemoveOutput`. Removed in the next minor. */
export type McpRemoveOutput = ExperimentalMcpRemoveOutput

/** @deprecated Use `ExperimentalMcpConnectInput`. Removed in the next minor. */
export type McpConnectInput = ExperimentalMcpConnectInput

/** @deprecated Use `ExperimentalMcpConnectOutput`. Removed in the next minor. */
export type McpConnectOutput = ExperimentalMcpConnectOutput

/** @deprecated Use `ExperimentalMcpDisconnectInput`. Removed in the next minor. */
export type McpDisconnectInput = ExperimentalMcpDisconnectInput

/** @deprecated Use `ExperimentalMcpDisconnectOutput`. Removed in the next minor. */
export type McpDisconnectOutput = ExperimentalMcpDisconnectOutput

/** @deprecated Use `ExperimentalMcpClientTokenInput`. Removed in the next minor. */
export type McpClientTokenInput = ExperimentalMcpClientTokenInput

/** @deprecated Use `ExperimentalMcpClientTokenOutput`. Removed in the next minor. */
export type McpClientTokenOutput = ExperimentalMcpClientTokenOutput

/** @deprecated Use `ExperimentalFileWriteInput`. Removed in the next minor. */
export type FileWriteInput = ExperimentalFileWriteInput

/** @deprecated Use `ExperimentalFileWriteOutput`. Removed in the next minor. */
export type FileWriteOutput = ExperimentalFileWriteOutput

/** @deprecated Use `ExperimentalFileWatchInput`. Removed in the next minor. */
export type FileWatchInput = ExperimentalFileWatchInput

/** @deprecated Use `ExperimentalFileWatchOutput`. Removed in the next minor. */
export type FileWatchOutput = ExperimentalFileWatchOutput

/** @deprecated Use `ExperimentalFileUnwatchInput`. Removed in the next minor. */
export type FileUnwatchInput = ExperimentalFileUnwatchInput

/** @deprecated Use `ExperimentalFileUnwatchOutput`. Removed in the next minor. */
export type FileUnwatchOutput = ExperimentalFileUnwatchOutput

/** @deprecated Use `ExperimentalMigrationV1StatusOutput`. Removed in the next minor. */
export type MigrationV1StatusOutput = ExperimentalMigrationV1StatusOutput

/** @deprecated Use `ExperimentalUsageLimitsInput`. Removed in the next minor. */
export type UsageLimitsInput = ExperimentalUsageLimitsInput

/** @deprecated Use `ExperimentalUsageLimitsOutput`. Removed in the next minor. */
export type UsageLimitsOutput = ExperimentalUsageLimitsOutput

/** @deprecated Use `ExperimentalConfigUpdateInput`. Removed in the next minor. */
export type ConfigUpdateInput = ExperimentalConfigUpdateInput

/** @deprecated Use `ExperimentalConfigUpdateOutput`. Removed in the next minor. */
export type ConfigUpdateOutput = ExperimentalConfigUpdateOutput
