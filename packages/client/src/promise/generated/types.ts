export type JsonValue = null | boolean | number | string | Array<JsonValue> | { [key: string]: JsonValue }

export type ServiceStatus =
  | { type: "starting" }
  | { type: "ready" }
  | { type: "stopping"; targetVersion?: string | null }
  | { type: "failed"; message: string; action: string }

export type ServiceStopResponse = { accepted: boolean }

export type ModelRef = { id: string; providerID: string; variant?: string }

export type ProviderSettings = { [x: string]: JsonValue }

export type AgentColor = string | "primary" | "secondary" | "accent" | "success" | "warning" | "error" | "info"

export type PermissionV2Effect = "allow" | "deny" | "ask"

export type PluginInfo = { id: string }

export type MoneyUSD = number

export type TokenUsageInfo = {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

export type LocationRef = { directory: string; workspaceID?: string }

export type FileDiffInfo = {
  file: string
  patch: string
  additions: number
  deletions: number
  status: "added" | "deleted" | "modified"
}

export type SessionActive = { type: "running" }

export type PromptBase64 = string

export type PromptFileSource = { type: "inline" } | { type: "uri"; uri: string }

export type PromptMention = { start: number; end: number; text: string }

export type SessionPendingSyntheticData = { text: string; description?: string; metadata?: { [x: string]: JsonValue } }

export type SessionPendingCompaction = {
  admittedSeq: number
  id: string
  sessionID: string
  timeCreated: number
  type: "compaction"
}

export type SessionMessageAgentSelected = {
  id: string
  metadata?: { [x: string]: JsonValue }
  time: { created: number }
  type: "agent-switched"
  agent: string
}

export type SessionMessageSynthetic = {
  id: string
  metadata?: { [x: string]: JsonValue }
  time: { created: number }
  text: string
  description?: string
  type: "synthetic"
}

export type SessionMessageSystem = {
  id: string
  metadata?: { [x: string]: JsonValue }
  time: { created: number }
  type: "system"
  text: string
}

export type SessionMessageSkill = {
  id: string
  metadata?: { [x: string]: JsonValue }
  time: { created: number }
  type: "skill"
  skill: string
  name: string
  text: string
}

export type SessionMessageShell = {
  id: string
  metadata?: { [x: string]: JsonValue }
  time: { created: number; completed?: number }
  type: "shell"
  shellID: string
  command: string
  status: "running" | "exited" | "timeout" | "killed"
  exit?: number | "Infinity" | "-Infinity" | "NaN"
  output?: { output: string; cursor: number; size: number; truncated: boolean }
}

export type SessionMessageAssistantText = { type: "text"; text: string }

export type SessionMessageProviderState = { [x: string]: JsonValue }

export type SessionMessageToolStateStreaming = { status: "streaming"; input: string }

export type ToolTextContent = { type: "text"; text: string }

export type ToolFileContent = { type: "file"; uri: string; mime: string; name?: string }

export type SessionStructuredError = { type: string; message: string }

export type SessionMessageCompactionRunning = {
  type: "compaction"
  id: string
  metadata?: { [x: string]: JsonValue }
  time: { created: number }
  status: "running"
  reason: "auto" | "manual"
  summary: string
  recent: string
}

export type SessionMessageCompactionCompleted = {
  type: "compaction"
  id: string
  metadata?: { [x: string]: JsonValue }
  time: { created: number }
  status: "completed"
  reason: "auto" | "manual"
  summary: string
  recent: string
}

export type InstructionEntryKey = string

export type SessionPendingSyntheticData1 = { text: string; description?: string; metadata?: { [x: string]: any } }

export type ShellInfo = {
  id: string
  status: "running" | "exited" | "timeout" | "killed"
  command: string
  cwd: string
  shell: string
  file: string
  pid?: number
  exit?: number
  metadata: { [x: string]: any }
  time: { started: number; completed?: number }
}

export type SessionMessageProviderState3 = { [x: string]: any }

export type SessionMessageProviderState4 = { [x: string]: any }

export type SessionMessageProviderState5 = { [x: string]: any }

export type SessionMessageProviderState6 = { [x: string]: any }

export type SessionMessageProviderState7 = { [x: string]: any }

export type EventLogSynced = { type: "log.synced"; aggregateID: string; seq?: number }

export type ModelCapabilities = { tools: boolean; input: Array<string>; output: Array<string> }

export type ModelVariant = {
  id: string
  settings?: { [x: string]: JsonValue }
  headers?: { [x: string]: string }
  body?: { [x: string]: JsonValue }
}

export type MoneyUSDPerMillionTokens = number

export type GenerateTextResponse = { data: { text: string } }

export type ProviderV2Info = {
  id: string
  integrationID?: string
  name: string
  disabled?: boolean
  package: string
  settings?: { [x: string]: JsonValue }
  headers?: { [x: string]: string }
  body?: { [x: string]: JsonValue }
}

export type IntegrationWhen = { key: string; op: "eq" | "neq"; value: string }

export type IntegrationKeyMethod = { type: "key"; label?: string }

export type IntegrationEnvMethod = { type: "env"; names: Array<string> }

export type ConnectionCredentialInfo = { type: "credential"; id: string; label: string }

export type ConnectionEnvInfo = { type: "env"; name: string }

export type IntegrationAttemptStatus =
  | {
      status: "pending"
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

export type McpStatusNeedsAuth = { status: "needs_auth" }

export type McpStatusNeedsClientRegistration = { status: "needs_client_registration"; error: string }

export type McpResource = { server: string; name: string; uri: string; description?: string; mimeType?: string }

export type McpResourceTemplate = {
  server: string
  name: string
  uriTemplate: string
  description?: string
  mimeType?: string
}

export type ProjectVcs = "git" | "hg"

export type ProjectIcon = { url?: string; override?: string; color?: string }

export type ProjectCommands = { start?: string }

export type ProjectTime = { created: number; updated: number; initialized?: number }

export type ProjectCurrent = { id: string; directory: string }

export type ProjectDirectory = { directory: string; strategy?: string }

export type FormMetadata = { [x: string]: JsonValue }

export type FormWhen = {
  key: string
  op: "eq" | "neq"
  value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
}

export type FormOption = { value: string; label: string; description?: string }

export type FormExternalField = { key: string; type: "external"; url: string; title?: string; description?: string }

export type FormValue = string | number | boolean | Array<string>

export type PermissionV2Source = { type: "tool"; messageID: string; callID: string }

export type PermissionSavedInfo = { id: string; projectID: string; action: string; resource: string }

export type FileSystemEntry = { path: string; type: "file" | "directory" }

export type SkillInfo = {
  id: string
  name: string
  description?: string
  slash?: boolean
  autoinvoke?: boolean
  location: string
  content: string
}

export type FileDiffLegacyInfo = {
  file?: string
  patch?: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
}

export type PermissionAction = "allow" | "deny" | "ask"

export type JSONSchema = { [x: string]: any }

export type ProviderAuthError = { name: "ProviderAuthError"; data: { providerID: string; message: string } }

export type UnknownError2 = { name: "UnknownError"; data: { message: string; ref?: string | undefined } }

export type MessageOutputLengthError = { name: "MessageOutputLengthError"; data: {} }

export type MessageAbortedError = { name: "MessageAbortedError"; data: { message: string } }

export type StructuredOutputError = { name: "StructuredOutputError"; data: { message: string; retries: number } }

export type ContextOverflowError = {
  name: "ContextOverflowError"
  data: { message: string; responseBody?: string | undefined }
}

export type ContentFilterError = { name: "ContentFilterError"; data: { message: string } }

export type APIError = {
  name: "APIError"
  data: {
    message: string
    statusCode?: number | undefined
    isRetryable: boolean
    responseHeaders?: { [x: string]: string } | undefined
    responseBody?: string | undefined
    metadata?: { [x: string]: string } | undefined
  }
}

export type TextPart = {
  id: string
  sessionID: string
  messageID: string
  type: "text"
  text: string
  synthetic?: boolean | undefined
  ignored?: boolean | undefined
  time?: { start: number; end?: number | undefined } | undefined
  metadata?: { [x: string]: any } | undefined
}

export type SubtaskPart = {
  id: string
  sessionID: string
  messageID: string
  type: "subtask"
  prompt: string
  description: string
  agent: string
  model?: { providerID: string; modelID: string } | undefined
  command?: string | undefined
}

export type ReasoningPart = {
  id: string
  sessionID: string
  messageID: string
  type: "reasoning"
  text: string
  metadata?: { [x: string]: any } | undefined
  time: { start: number; end?: number | undefined }
}

export type FilePartSourceText = { value: string; start: number; end: number }

export type Range = { start: { line: number; character: number }; end: { line: number; character: number } }

export type ToolStatePending = { status: "pending"; input: { [x: string]: any }; raw: string }

export type ToolStateRunning = {
  status: "running"
  input: { [x: string]: any }
  title?: string | undefined
  metadata?: { [x: string]: any } | undefined
  time: { start: number }
}

export type ToolStateError = {
  status: "error"
  input: { [x: string]: any }
  error: string
  metadata?: { [x: string]: any } | undefined
  time: { start: number; end: number }
}

export type StepStartPart = {
  id: string
  sessionID: string
  messageID: string
  type: "step-start"
  snapshot?: string | undefined
}

export type StepFinishPart = {
  id: string
  sessionID: string
  messageID: string
  type: "step-finish"
  reason: string
  snapshot?: string | undefined
  cost: number
  tokens: {
    total?: number | undefined
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
}

export type SnapshotPart = { id: string; sessionID: string; messageID: string; type: "snapshot"; snapshot: string }

export type PatchPart = {
  id: string
  sessionID: string
  messageID: string
  type: "patch"
  hash: string
  files: Array<string>
}

export type AgentPart = {
  id: string
  sessionID: string
  messageID: string
  type: "agent"
  name: string
  source?: { value: string; start: number; end: number } | undefined
}

export type CompactionPart = {
  id: string
  sessionID: string
  messageID: string
  type: "compaction"
  auto: boolean
  overflow?: boolean | undefined
  tail_start_id?: string | undefined
}

export type PermissionV2Reply = "once" | "always" | "reject"

export type Pty = {
  id: string
  title: string
  command: string
  args: Array<string>
  cwd: string
  status: "running" | "exited"
  pid: number
  exitCode?: number
}

export type QuestionV2Option = { label: string; description: string }

export type QuestionV2Tool = { messageID: string; callID: string }

export type QuestionV2Answer = Array<string>

export type FormMetadata1 = { [x: string]: any }

export type FormWhen1 = { key: string; op: "eq" | "neq"; value: string | number | boolean }

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

export type QuestionOption = { label: string; description: string }

export type QuestionTool = { messageID: string; callID: string }

export type QuestionAnswer = Array<string>

export type ShellInfo1 = {
  id: string
  status: "running" | "exited" | "timeout" | "killed"
  command: string
  cwd: string
  shell: string
  file: string
  pid?: number
  exit?: number
  metadata: { [x: string]: JsonValue }
  time: { started: number; completed?: number }
}

export type ReferenceLocalSource = { type: "local"; path: string; description?: string; hidden?: boolean }

export type ReferenceGitSource = {
  type: "git"
  repository: string
  branch?: string
  description?: string
  hidden?: boolean
}

export type ProjectCopyCopy = { directory: string }

export type VcsFileStatus = {
  file: string
  additions: number
  deletions: number
  status: "added" | "deleted" | "modified"
}

export type ServiceHealth = {
  healthy: true
  version: string
  pid: number
  instanceID?: string | null
  status?: ServiceStatus
}

export type SessionMessageModelSelected = {
  id: string
  metadata?: { [x: string]: JsonValue }
  time: { created: number }
  type: "model-switched"
  model: ModelRef
  previous?: ModelRef
}

export type CommandInfo = {
  name: string
  template: string
  description?: string
  agent?: string
  model?: ModelRef
  subtask?: boolean
}

export type ProviderRequest = {
  settings: ProviderSettings
  headers: { [x: string]: string }
  body: { [x: string]: JsonValue }
}

export type PermissionV2Rule = { action: string; resource: string; effect: PermissionV2Effect }

export type SessionAgentSelected = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.agent.selected"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; agent: string }
}

export type SessionModelSelected = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.model.selected"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; model: ModelRef }
}

export type SessionMoved = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.moved"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; location: LocationRef; subpath?: string }
}

export type SessionRenamed = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.renamed"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; title: string }
}

export type SessionDeleted = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.deleted"
  durable: { aggregateID: string; seq: number; version: 2 }
  location?: LocationRef
  data: { sessionID: string }
}

export type SessionForked = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.forked"
  durable: { aggregateID: string; seq: number; version: 2 }
  location?: LocationRef
  data: { sessionID: string; parentID: string; parentSeq: number; from?: string }
}

export type SessionInputPromoted = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.input.promoted"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; inputID: string }
}

export type SessionExecutionStarted = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.execution.started"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string }
}

export type SessionExecutionSucceeded = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.execution.succeeded"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string }
}

export type SessionExecutionInterrupted = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.execution.interrupted"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; reason: "user" | "shutdown" | "superseded" }
}

export type SessionInstructionsUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.instructions.updated"
  durable: { aggregateID: string; seq: number; version: 2 }
  location?: LocationRef
  data: { sessionID: string; delta: { [x: string]: string | "removed" } }
}

export type SessionSynthetic = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.synthetic"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; text: string; description?: string; metadata?: { [x: string]: any } }
}

export type SessionSkillActivated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.skill.activated"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; id: string; name: string; text: string }
}

export type SessionStepStarted = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.step.started"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; assistantMessageID: string; agent: string; model: ModelRef; snapshot?: string }
}

export type SessionStepEnded = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.step.ended"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: {
    sessionID: string
    assistantMessageID: string
    finish: "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown"
    cost: MoneyUSD
    tokens: TokenUsageInfo
    snapshot?: string
    files?: Array<string>
  }
}

export type SessionTextStarted = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.text.started"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; assistantMessageID: string; ordinal: number }
}

export type SessionTextEnded = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.text.ended"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; assistantMessageID: string; ordinal: number; text: string }
}

export type SessionToolInputStarted = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.tool.input.started"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; assistantMessageID: string; callID: string; name: string }
}

export type SessionToolInputEnded = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.tool.input.ended"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; assistantMessageID: string; callID: string; text: string }
}

export type SessionCompactionAdmitted = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.compaction.admitted"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; inputID: string }
}

export type SessionCompactionStarted = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.compaction.started"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; reason: "auto" | "manual"; recent: string; inputID?: string }
}

export type SessionCompactionEnded = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.compaction.ended"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; reason: "auto" | "manual"; text: string; recent: string }
}

export type SessionRevertCleared = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.revert.cleared"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string }
}

export type SessionRevertCommitted = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.revert.committed"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; to: string }
}

export type ModelsDevRefreshed = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "models-dev.refreshed"
  location?: LocationRef
  data: {}
}

export type IntegrationUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "integration.updated"
  location?: LocationRef
  data: {}
}

export type IntegrationConnectionUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "integration.connection.updated"
  location?: LocationRef
  data: { integrationID: string }
}

export type CatalogUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "catalog.updated"
  location?: LocationRef
  data: {}
}

export type AgentUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "agent.updated"
  location?: LocationRef
  data: {}
}

export type MessageRemoved = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "message.removed"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; messageID: string }
}

export type MessagePartRemoved = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "message.part.removed"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; messageID: string; partID: string }
}

export type SessionUsageUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.usage.updated"
  location?: LocationRef
  data: { sessionID: string; cost: MoneyUSD; tokens: TokenUsageInfo }
}

export type SessionTextDelta = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.text.delta"
  location?: LocationRef
  data: { sessionID: string; assistantMessageID: string; ordinal: number; delta: string }
}

export type SessionReasoningDelta = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.reasoning.delta"
  location?: LocationRef
  data: { sessionID: string; assistantMessageID: string; ordinal: number; delta: string }
}

export type SessionToolInputDelta = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.tool.input.delta"
  location?: LocationRef
  data: { sessionID: string; assistantMessageID: string; callID: string; delta: string }
}

export type SessionCompactionDelta = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.compaction.delta"
  location?: LocationRef
  data: { sessionID: string; text: string }
}

export type FilesystemChanged = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "filesystem.changed"
  location?: LocationRef
  data: { file: string; event: "add" | "change" | "unlink" }
}

export type ReferenceUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "reference.updated"
  location?: LocationRef
  data: {}
}

export type PluginAdded = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "plugin.added"
  location?: LocationRef
  data: { id: string }
}

export type PluginUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "plugin.updated"
  location?: LocationRef
  data: {}
}

export type ProjectDirectoriesUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "project.directories.updated"
  location?: LocationRef
  data: { projectID: string }
}

export type CommandUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "command.updated"
  location?: LocationRef
  data: {}
}

export type ConfigUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "config.updated"
  location?: LocationRef
  data: {}
}

export type SkillUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "skill.updated"
  location?: LocationRef
  data: {}
}

export type PtyExited = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "pty.exited"
  location?: LocationRef
  data: { id: string; exitCode: number }
}

export type PtyDeleted = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "pty.deleted"
  location?: LocationRef
  data: { id: string }
}

export type ShellExited = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "shell.exited"
  location?: LocationRef
  data: { id: string; exit?: number; status: "running" | "exited" | "timeout" | "killed" }
}

export type ShellDeleted = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "shell.deleted"
  location?: LocationRef
  data: { id: string }
}

export type QuestionV2Rejected = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "question.v2.rejected"
  location?: LocationRef
  data: { sessionID: string; requestID: string }
}

export type FormCancelled = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "form.cancelled"
  location?: LocationRef
  data: { id: string; sessionID: string }
}

export type SessionIdle = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.idle"
  location?: LocationRef
  data: { sessionID: string }
}

export type TuiPromptAppend = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "tui.prompt.append"
  location?: LocationRef
  data: { text: string }
}

export type TuiCommandExecute = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "tui.command.execute"
  location?: LocationRef
  data: {
    command:
      | "session.list"
      | "session.new"
      | "session.share"
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
      | string
  }
}

export type TuiToastShow = {
  id: string
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
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "tui.session.select"
  location?: LocationRef
  data: { sessionID: string }
}

export type InstallationUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "installation.updated"
  location?: LocationRef
  data: { version: string }
}

export type InstallationUpdateAvailable = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "installation.update-available"
  location?: LocationRef
  data: { version: string }
}

export type VcsBranchUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "vcs.branch.updated"
  location?: LocationRef
  data: { branch?: string }
}

export type McpStatusChanged = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "mcp.status.changed"
  location?: LocationRef
  data: { server: string }
}

export type McpResourcesChanged = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "mcp.resources.changed"
  location?: LocationRef
  data: { server: string }
}

export type PermissionAsked = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "permission.asked"
  location?: LocationRef
  data: {
    id: string
    sessionID: string
    permission: string
    patterns: Array<string>
    metadata: { [x: string]: any }
    always: Array<string>
    tool?: { messageID: string; callID: string } | undefined
  }
}

export type PermissionReplied = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "permission.replied"
  location?: LocationRef
  data: { sessionID: string; requestID: string; reply: "once" | "always" | "reject" }
}

export type QuestionRejected = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "question.rejected"
  location?: LocationRef
  data: { sessionID: string; requestID: string }
}

export type V2EventServerConnected = {
  id: string
  metadata?: { [x: string]: any } | undefined
  location?: LocationRef | undefined
  type: "server.connected"
  data: {}
}

export type SessionRevert = { messageID: string; partID?: string; snapshot?: string; files?: Array<FileDiffInfo> }

export type PromptFileAttachment = {
  data: PromptBase64
  mime: string
  source: PromptFileSource
  name?: string
  description?: string
  mention?: PromptMention
}

export type PromptAgentAttachment = { name: string; mention?: PromptMention }

export type SessionPendingSynthetic = {
  admittedSeq: number
  id: string
  sessionID: string
  timeCreated: number
  type: "synthetic"
  data: SessionPendingSyntheticData
  delivery: "steer" | "queue"
}

export type SessionMessageAssistantReasoning = {
  type: "reasoning"
  text: string
  state?: SessionMessageProviderState
  time?: { created: number; completed?: number }
}

export type LLMToolContent = ToolTextContent | ToolFileContent

export type SessionMessageAssistantRetry = { attempt: number; at: number; error: SessionStructuredError }

export type SessionMessageCompactionFailed = {
  type: "compaction"
  id: string
  metadata?: { [x: string]: JsonValue }
  time: { created: number }
  status: "failed"
  reason: "auto" | "manual"
  error: SessionStructuredError
}

export type SessionExecutionFailed = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.execution.failed"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; error: SessionStructuredError }
}

export type SessionStepFailed = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.step.failed"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: {
    sessionID: string
    assistantMessageID: string
    error: SessionStructuredError
    cost?: MoneyUSD
    tokens?: TokenUsageInfo
  }
}

export type SessionRetryScheduled = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.retry.scheduled"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; assistantMessageID: string; attempt: number; at: number; error: SessionStructuredError }
}

export type SessionCompactionFailed = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.compaction.failed"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; reason: "auto" | "manual"; error: SessionStructuredError; inputID?: string }
}

export type InstructionEntryInfo = { key: InstructionEntryKey; value: JsonValue }

export type SessionPendingSyntheticMessage = {
  type: "synthetic"
  data: SessionPendingSyntheticData1
  delivery: "steer" | "queue"
}

export type SessionShellStarted = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.shell.started"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; shell: ShellInfo }
}

export type SessionShellEnded = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.shell.ended"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: {
    sessionID: string
    shell: ShellInfo
    output: { output: string; cursor: number; size: number; truncated: boolean }
  }
}

export type ShellCreated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "shell.created"
  location?: LocationRef
  data: { info: ShellInfo }
}

export type SessionReasoningStarted = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.reasoning.started"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; assistantMessageID: string; ordinal: number; state?: SessionMessageProviderState3 }
}

export type SessionReasoningEnded = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.reasoning.ended"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: {
    sessionID: string
    assistantMessageID: string
    ordinal: number
    text: string
    state?: SessionMessageProviderState4
  }
}

export type SessionToolCalled = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.tool.called"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: {
    sessionID: string
    assistantMessageID: string
    callID: string
    input: { [x: string]: any }
    executed: boolean
    state?: SessionMessageProviderState5
  }
}

export type SessionToolFailed = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.tool.failed"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: {
    sessionID: string
    assistantMessageID: string
    callID: string
    error: SessionStructuredError
    result?: any
    executed: boolean
    resultState?: SessionMessageProviderState7
  }
}

export type ModelCost = {
  tier?: { type: "context"; size: number }
  input: MoneyUSDPerMillionTokens
  output: MoneyUSDPerMillionTokens
  cache: { read: MoneyUSDPerMillionTokens; write: MoneyUSDPerMillionTokens }
}

export type IntegrationTextPrompt = {
  type: "text"
  key: string
  message: string
  placeholder?: string
  when?: IntegrationWhen
}

export type IntegrationSelectPrompt = {
  type: "select"
  key: string
  message: string
  options: Array<{ label: string; value: string; hint?: string }>
  when?: IntegrationWhen
}

export type ConnectionInfo = ConnectionCredentialInfo | ConnectionEnvInfo

export type McpServer = {
  name: string
  status:
    | McpStatusConnected
    | McpStatusPending
    | McpStatusDisabled
    | McpStatusFailed
    | McpStatusNeedsAuth
    | McpStatusNeedsClientRegistration
  integrationID?: string
}

export type McpResourceCatalog = { resources: Array<McpResource>; templates: Array<McpResourceTemplate> }

export type Project = {
  id: string
  worktree: string
  vcs?: ProjectVcs
  name?: string
  icon?: ProjectIcon
  commands?: ProjectCommands
  time: ProjectTime
  sandboxes: Array<string>
}

export type ProjectDirectories = Array<ProjectDirectory>

export type FormNumberField = {
  key: string
  title?: string
  description?: string
  required?: boolean
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
  when?: Array<FormWhen>
  type: "boolean"
  default?: boolean
}

export type FormStringField = {
  key: string
  title?: string
  description?: string
  required?: boolean
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
  when?: Array<FormWhen>
  type: "multiselect"
  options: Array<FormOption>
  minItems?: number
  maxItems?: number
  custom?: boolean
  default?: Array<string>
}

export type FormAnswer = { [x: string]: FormValue }

export type PermissionV2Request = {
  id: string
  sessionID: string
  action: string
  resources: Array<string>
  save?: Array<string>
  metadata?: { [x: string]: JsonValue }
  source?: PermissionV2Source
}

export type PermissionV2Asked = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "permission.v2.asked"
  location?: LocationRef
  data: {
    id: string
    sessionID: string
    action: string
    resources: Array<string>
    save?: Array<string>
    metadata?: { [x: string]: any }
    source?: PermissionV2Source
  }
}

export type PermissionRule = { permission: string; pattern: string; action: PermissionAction }

export type OutputFormat =
  | { type: "text" }
  | { type: "json_schema"; schema: JSONSchema; retryCount?: number | undefined | undefined }

export type AssistantMessage = {
  id: string
  sessionID: string
  role: "assistant"
  time: { created: number; completed?: number | undefined }
  error?:
    | ProviderAuthError
    | UnknownError2
    | MessageOutputLengthError
    | MessageAbortedError
    | StructuredOutputError
    | ContextOverflowError
    | ContentFilterError
    | APIError
    | undefined
  parentID: string
  modelID: string
  providerID: string
  mode: string
  agent: string
  path: { cwd: string; root: string }
  summary?: boolean | undefined
  cost: number
  tokens: {
    total?: number | undefined
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
  structured?: any | undefined
  variant?: string | undefined
  finish?: string | undefined
}

export type RetryPart = {
  id: string
  sessionID: string
  messageID: string
  type: "retry"
  attempt: number
  error: APIError
  time: { created: number }
}

export type SessionError = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.error"
  location?: LocationRef
  data: {
    sessionID?: string | undefined
    error?:
      | ProviderAuthError
      | UnknownError2
      | MessageOutputLengthError
      | MessageAbortedError
      | StructuredOutputError
      | ContextOverflowError
      | ContentFilterError
      | APIError
      | undefined
  }
}

export type FileSource = { text: FilePartSourceText; type: "file"; path: string }

export type ResourceSource = { text: FilePartSourceText; type: "resource"; clientName: string; uri: string }

export type SymbolSource = {
  text: FilePartSourceText
  type: "symbol"
  path: string
  range: Range
  name: string
  kind: number
}

export type PermissionV2Replied = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "permission.v2.replied"
  location?: LocationRef
  data: { sessionID: string; requestID: string; reply: PermissionV2Reply }
}

export type PtyCreated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "pty.created"
  location?: LocationRef
  data: { info: Pty }
}

export type PtyUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "pty.updated"
  location?: LocationRef
  data: { info: Pty }
}

export type QuestionV2Info = {
  question: string
  header: string
  options: Array<QuestionV2Option>
  multiple?: boolean
  custom?: boolean
}

export type QuestionV2Replied = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "question.v2.replied"
  location?: LocationRef
  data: { sessionID: string; requestID: string; answers: Array<QuestionV2Answer> }
}

export type FormStringField1 = {
  key: string
  title?: string
  description?: string
  required?: boolean
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
  when?: Array<FormWhen1>
  type: "boolean"
  default?: boolean
}

export type FormMultiselectField1 = {
  key: string
  title?: string
  description?: string
  required?: boolean
  when?: Array<FormWhen1>
  type: "multiselect"
  options: Array<FormOption>
  minItems?: number
  maxItems?: number
  custom?: boolean
  default?: Array<string>
}

export type SessionStatus2 = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.status"
  location?: LocationRef
  data: { sessionID: string; status: SessionStatus }
}

export type QuestionInfo = {
  question: string
  header: string
  options: Array<QuestionOption>
  multiple?: boolean | undefined
  custom?: boolean | undefined
}

export type QuestionReplied = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "question.replied"
  location?: LocationRef
  data: { sessionID: string; requestID: string; answers: Array<QuestionAnswer> }
}

export type ReferenceSource = ReferenceLocalSource | ReferenceGitSource

export type PermissionV2Ruleset = Array<PermissionV2Rule>

export type SessionInfo = {
  id: string
  parentID?: string
  fork?: { sessionID: string; messageID?: string }
  projectID: string
  agent?: string
  model?: ModelRef
  cost: MoneyUSD
  tokens: TokenUsageInfo
  time: { created: number; updated: number; archived?: number }
  title: string
  location: LocationRef
  subpath?: string
  revert?: SessionRevert
}

export type SessionRevertStaged = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.revert.staged"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; revert: SessionRevert }
}

export type SessionPendingUserData = {
  text: string
  files?: Array<PromptFileAttachment>
  agents?: Array<PromptAgentAttachment>
  metadata?: { [x: string]: JsonValue }
}

export type SessionMessageUser = {
  id: string
  metadata?: { [x: string]: JsonValue }
  time: { created: number }
  text: string
  files?: Array<PromptFileAttachment>
  agents?: Array<PromptAgentAttachment>
  type: "user"
}

export type SessionPendingUserData1 = {
  text: string
  files?: Array<PromptFileAttachment>
  agents?: Array<PromptAgentAttachment>
  metadata?: { [x: string]: any }
}

export type SessionMessageToolStateRunning = {
  status: "running"
  input: { [x: string]: JsonValue }
  structured: { [x: string]: JsonValue }
  content: Array<LLMToolContent>
}

export type SessionMessageToolStateCompleted = {
  status: "completed"
  input: { [x: string]: JsonValue }
  content: Array<LLMToolContent>
  structured: { [x: string]: JsonValue }
  result?: JsonValue
}

export type SessionMessageToolStateError = {
  status: "error"
  input: { [x: string]: JsonValue }
  content: Array<LLMToolContent>
  structured: { [x: string]: JsonValue }
  error: SessionStructuredError
  result?: JsonValue
}

export type SessionToolProgress = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.tool.progress"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: {
    sessionID: string
    assistantMessageID: string
    callID: string
    structured: { [x: string]: any }
    content: Array<LLMToolContent>
  }
}

export type SessionToolSuccess = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.tool.success"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: {
    sessionID: string
    assistantMessageID: string
    callID: string
    structured: { [x: string]: any }
    content: Array<LLMToolContent>
    result?: any
    executed: boolean
    resultState?: SessionMessageProviderState6
  }
}

export type SessionMessageCompaction =
  | SessionMessageCompactionRunning
  | SessionMessageCompactionCompleted
  | SessionMessageCompactionFailed

export type ModelInfo = {
  id: string
  modelID: string
  providerID: string
  family?: string
  name: string
  package?: string
  settings?: { [x: string]: JsonValue }
  headers?: { [x: string]: string }
  body?: { [x: string]: JsonValue }
  capabilities: ModelCapabilities
  variants: Array<ModelVariant>
  time: { released: number }
  cost: Array<ModelCost>
  status: "alpha" | "beta" | "deprecated" | "active"
  enabled: boolean
  limit: { context: number; input?: number; output: number }
}

export type IntegrationOAuthMethod = {
  id: string
  type: "oauth"
  label: string
  prompts?: Array<IntegrationTextPrompt | IntegrationSelectPrompt>
}

export type FormField =
  | FormStringField
  | FormNumberField
  | FormIntegerField
  | FormBooleanField
  | FormMultiselectField
  | FormExternalField

export type FormState = { status: "pending" } | { status: "answered"; answer: FormAnswer } | { status: "cancelled" }

export type FormReplied = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "form.replied"
  location?: LocationRef
  data: { id: string; sessionID: string; answer: FormAnswer }
}

export type PermissionRuleset = Array<PermissionRule>

export type UserMessage = {
  id: string
  sessionID: string
  role: "user"
  time: { created: number }
  format?: OutputFormat | undefined
  summary?: { title?: string | undefined; body?: string | undefined; diffs: Array<FileDiffLegacyInfo> } | undefined
  agent: string
  model: { providerID: string; modelID: string; variant?: string | undefined }
  system?: string | undefined
  tools?: { [x: string]: boolean } | undefined
}

export type FilePartSource = FileSource | SymbolSource | ResourceSource

export type QuestionV2Asked = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "question.v2.asked"
  location?: LocationRef
  data: { id: string; sessionID: string; questions: Array<QuestionV2Info>; tool?: QuestionV2Tool }
}

export type QuestionV2Request = {
  id: string
  sessionID: string
  questions: Array<QuestionV2Info>
  tool?: QuestionV2Tool
}

export type FormField1 =
  | FormStringField1
  | FormNumberField1
  | FormIntegerField1
  | FormBooleanField1
  | FormMultiselectField1
  | FormExternalField

export type QuestionAsked = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "question.asked"
  location?: LocationRef
  data: { id: string; sessionID: string; questions: Array<QuestionInfo>; tool?: QuestionTool | undefined }
}

export type ReferenceInfo = {
  name: string
  path: string
  description?: string
  hidden?: boolean
  source: ReferenceSource
}

export type AgentInfo = {
  id: string
  name: string
  model?: ModelRef
  request: ProviderRequest
  system?: string
  description?: string
  mode: "subagent" | "primary" | "all"
  hidden: boolean
  color?: AgentColor
  steps?: number
  permissions: PermissionV2Ruleset
}

export type SessionsResponse = { data: Array<SessionInfo>; cursor: { previous?: string | null; next?: string | null } }

export type SessionPendingUser = {
  admittedSeq: number
  id: string
  sessionID: string
  timeCreated: number
  type: "user"
  data: SessionPendingUserData
  delivery: "steer" | "queue"
}

export type SessionPendingUserMessage = { type: "user"; data: SessionPendingUserData1; delivery: "steer" | "queue" }

export type SessionMessageAssistantTool = {
  type: "tool"
  id: string
  name: string
  executed?: boolean
  providerState?: SessionMessageProviderState
  providerResultState?: SessionMessageProviderState
  state:
    | SessionMessageToolStateStreaming
    | SessionMessageToolStateRunning
    | SessionMessageToolStateCompleted
    | SessionMessageToolStateError
  time: { created: number; ran?: number; completed?: number }
}

export type IntegrationMethod = IntegrationOAuthMethod | IntegrationKeyMethod | IntegrationEnvMethod

export type FormFields = [FormField, ...Array<FormField>]

export type SessionV1Info = {
  id: string
  slug: string
  projectID: string
  workspaceID?: string
  directory: string
  path?: string
  parentID?: string
  summary?: { additions: number; deletions: number; files: number; diffs?: Array<FileDiffLegacyInfo> }
  cost?: number
  tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  share?: { url: string }
  title: string
  agent?: string
  model?: { id: string; providerID: string; variant?: string }
  version: string
  metadata?: { [x: string]: any }
  time: { created: number; updated: number; compacting?: number; archived?: number }
  permission?: PermissionRuleset
  revert?: { messageID: string; partID?: string; snapshot?: string; diff?: string }
}

export type Message = UserMessage | AssistantMessage

export type FilePart = {
  id: string
  sessionID: string
  messageID: string
  type: "file"
  mime: string
  filename?: string | undefined
  url: string
  source?: FilePartSource | undefined
}

export type FormFields1 = [FormField1, ...Array<FormField1>]

export type SessionPendingInfo = SessionPendingUser | SessionPendingSynthetic | SessionPendingCompaction

export type SessionPendingMessage = SessionPendingUserMessage | SessionPendingSyntheticMessage

export type SessionMessageAssistant = {
  id: string
  metadata?: { [x: string]: JsonValue }
  time: { created: number; completed?: number }
  type: "assistant"
  agent: string
  model: ModelRef
  content: Array<SessionMessageAssistantText | SessionMessageAssistantReasoning | SessionMessageAssistantTool>
  snapshot?: { start?: string; end?: string; files?: Array<string> }
  finish?: "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown"
  cost?: MoneyUSD
  tokens?: TokenUsageInfo
  error?: SessionStructuredError
  retry?: SessionMessageAssistantRetry
}

export type IntegrationInfo = {
  id: string
  name: string
  methods: Array<IntegrationMethod>
  connections: Array<ConnectionInfo>
}

export type FormInfo = { id: string; sessionID: string; title: string; metadata?: FormMetadata; fields: FormFields }

export type SessionCreated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.created"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; info: SessionV1Info }
}

export type SessionUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.updated"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; info: SessionV1Info }
}

export type SessionDeleted1 = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.deleted"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; info: SessionV1Info }
}

export type MessageUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "message.updated"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; info: Message }
}

export type ToolStateCompleted = {
  status: "completed"
  input: { [x: string]: any }
  output: string
  title: string
  metadata: { [x: string]: any }
  time: { start: number; end: number; compacted?: number | undefined }
  attachments?: Array<FilePart> | undefined
}

export type FormInfo1 = { id: string; sessionID: string; title: string; metadata?: FormMetadata1; fields: FormFields1 }

export type SessionInputAdmitted = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.input.admitted"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; inputID: string; input: SessionPendingMessage }
}

export type SessionMessageInfo =
  | SessionMessageAgentSelected
  | SessionMessageModelSelected
  | SessionMessageUser
  | SessionMessageSynthetic
  | SessionMessageSystem
  | SessionMessageSkill
  | SessionMessageShell
  | SessionMessageAssistant
  | SessionMessageCompaction

export type ToolState = ToolStatePending | ToolStateRunning | ToolStateCompleted | ToolStateError

export type FormCreated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "form.created"
  location?: LocationRef
  data: { form: FormInfo1 }
}

export type SessionEventDurable =
  | SessionAgentSelected
  | SessionModelSelected
  | SessionMoved
  | SessionRenamed
  | SessionDeleted
  | SessionForked
  | SessionInputPromoted
  | SessionInputAdmitted
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
  | SessionStepEnded
  | SessionStepFailed
  | SessionTextStarted
  | SessionTextEnded
  | SessionReasoningStarted
  | SessionReasoningEnded
  | SessionToolInputStarted
  | SessionToolInputEnded
  | SessionToolCalled
  | SessionToolProgress
  | SessionToolSuccess
  | SessionToolFailed
  | SessionRetryScheduled
  | SessionCompactionAdmitted
  | SessionCompactionStarted
  | SessionCompactionEnded
  | SessionCompactionFailed
  | SessionRevertStaged
  | SessionRevertCleared
  | SessionRevertCommitted

export type SessionMessagesResponse = {
  data: Array<SessionMessageInfo>
  cursor: { previous?: string | null; next?: string | null }
}

export type ToolPart = {
  id: string
  sessionID: string
  messageID: string
  type: "tool"
  callID: string
  tool: string
  state: ToolState
  metadata?: { [x: string]: any } | undefined
}

export type SessionLogItem = SessionEventDurable | EventLogSynced

export type Part =
  | TextPart
  | SubtaskPart
  | ReasoningPart
  | FilePart
  | ToolPart
  | StepStartPart
  | StepFinishPart
  | SnapshotPart
  | PatchPart
  | AgentPart
  | RetryPart
  | CompactionPart

export type MessagePartUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "message.part.updated"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; part: Part; time: number }
}

export type V2Event =
  | ModelsDevRefreshed
  | IntegrationUpdated
  | IntegrationConnectionUpdated
  | CatalogUpdated
  | AgentUpdated
  | SessionCreated
  | SessionUpdated
  | SessionDeleted1
  | MessageUpdated
  | MessageRemoved
  | MessagePartUpdated
  | MessagePartRemoved
  | SessionAgentSelected
  | SessionModelSelected
  | SessionMoved
  | SessionRenamed
  | SessionUsageUpdated
  | SessionDeleted
  | SessionForked
  | SessionInputPromoted
  | SessionInputAdmitted
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
  | SessionCompactionAdmitted
  | SessionCompactionStarted
  | SessionCompactionDelta
  | SessionCompactionEnded
  | SessionCompactionFailed
  | SessionRevertStaged
  | SessionRevertCleared
  | SessionRevertCommitted
  | FilesystemChanged
  | ReferenceUpdated
  | PermissionV2Asked
  | PermissionV2Replied
  | PluginAdded
  | PluginUpdated
  | ProjectDirectoriesUpdated
  | CommandUpdated
  | ConfigUpdated
  | SkillUpdated
  | PtyCreated
  | PtyUpdated
  | PtyExited
  | PtyDeleted
  | ShellCreated
  | ShellExited
  | ShellDeleted
  | QuestionV2Asked
  | QuestionV2Replied
  | QuestionV2Rejected
  | FormCreated
  | FormReplied
  | FormCancelled
  | SessionStatus2
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
  | PermissionAsked
  | PermissionReplied
  | QuestionAsked
  | QuestionReplied
  | QuestionRejected
  | SessionError
  | V2EventServerConnected

export type UnauthorizedError = { readonly _tag: "UnauthorizedError"; readonly message: string }
export const isUnauthorizedError = (value: unknown): value is UnauthorizedError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "UnauthorizedError"

export type InvalidRequestError = {
  readonly _tag: "InvalidRequestError"
  readonly message: string
  readonly kind?: string | undefined
  readonly field?: string | undefined
}
export const isInvalidRequestError = (value: unknown): value is InvalidRequestError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "InvalidRequestError"

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

export type CommandEvaluationError = {
  readonly _tag: "CommandEvaluationError"
  readonly command: string
  readonly message: string
}
export const isCommandEvaluationError = (value: unknown): value is CommandEvaluationError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "CommandEvaluationError"

export type SkillNotFoundError = {
  readonly _tag: "SkillNotFoundError"
  readonly skill: string
  readonly message: string
}
export const isSkillNotFoundError = (value: unknown): value is SkillNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "SkillNotFoundError"

export type ServiceUnavailableError = {
  readonly _tag: "ServiceUnavailableError"
  readonly message: string
  readonly service?: string | undefined
}
export const isServiceUnavailableError = (value: unknown): value is ServiceUnavailableError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ServiceUnavailableError"

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

export type FormNotFoundError = { readonly _tag: "FormNotFoundError"; readonly id: string; readonly message: string }
export const isFormNotFoundError = (value: unknown): value is FormNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "FormNotFoundError"

export type FormAlreadySettledError = {
  readonly _tag: "FormAlreadySettledError"
  readonly id: string
  readonly message: string
}
export const isFormAlreadySettledError = (value: unknown): value is FormAlreadySettledError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "FormAlreadySettledError"

export type FormInvalidAnswerError = {
  readonly _tag: "FormInvalidAnswerError"
  readonly id: string
  readonly message: string
}
export const isFormInvalidAnswerError = (value: unknown): value is FormInvalidAnswerError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "FormInvalidAnswerError"

export type PermissionNotFoundError = {
  readonly _tag: "PermissionNotFoundError"
  readonly requestID: string
  readonly message: string
}
export const isPermissionNotFoundError = (value: unknown): value is PermissionNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "PermissionNotFoundError"

export type PtyNotFoundError = { readonly _tag: "PtyNotFoundError"; readonly ptyID: string; readonly message: string }
export const isPtyNotFoundError = (value: unknown): value is PtyNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "PtyNotFoundError"

export type ShellNotFoundError = { readonly _tag: "ShellNotFoundError"; readonly id: string; readonly message: string }
export const isShellNotFoundError = (value: unknown): value is ShellNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ShellNotFoundError"

export type QuestionNotFoundError = {
  readonly _tag: "QuestionNotFoundError"
  readonly requestID: string
  readonly message: string
}
export const isQuestionNotFoundError = (value: unknown): value is QuestionNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "QuestionNotFoundError"

export type ProjectCopyError = {
  readonly name: "ProjectCopyError"
  readonly data: { readonly message: string; readonly forceRequired?: boolean | undefined }
}
export const isProjectCopyError = (value: unknown): value is ProjectCopyError =>
  typeof value === "object" && value !== null && "name" in value && value["name"] === "ProjectCopyError"

export type HealthGetOutput = ServiceHealth

export type HealthStopInput = {
  readonly instanceID: { readonly instanceID: string; readonly targetVersion?: string | undefined }["instanceID"]
  readonly targetVersion?: { readonly instanceID: string; readonly targetVersion?: string | undefined }["targetVersion"]
}

export type HealthStopOutput = ServiceStopResponse

export type ServerGetOutput = { urls: Array<string> }

export type LocationGetInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type LocationGetOutput = { directory: string; workspaceID?: string; project: { id: string; directory: string } }

export type AgentListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type AgentListOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Array<AgentInfo>
}

export type PluginListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type PluginListOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Array<PluginInfo>
}

export type SessionListInput = {
  readonly workspace?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly parentID?: string | null | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["workspace"]
  readonly limit?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly parentID?: string | null | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["limit"]
  readonly order?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly parentID?: string | null | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["order"]
  readonly search?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly parentID?: string | null | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["search"]
  readonly parentID?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly parentID?: string | null | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["parentID"]
  readonly directory?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly parentID?: string | null | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["directory"]
  readonly project?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly parentID?: string | null | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["project"]
  readonly subpath?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly parentID?: string | null | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["subpath"]
  readonly cursor?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly parentID?: string | null | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["cursor"]
}

export type SessionListOutput = SessionsResponse

export type SessionCreateInput = {
  readonly id?: {
    readonly id?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly location?: { readonly directory: string; readonly workspaceID?: string } | null
  }["id"]
  readonly agent?: {
    readonly id?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly location?: { readonly directory: string; readonly workspaceID?: string } | null
  }["agent"]
  readonly model?: {
    readonly id?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly location?: { readonly directory: string; readonly workspaceID?: string } | null
  }["model"]
  readonly location?: {
    readonly id?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly location?: { readonly directory: string; readonly workspaceID?: string } | null
  }["location"]
}

export type SessionCreateOutput = { data: SessionInfo }["data"]

export type SessionActiveOutput = { data: { [x: string]: SessionActive } }["data"]

export type SessionGetInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionGetOutput = { data: SessionInfo }["data"]

export type SessionRemoveInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionRemoveOutput = void

export type SessionForkInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly messageID?: { readonly messageID?: string | undefined }["messageID"]
}

export type SessionForkOutput = { data: SessionInfo }["data"]

export type SessionSwitchAgentInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly agent: { readonly agent: string }["agent"]
}

export type SessionSwitchAgentOutput = void

export type SessionSwitchModelInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly model: {
    readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
  }["model"]
}

export type SessionSwitchModelOutput = void

export type SessionRenameInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly title: { readonly title: string }["title"]
}

export type SessionRenameOutput = void

export type SessionMoveInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly destination: {
    readonly destination: { readonly directory: string }
    readonly moveChanges?: boolean | undefined
  }["destination"]
  readonly moveChanges?: {
    readonly destination: { readonly directory: string }
    readonly moveChanges?: boolean | undefined
  }["moveChanges"]
}

export type SessionMoveOutput = void

export type SessionPromptInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id?: {
    readonly id?: string | null
    readonly text: string
    readonly files?: ReadonlyArray<{
      readonly uri: string
      readonly name?: string
      readonly description?: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["id"]
  readonly text: {
    readonly id?: string | null
    readonly text: string
    readonly files?: ReadonlyArray<{
      readonly uri: string
      readonly name?: string
      readonly description?: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["text"]
  readonly files?: {
    readonly id?: string | null
    readonly text: string
    readonly files?: ReadonlyArray<{
      readonly uri: string
      readonly name?: string
      readonly description?: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["files"]
  readonly agents?: {
    readonly id?: string | null
    readonly text: string
    readonly files?: ReadonlyArray<{
      readonly uri: string
      readonly name?: string
      readonly description?: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["agents"]
  readonly metadata?: {
    readonly id?: string | null
    readonly text: string
    readonly files?: ReadonlyArray<{
      readonly uri: string
      readonly name?: string
      readonly description?: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["metadata"]
  readonly delivery?: {
    readonly id?: string | null
    readonly text: string
    readonly files?: ReadonlyArray<{
      readonly uri: string
      readonly name?: string
      readonly description?: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["delivery"]
  readonly resume?: {
    readonly id?: string | null
    readonly text: string
    readonly files?: ReadonlyArray<{
      readonly uri: string
      readonly name?: string
      readonly description?: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["resume"]
}

export type SessionPromptOutput = { data: SessionPendingUser }["data"]

export type SessionCommandInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id?: {
    readonly id?: string | null
    readonly command: string
    readonly arguments?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly files?: ReadonlyArray<{
      readonly uri: string
      readonly name?: string
      readonly description?: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["id"]
  readonly command: {
    readonly id?: string | null
    readonly command: string
    readonly arguments?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly files?: ReadonlyArray<{
      readonly uri: string
      readonly name?: string
      readonly description?: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["command"]
  readonly arguments?: {
    readonly id?: string | null
    readonly command: string
    readonly arguments?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly files?: ReadonlyArray<{
      readonly uri: string
      readonly name?: string
      readonly description?: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["arguments"]
  readonly agent?: {
    readonly id?: string | null
    readonly command: string
    readonly arguments?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly files?: ReadonlyArray<{
      readonly uri: string
      readonly name?: string
      readonly description?: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["agent"]
  readonly model?: {
    readonly id?: string | null
    readonly command: string
    readonly arguments?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly files?: ReadonlyArray<{
      readonly uri: string
      readonly name?: string
      readonly description?: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["model"]
  readonly files?: {
    readonly id?: string | null
    readonly command: string
    readonly arguments?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly files?: ReadonlyArray<{
      readonly uri: string
      readonly name?: string
      readonly description?: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["files"]
  readonly agents?: {
    readonly id?: string | null
    readonly command: string
    readonly arguments?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly files?: ReadonlyArray<{
      readonly uri: string
      readonly name?: string
      readonly description?: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["agents"]
  readonly delivery?: {
    readonly id?: string | null
    readonly command: string
    readonly arguments?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly files?: ReadonlyArray<{
      readonly uri: string
      readonly name?: string
      readonly description?: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["delivery"]
  readonly resume?: {
    readonly id?: string | null
    readonly command: string
    readonly arguments?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly files?: ReadonlyArray<{
      readonly uri: string
      readonly name?: string
      readonly description?: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["resume"]
}

export type SessionCommandOutput = { data: SessionPendingUser }["data"]

export type SessionSkillInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id?: {
    readonly id?: string | undefined
    readonly skill: string
    readonly resume?: boolean | undefined
  }["id"]
  readonly skill: {
    readonly id?: string | undefined
    readonly skill: string
    readonly resume?: boolean | undefined
  }["skill"]
  readonly resume?: {
    readonly id?: string | undefined
    readonly skill: string
    readonly resume?: boolean | undefined
  }["resume"]
}

export type SessionSkillOutput = void

export type SessionSyntheticInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id?: {
    readonly id?: string | null
    readonly text: string
    readonly description?: string | null
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["id"]
  readonly text: {
    readonly id?: string | null
    readonly text: string
    readonly description?: string | null
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["text"]
  readonly description?: {
    readonly id?: string | null
    readonly text: string
    readonly description?: string | null
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["description"]
  readonly metadata?: {
    readonly id?: string | null
    readonly text: string
    readonly description?: string | null
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["metadata"]
  readonly delivery?: {
    readonly id?: string | null
    readonly text: string
    readonly description?: string | null
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["delivery"]
  readonly resume?: {
    readonly id?: string | null
    readonly text: string
    readonly description?: string | null
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["resume"]
}

export type SessionSyntheticOutput = { data: SessionPendingSynthetic }["data"]

export type SessionShellInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id?: { readonly id?: string | undefined; readonly command: string }["id"]
  readonly command: { readonly id?: string | undefined; readonly command: string }["command"]
}

export type SessionShellOutput = void

export type SessionCompactInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id?: { readonly id?: string | undefined }["id"]
}

export type SessionCompactOutput = { data: SessionPendingCompaction }["data"]

export type SessionWaitInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionWaitOutput = void

export type SessionRevertStageInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly messageID: { readonly messageID: string; readonly files?: boolean | undefined }["messageID"]
  readonly files?: { readonly messageID: string; readonly files?: boolean | undefined }["files"]
}

export type SessionRevertStageOutput = { data: SessionRevert }["data"]

export type SessionRevertClearInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionRevertClearOutput = void

export type SessionRevertCommitInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionRevertCommitOutput = void

export type SessionContextInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionContextOutput = { data: Array<SessionMessageInfo> }["data"]

export type SessionPendingListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionPendingListOutput = { data: Array<SessionPendingInfo> }["data"]

export type SessionInstructionsEntryListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionInstructionsEntryListOutput = { data: Array<InstructionEntryInfo> }["data"]

export type SessionInstructionsEntryPutInput = {
  readonly sessionID: { readonly sessionID: string; readonly key: string }["sessionID"]
  readonly key: { readonly sessionID: string; readonly key: string }["key"]
  readonly value: { readonly value: JsonValue }["value"]
}

export type SessionInstructionsEntryPutOutput = void

export type SessionInstructionsEntryRemoveInput = {
  readonly sessionID: { readonly sessionID: string; readonly key: string }["sessionID"]
  readonly key: { readonly sessionID: string; readonly key: string }["key"]
}

export type SessionInstructionsEntryRemoveOutput = void

export type SessionLogInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly after?: { readonly after?: number | undefined; readonly follow?: boolean | undefined }["after"]
  readonly follow?: { readonly after?: number | undefined; readonly follow?: boolean | undefined }["follow"]
}

export type SessionLogOutput = SessionLogItem

export type SessionInterruptInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionInterruptOutput = void

export type SessionBackgroundInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionBackgroundOutput = void

export type SessionMessageInput = {
  readonly sessionID: { readonly sessionID: string; readonly messageID: string }["sessionID"]
  readonly messageID: { readonly sessionID: string; readonly messageID: string }["messageID"]
}

export type SessionMessageOutput = { data: SessionMessageInfo }["data"]

export type MessageListInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly limit?: {
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly cursor?: string | undefined
  }["limit"]
  readonly order?: {
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly cursor?: string | undefined
  }["order"]
  readonly cursor?: {
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly cursor?: string | undefined
  }["cursor"]
}

export type MessageListOutput = SessionMessagesResponse

export type ModelListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ModelListOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Array<ModelInfo>
}

export type ModelDefaultInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ModelDefaultOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: ModelInfo | null
}

export type GenerateTextInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly prompt: {
    readonly prompt: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
  }["prompt"]
  readonly model?: {
    readonly prompt: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
  }["model"]
}

export type GenerateTextOutput = GenerateTextResponse["data"]

export type ProviderListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ProviderListOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Array<ProviderV2Info>
}

export type ProviderGetInput = {
  readonly providerID: { readonly providerID: string }["providerID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ProviderGetOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: ProviderV2Info
}

export type IntegrationListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type IntegrationListOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Array<IntegrationInfo>
}

export type IntegrationGetInput = {
  readonly integrationID: { readonly integrationID: string }["integrationID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type IntegrationGetOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: IntegrationInfo | null
}

export type IntegrationConnectKeyInput = {
  readonly integrationID: { readonly integrationID: string }["integrationID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly key: { readonly key: string; readonly label?: string | undefined }["key"]
  readonly label?: { readonly key: string; readonly label?: string | undefined }["label"]
}

export type IntegrationConnectKeyOutput = void

export type IntegrationConnectOauthInput = {
  readonly integrationID: { readonly integrationID: string }["integrationID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly methodID: {
    readonly methodID: string
    readonly inputs: { readonly [x: string]: string }
    readonly label?: string | undefined
  }["methodID"]
  readonly inputs: {
    readonly methodID: string
    readonly inputs: { readonly [x: string]: string }
    readonly label?: string | undefined
  }["inputs"]
  readonly label?: {
    readonly methodID: string
    readonly inputs: { readonly [x: string]: string }
    readonly label?: string | undefined
  }["label"]
}

export type IntegrationConnectOauthOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: {
    attemptID: string
    url: string
    instructions: string
    mode: "auto" | "code"
    time: { created: number | "Infinity" | "-Infinity" | "NaN"; expires: number | "Infinity" | "-Infinity" | "NaN" }
  }
}

export type IntegrationAttemptStatusInput = {
  readonly attemptID: { readonly attemptID: string }["attemptID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type IntegrationAttemptStatusOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: IntegrationAttemptStatus
}

export type IntegrationAttemptCompleteInput = {
  readonly attemptID: { readonly attemptID: string }["attemptID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly code?: { readonly code?: string | undefined }["code"]
}

export type IntegrationAttemptCompleteOutput = void

export type IntegrationAttemptCancelInput = {
  readonly attemptID: { readonly attemptID: string }["attemptID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type IntegrationAttemptCancelOutput = void

export type McpListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type McpListOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Array<McpServer>
}

export type McpResourceCatalogInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type McpResourceCatalogOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: McpResourceCatalog
}

export type CredentialUpdateInput = {
  readonly credentialID: { readonly credentialID: string }["credentialID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly label: { readonly label: string }["label"]
}

export type CredentialUpdateOutput = void

export type CredentialRemoveInput = {
  readonly credentialID: { readonly credentialID: string }["credentialID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type CredentialRemoveOutput = void

export type ProjectListOutput = Array<Project>

export type ProjectCurrentInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ProjectCurrentOutput = ProjectCurrent

export type ProjectDirectoriesInput = {
  readonly projectID: { readonly projectID: string }["projectID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ProjectDirectoriesOutput = ProjectDirectories

export type FormRequestListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type FormRequestListOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Array<FormInfo>
}

export type FormListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type FormListOutput = { data: Array<FormInfo> }["data"]

export type FormCreateInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id?: {
    readonly id?: string | null
    readonly title: string
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly fields: readonly [
      (
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
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
  }["id"]
  readonly title: {
    readonly id?: string | null
    readonly title: string
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly fields: readonly [
      (
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
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
  }["title"]
  readonly metadata?: {
    readonly id?: string | null
    readonly title: string
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly fields: readonly [
      (
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
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
  }["metadata"]
  readonly fields: {
    readonly id?: string | null
    readonly title: string
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly fields: readonly [
      (
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
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
  }["fields"]
}

export type FormCreateOutput = { data: FormInfo }["data"]

export type FormGetInput = {
  readonly sessionID: { readonly sessionID: string; readonly formID: string }["sessionID"]
  readonly formID: { readonly sessionID: string; readonly formID: string }["formID"]
}

export type FormGetOutput = { data: FormInfo }["data"]

export type FormStateInput = {
  readonly sessionID: { readonly sessionID: string; readonly formID: string }["sessionID"]
  readonly formID: { readonly sessionID: string; readonly formID: string }["formID"]
}

export type FormStateOutput = { data: FormState }["data"]

export type FormReplyInput = {
  readonly sessionID: { readonly sessionID: string; readonly formID: string }["sessionID"]
  readonly formID: { readonly sessionID: string; readonly formID: string }["formID"]
  readonly answer: {
    readonly answer: { readonly [x: string]: string | number | boolean | ReadonlyArray<string> }
  }["answer"]
}

export type FormReplyOutput = void

export type FormCancelInput = {
  readonly sessionID: { readonly sessionID: string; readonly formID: string }["sessionID"]
  readonly formID: { readonly sessionID: string; readonly formID: string }["formID"]
}

export type FormCancelOutput = void

export type PermissionRequestListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type PermissionRequestListOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Array<PermissionV2Request>
}

export type PermissionSavedListInput = { readonly projectID?: { readonly projectID?: string | undefined }["projectID"] }

export type PermissionSavedListOutput = { data: Array<PermissionSavedInfo> }["data"]

export type PermissionSavedRemoveInput = { readonly id: { readonly id: string }["id"] }

export type PermissionSavedRemoveOutput = void

export type PermissionCreateInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id?: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["id"]
  readonly action: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["action"]
  readonly resources: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["resources"]
  readonly save?: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["save"]
  readonly metadata?: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["metadata"]
  readonly source?: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["source"]
  readonly agent?: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["agent"]
}

export type PermissionCreateOutput = { data: { id: string; effect: PermissionV2Effect } }["data"]

export type PermissionListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type PermissionListOutput = { data: Array<PermissionV2Request> }["data"]

export type PermissionGetInput = {
  readonly sessionID: { readonly sessionID: string; readonly requestID: string }["sessionID"]
  readonly requestID: { readonly sessionID: string; readonly requestID: string }["requestID"]
}

export type PermissionGetOutput = { data: PermissionV2Request }["data"]

export type PermissionReplyInput = {
  readonly sessionID: { readonly sessionID: string; readonly requestID: string }["sessionID"]
  readonly requestID: { readonly sessionID: string; readonly requestID: string }["requestID"]
  readonly reply: { readonly reply: "once" | "always" | "reject"; readonly message?: string | undefined }["reply"]
  readonly message?: { readonly reply: "once" | "always" | "reject"; readonly message?: string | undefined }["message"]
}

export type PermissionReplyOutput = void

export type FileReadInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly path: string
}

export type FileReadOutput = globalThis.Uint8Array

export type FileListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly path?: string | undefined
  }["location"]
  readonly path?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly path?: string | undefined
  }["path"]
}

export type FileListOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Array<FileSystemEntry>
}

export type FileFindInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly query: string
    readonly type?: "file" | "directory" | undefined
    readonly limit?: number | undefined
  }["location"]
  readonly query: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly query: string
    readonly type?: "file" | "directory" | undefined
    readonly limit?: number | undefined
  }["query"]
  readonly type?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly query: string
    readonly type?: "file" | "directory" | undefined
    readonly limit?: number | undefined
  }["type"]
  readonly limit?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly query: string
    readonly type?: "file" | "directory" | undefined
    readonly limit?: number | undefined
  }["limit"]
}

export type FileFindOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Array<FileSystemEntry>
}

export type CommandListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type CommandListOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Array<CommandInfo>
}

export type SkillListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type SkillListOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Array<SkillInfo>
}

export type EventSubscribeOutput = V2Event

export type PtyListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type PtyListOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Array<Pty>
}

export type PtyCreateInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly command?: {
    readonly command?: string
    readonly args?: ReadonlyArray<string>
    readonly cwd?: string
    readonly title?: string
    readonly env?: { readonly [x: string]: string }
  }["command"]
  readonly args?: {
    readonly command?: string
    readonly args?: ReadonlyArray<string>
    readonly cwd?: string
    readonly title?: string
    readonly env?: { readonly [x: string]: string }
  }["args"]
  readonly cwd?: {
    readonly command?: string
    readonly args?: ReadonlyArray<string>
    readonly cwd?: string
    readonly title?: string
    readonly env?: { readonly [x: string]: string }
  }["cwd"]
  readonly title?: {
    readonly command?: string
    readonly args?: ReadonlyArray<string>
    readonly cwd?: string
    readonly title?: string
    readonly env?: { readonly [x: string]: string }
  }["title"]
  readonly env?: {
    readonly command?: string
    readonly args?: ReadonlyArray<string>
    readonly cwd?: string
    readonly title?: string
    readonly env?: { readonly [x: string]: string }
  }["env"]
}

export type PtyCreateOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Pty
}

export type PtyGetInput = {
  readonly ptyID: { readonly ptyID: string }["ptyID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type PtyGetOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Pty
}

export type PtyUpdateInput = {
  readonly ptyID: { readonly ptyID: string }["ptyID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly title?: {
    readonly title?: string
    readonly size?: { readonly rows: number; readonly cols: number }
  }["title"]
  readonly size?: { readonly title?: string; readonly size?: { readonly rows: number; readonly cols: number } }["size"]
}

export type PtyUpdateOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Pty
}

export type PtyRemoveInput = {
  readonly ptyID: { readonly ptyID: string }["ptyID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type PtyRemoveOutput = void

export type ShellListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ShellListOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Array<ShellInfo1>
}

export type ShellCreateInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly command: {
    readonly command: string
    readonly cwd?: string
    readonly timeout: number
    readonly metadata?: { readonly [x: string]: JsonValue }
  }["command"]
  readonly cwd?: {
    readonly command: string
    readonly cwd?: string
    readonly timeout: number
    readonly metadata?: { readonly [x: string]: JsonValue }
  }["cwd"]
  readonly timeout: {
    readonly command: string
    readonly cwd?: string
    readonly timeout: number
    readonly metadata?: { readonly [x: string]: JsonValue }
  }["timeout"]
  readonly metadata?: {
    readonly command: string
    readonly cwd?: string
    readonly timeout: number
    readonly metadata?: { readonly [x: string]: JsonValue }
  }["metadata"]
}

export type ShellCreateOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: ShellInfo1
}

export type ShellGetInput = {
  readonly id: { readonly id: string }["id"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ShellGetOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: ShellInfo1
}

export type ShellTimeoutInput = {
  readonly id: { readonly id: string }["id"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly timeout: { readonly timeout: number }["timeout"]
}

export type ShellTimeoutOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: ShellInfo1
}

export type ShellOutputInput = {
  readonly id: { readonly id: string }["id"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly cursor?: number | undefined
    readonly limit?: number | undefined
  }["location"]
  readonly cursor?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly cursor?: number | undefined
    readonly limit?: number | undefined
  }["cursor"]
  readonly limit?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly cursor?: number | undefined
    readonly limit?: number | undefined
  }["limit"]
}

export type ShellOutputOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: { output: string; cursor: number; size: number; truncated: boolean }
}

export type ShellRemoveInput = {
  readonly id: { readonly id: string }["id"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ShellRemoveOutput = void

export type QuestionRequestListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type QuestionRequestListOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Array<QuestionV2Request>
}

export type QuestionListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type QuestionListOutput = { data: Array<QuestionV2Request> }["data"]

export type QuestionReplyInput = {
  readonly sessionID: { readonly sessionID: string; readonly requestID: string }["sessionID"]
  readonly requestID: { readonly sessionID: string; readonly requestID: string }["requestID"]
  readonly answers: { readonly answers: ReadonlyArray<ReadonlyArray<string>> }["answers"]
}

export type QuestionReplyOutput = void

export type QuestionRejectInput = {
  readonly sessionID: { readonly sessionID: string; readonly requestID: string }["sessionID"]
  readonly requestID: { readonly sessionID: string; readonly requestID: string }["requestID"]
}

export type QuestionRejectOutput = void

export type ReferenceListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ReferenceListOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Array<ReferenceInfo>
}

export type ProjectCopyCreateInput = {
  readonly projectID: { readonly projectID: string }["projectID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly strategy: { readonly strategy: string; readonly directory: string; readonly name?: string }["strategy"]
  readonly directory: { readonly strategy: string; readonly directory: string; readonly name?: string }["directory"]
  readonly name?: { readonly strategy: string; readonly directory: string; readonly name?: string }["name"]
}

export type ProjectCopyCreateOutput = ProjectCopyCopy

export type ProjectCopyRemoveInput = {
  readonly projectID: { readonly projectID: string }["projectID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly directory: { readonly directory: string; readonly force: boolean }["directory"]
  readonly force: { readonly directory: string; readonly force: boolean }["force"]
}

export type ProjectCopyRemoveOutput = void

export type ProjectCopyRefreshInput = {
  readonly projectID: { readonly projectID: string }["projectID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ProjectCopyRefreshOutput = void

export type VcsStatusInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type VcsStatusOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Array<VcsFileStatus>
}

export type VcsDiffInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly mode: "working" | "branch"
    readonly context?: number | undefined
  }["location"]
  readonly mode: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly mode: "working" | "branch"
    readonly context?: number | undefined
  }["mode"]
  readonly context?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly mode: "working" | "branch"
    readonly context?: number | undefined
  }["context"]
}

export type VcsDiffOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Array<FileDiffInfo>
}

export type DebugLocationListOutput = Array<LocationRef>

export type DebugLocationEvictInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type DebugLocationEvictOutput = void
