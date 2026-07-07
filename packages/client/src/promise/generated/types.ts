import type { OpenCodeEventEncoded } from "@opencode-ai/protocol/groups/event"

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue }

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

export type HealthGetOutput = { readonly healthy: true; readonly version: string; readonly pid: number }

export type LocationGetInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type LocationGetOutput = {
  readonly directory: string
  readonly workspaceID?: string
  readonly project: { readonly id: string; readonly directory: string }
}

export type AgentListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type AgentListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly request: {
      readonly settings: { readonly [x: string]: JsonValue }
      readonly headers: { readonly [x: string]: string }
      readonly body: { readonly [x: string]: JsonValue }
    }
    readonly system?: string
    readonly description?: string
    readonly mode: "subagent" | "primary" | "all"
    readonly hidden: boolean
    readonly color?: string | "primary" | "secondary" | "accent" | "success" | "warning" | "error" | "info"
    readonly steps?: number
    readonly permissions: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
    }>
  }>
}

export type PluginListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type PluginListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{ readonly id: string }>
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

export type SessionListOutput = {
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly parentID?: string
    readonly fork?: { readonly sessionID: string; readonly messageID?: string }
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
    readonly time: { readonly created: number; readonly updated: number; readonly archived?: number }
    readonly title: string
    readonly location: { readonly directory: string; readonly workspaceID?: string }
    readonly subpath?: string
    readonly revert?: {
      readonly messageID: string
      readonly partID?: string
      readonly snapshot?: string
      readonly diff?: string
      readonly files?: ReadonlyArray<{
        readonly path: string
        readonly status: "added" | "modified" | "deleted"
        readonly additions: number
        readonly deletions: number
        readonly patch: string
      }>
    }
  }>
  readonly cursor: { readonly previous?: string | null; readonly next?: string | null }
}

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

export type SessionCreateOutput = {
  readonly data: {
    readonly id: string
    readonly parentID?: string
    readonly fork?: { readonly sessionID: string; readonly messageID?: string }
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
    readonly time: { readonly created: number; readonly updated: number; readonly archived?: number }
    readonly title: string
    readonly location: { readonly directory: string; readonly workspaceID?: string }
    readonly subpath?: string
    readonly revert?: {
      readonly messageID: string
      readonly partID?: string
      readonly snapshot?: string
      readonly diff?: string
      readonly files?: ReadonlyArray<{
        readonly path: string
        readonly status: "added" | "modified" | "deleted"
        readonly additions: number
        readonly deletions: number
        readonly patch: string
      }>
    }
  }
}["data"]

export type SessionActiveOutput = { readonly data: { readonly [x: string]: { readonly type: "running" } } }["data"]

export type SessionGetInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionGetOutput = {
  readonly data: {
    readonly id: string
    readonly parentID?: string
    readonly fork?: { readonly sessionID: string; readonly messageID?: string }
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
    readonly time: { readonly created: number; readonly updated: number; readonly archived?: number }
    readonly title: string
    readonly location: { readonly directory: string; readonly workspaceID?: string }
    readonly subpath?: string
    readonly revert?: {
      readonly messageID: string
      readonly partID?: string
      readonly snapshot?: string
      readonly diff?: string
      readonly files?: ReadonlyArray<{
        readonly path: string
        readonly status: "added" | "modified" | "deleted"
        readonly additions: number
        readonly deletions: number
        readonly patch: string
      }>
    }
  }
}["data"]

export type SessionRemoveInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionRemoveOutput = void

export type SessionForkInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly messageID?: { readonly messageID?: string | undefined }["messageID"]
}

export type SessionForkOutput = {
  readonly data: {
    readonly id: string
    readonly parentID?: string
    readonly fork?: { readonly sessionID: string; readonly messageID?: string }
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
    readonly time: { readonly created: number; readonly updated: number; readonly archived?: number }
    readonly title: string
    readonly location: { readonly directory: string; readonly workspaceID?: string }
    readonly subpath?: string
    readonly revert?: {
      readonly messageID: string
      readonly partID?: string
      readonly snapshot?: string
      readonly diff?: string
      readonly files?: ReadonlyArray<{
        readonly path: string
        readonly status: "added" | "modified" | "deleted"
        readonly additions: number
        readonly deletions: number
        readonly patch: string
      }>
    }
  }
}["data"]

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

export type SessionPromptInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id?: {
    readonly id?: string | null
    readonly prompt: {
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
    }
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["id"]
  readonly prompt: {
    readonly id?: string | null
    readonly prompt: {
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
    }
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["prompt"]
  readonly delivery?: {
    readonly id?: string | null
    readonly prompt: {
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
    }
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["delivery"]
  readonly resume?: {
    readonly id?: string | null
    readonly prompt: {
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
    }
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["resume"]
}

export type SessionPromptOutput = {
  readonly data: {
    readonly admittedSeq: number
    readonly id: string
    readonly sessionID: string
    readonly prompt: {
      readonly text: string
      readonly files?: ReadonlyArray<{
        readonly data: string
        readonly mime: string
        readonly source: { readonly type: "inline" } | { readonly type: "uri"; readonly uri: string }
        readonly name?: string
        readonly description?: string
        readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
      }>
      readonly agents?: ReadonlyArray<{
        readonly name: string
        readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
      }>
    }
    readonly delivery: "steer" | "queue"
    readonly timeCreated: number
    readonly promotedSeq?: number
  }
}["data"]

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

export type SessionCommandOutput = {
  readonly data: {
    readonly admittedSeq: number
    readonly id: string
    readonly sessionID: string
    readonly prompt: {
      readonly text: string
      readonly files?: ReadonlyArray<{
        readonly data: string
        readonly mime: string
        readonly source: { readonly type: "inline" } | { readonly type: "uri"; readonly uri: string }
        readonly name?: string
        readonly description?: string
        readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
      }>
      readonly agents?: ReadonlyArray<{
        readonly name: string
        readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
      }>
    }
    readonly delivery: "steer" | "queue"
    readonly timeCreated: number
    readonly promotedSeq?: number
  }
}["data"]

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
  readonly text: {
    readonly text: string
    readonly description?: string | null
    readonly metadata?: { readonly [x: string]: JsonValue }
  }["text"]
  readonly description?: {
    readonly text: string
    readonly description?: string | null
    readonly metadata?: { readonly [x: string]: JsonValue }
  }["description"]
  readonly metadata?: {
    readonly text: string
    readonly description?: string | null
    readonly metadata?: { readonly [x: string]: JsonValue }
  }["metadata"]
}

export type SessionSyntheticOutput = void

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

export type SessionCompactOutput = {
  readonly data: {
    readonly type: "compaction"
    readonly admittedSeq: number
    readonly id: string
    readonly sessionID: string
    readonly timeCreated: number
    readonly handledSeq?: number
  }
}["data"]

export type SessionWaitInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionWaitOutput = void

export type SessionRevertStageInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly messageID: { readonly messageID: string; readonly files?: boolean | undefined }["messageID"]
  readonly files?: { readonly messageID: string; readonly files?: boolean | undefined }["files"]
}

export type SessionRevertStageOutput = {
  readonly data: {
    readonly messageID: string
    readonly partID?: string
    readonly snapshot?: string
    readonly diff?: string
    readonly files?: ReadonlyArray<{
      readonly path: string
      readonly status: "added" | "modified" | "deleted"
      readonly additions: number
      readonly deletions: number
      readonly patch: string
    }>
  }
}["data"]

export type SessionRevertClearInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionRevertClearOutput = void

export type SessionRevertCommitInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionRevertCommitOutput = void

export type SessionContextInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionContextOutput = {
  readonly data: ReadonlyArray<
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "agent-switched"
        readonly agent: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "model-switched"
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly previous?: { readonly id: string; readonly providerID: string; readonly variant?: string }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly text: string
        readonly files?: ReadonlyArray<{
          readonly data: string
          readonly mime: string
          readonly source: { readonly type: "inline" } | { readonly type: "uri"; readonly uri: string }
          readonly name?: string
          readonly description?: string
          readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
        }>
        readonly agents?: ReadonlyArray<{
          readonly name: string
          readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
        }>
        readonly type: "user"
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly sessionID: string
        readonly text: string
        readonly description?: string
        readonly type: "synthetic"
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "system"
        readonly text: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "skill"
        readonly name: string
        readonly text: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number; readonly completed?: number }
        readonly type: "shell"
        readonly shell: {
          readonly id: string
          readonly status: "running" | "exited" | "timeout" | "killed"
          readonly command: string
          readonly cwd: string
          readonly shell: string
          readonly file: string
          readonly pid?: number
          readonly exit?: number | "Infinity" | "-Infinity" | "NaN"
          readonly metadata: { readonly [x: string]: JsonValue }
          readonly time: {
            readonly started: number | "Infinity" | "-Infinity" | "NaN"
            readonly completed?: number | "Infinity" | "-Infinity" | "NaN"
          }
        }
        readonly output?: {
          readonly output: string
          readonly cursor: number
          readonly size: number
          readonly truncated: boolean
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number; readonly completed?: number }
        readonly type: "assistant"
        readonly agent: string
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly content: ReadonlyArray<
          | { readonly type: "text"; readonly text: string }
          | {
              readonly type: "reasoning"
              readonly text: string
              readonly state?: { readonly [x: string]: JsonValue }
              readonly time?: { readonly created: number; readonly completed?: number }
            }
          | {
              readonly type: "tool"
              readonly id: string
              readonly name: string
              readonly executed?: boolean
              readonly providerState?: { readonly [x: string]: JsonValue }
              readonly providerResultState?: { readonly [x: string]: JsonValue }
              readonly state:
                | { readonly status: "pending"; readonly input: string }
                | {
                    readonly status: "running"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                  }
                | {
                    readonly status: "completed"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly attachments?: ReadonlyArray<{
                      readonly data: string
                      readonly mime: string
                      readonly source: { readonly type: "inline" } | { readonly type: "uri"; readonly uri: string }
                      readonly name?: string
                      readonly description?: string
                      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
                    }>
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                    readonly outputPaths?: ReadonlyArray<string>
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly result?: JsonValue
                  }
                | {
                    readonly status: "error"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly error: { readonly type: string; readonly message: string }
                    readonly result?: JsonValue
                  }
              readonly time: {
                readonly created: number
                readonly ran?: number
                readonly completed?: number
                readonly pruned?: number
              }
            }
        >
        readonly snapshot?: { readonly start?: string; readonly end?: string; readonly files?: ReadonlyArray<string> }
        readonly finish?: "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown"
        readonly cost?: number
        readonly tokens?: {
          readonly input: number
          readonly output: number
          readonly reasoning: number
          readonly cache: { readonly read: number; readonly write: number }
        }
        readonly error?: { readonly type: string; readonly message: string }
        readonly retry?: {
          readonly attempt: number
          readonly at: number
          readonly error: { readonly type: string; readonly message: string }
        }
      }
    | {
        readonly type: "compaction"
        readonly status: "queued" | "running" | "completed" | "failed"
        readonly reason: "auto" | "manual"
        readonly summary: string
        readonly recent: string
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
      }
  >
}["data"]

export type SessionInstructionsEntryListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionInstructionsEntryListOutput = {
  readonly data: ReadonlyArray<{ readonly key: string; readonly value: JsonValue }>
}["data"]

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

export type SessionLogOutput =
  | (
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.agent.selected"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: { readonly sessionID: string; readonly agent: string }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.model.selected"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: {
            readonly sessionID: string
            readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
          }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.moved"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: {
            readonly sessionID: string
            readonly location: { readonly directory: string; readonly workspaceID?: string }
            readonly subpath?: string
          }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.renamed"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: { readonly sessionID: string; readonly title: string }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.deleted"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: { readonly sessionID: string }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.forked"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: { readonly sessionID: string; readonly parentID: string; readonly from?: string }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.prompt.promoted"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: { readonly sessionID: string; readonly inputID: string }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.prompt.admitted"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: {
            readonly sessionID: string
            readonly inputID: string
            readonly prompt: {
              readonly text: string
              readonly files?: ReadonlyArray<{
                readonly data: string
                readonly mime: string
                readonly source: { readonly type: "inline" } | { readonly type: "uri"; readonly uri: string }
                readonly name?: string
                readonly description?: string
                readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
              }>
              readonly agents?: ReadonlyArray<{
                readonly name: string
                readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
              }>
            }
            readonly delivery: "steer" | "queue"
          }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.execution.started"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: { readonly sessionID: string }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.execution.succeeded"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: { readonly sessionID: string }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.execution.failed"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: {
            readonly sessionID: string
            readonly error: { readonly type: string; readonly message: string }
          }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.execution.interrupted"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: { readonly sessionID: string; readonly reason: "user" | "shutdown" | "superseded" }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.instructions.updated"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: { readonly sessionID: string; readonly text: string }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.synthetic"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: {
            readonly sessionID: string
            readonly text: string
            readonly description?: string
            readonly metadata?: { readonly [x: string]: unknown }
          }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.skill.activated"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: { readonly sessionID: string; readonly name: string; readonly text: string }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.shell.started"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: {
            readonly sessionID: string
            readonly shell: {
              readonly id: string
              readonly status: "running" | "exited" | "timeout" | "killed"
              readonly command: string
              readonly cwd: string
              readonly shell: string
              readonly file: string
              readonly pid?: number
              readonly exit?: number
              readonly metadata: { readonly [x: string]: unknown }
              readonly time: { readonly started: number; readonly completed?: number }
            }
          }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.shell.ended"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: {
            readonly sessionID: string
            readonly shell: {
              readonly id: string
              readonly status: "running" | "exited" | "timeout" | "killed"
              readonly command: string
              readonly cwd: string
              readonly shell: string
              readonly file: string
              readonly pid?: number
              readonly exit?: number
              readonly metadata: { readonly [x: string]: unknown }
              readonly time: { readonly started: number; readonly completed?: number }
            }
            readonly output: {
              readonly output: string
              readonly cursor: number
              readonly size: number
              readonly truncated: boolean
            }
          }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.step.started"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: {
            readonly sessionID: string
            readonly assistantMessageID: string
            readonly agent: string
            readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
            readonly snapshot?: string
          }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.step.ended"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: {
            readonly sessionID: string
            readonly assistantMessageID: string
            readonly finish: "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown"
            readonly cost: number
            readonly tokens: {
              readonly input: number
              readonly output: number
              readonly reasoning: number
              readonly cache: { readonly read: number; readonly write: number }
            }
            readonly snapshot?: string
            readonly files?: ReadonlyArray<string>
          }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.step.failed"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: {
            readonly sessionID: string
            readonly assistantMessageID: string
            readonly error: { readonly type: string; readonly message: string }
          }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.text.started"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: { readonly sessionID: string; readonly assistantMessageID: string; readonly ordinal: number }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.text.ended"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: {
            readonly sessionID: string
            readonly assistantMessageID: string
            readonly ordinal: number
            readonly text: string
          }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.reasoning.started"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: {
            readonly sessionID: string
            readonly assistantMessageID: string
            readonly ordinal: number
            readonly state?: { readonly [x: string]: unknown }
          }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.reasoning.ended"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: {
            readonly sessionID: string
            readonly assistantMessageID: string
            readonly ordinal: number
            readonly text: string
            readonly state?: { readonly [x: string]: unknown }
          }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.tool.input.started"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: {
            readonly sessionID: string
            readonly assistantMessageID: string
            readonly callID: string
            readonly name: string
          }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.tool.input.ended"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: {
            readonly sessionID: string
            readonly assistantMessageID: string
            readonly callID: string
            readonly text: string
          }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.tool.called"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: {
            readonly sessionID: string
            readonly assistantMessageID: string
            readonly callID: string
            readonly input: { readonly [x: string]: unknown }
            readonly executed: boolean
            readonly state?: { readonly [x: string]: unknown }
          }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.tool.progress"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: {
            readonly sessionID: string
            readonly assistantMessageID: string
            readonly callID: string
            readonly structured: { readonly [x: string]: unknown }
            readonly content: ReadonlyArray<
              | { readonly type: "text"; readonly text: string }
              | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
            >
          }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.tool.success"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: {
            readonly sessionID: string
            readonly assistantMessageID: string
            readonly callID: string
            readonly structured: { readonly [x: string]: unknown }
            readonly content: ReadonlyArray<
              | { readonly type: "text"; readonly text: string }
              | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
            >
            readonly outputPaths?: ReadonlyArray<string>
            readonly result?: unknown
            readonly executed: boolean
            readonly resultState?: { readonly [x: string]: unknown }
          }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.tool.failed"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: {
            readonly sessionID: string
            readonly assistantMessageID: string
            readonly callID: string
            readonly error: { readonly type: string; readonly message: string }
            readonly result?: unknown
            readonly executed: boolean
            readonly resultState?: { readonly [x: string]: unknown }
          }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.retry.scheduled"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: {
            readonly sessionID: string
            readonly assistantMessageID: string
            readonly attempt: number
            readonly at: number
            readonly error: { readonly type: string; readonly message: string }
          }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.compaction.admitted"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: { readonly sessionID: string; readonly inputID: string }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.compaction.started"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: { readonly sessionID: string; readonly reason: "auto" | "manual" }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.compaction.ended"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: {
            readonly sessionID: string
            readonly reason: "auto" | "manual"
            readonly text: string
            readonly recent: string
          }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.compaction.failed"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: { readonly sessionID: string }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.revert.staged"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: {
            readonly sessionID: string
            readonly revert: {
              readonly messageID: string
              readonly partID?: string
              readonly snapshot?: string
              readonly diff?: string
              readonly files?: ReadonlyArray<{
                readonly path: string
                readonly status: "added" | "modified" | "deleted"
                readonly additions: number
                readonly deletions: number
                readonly patch: string
              }>
            }
          }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.revert.cleared"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: { readonly sessionID: string }
        }
      | {
          readonly id: string
          readonly created: number
          readonly metadata?: { readonly [x: string]: unknown }
          readonly type: "session.revert.committed"
          readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
          readonly location?: { readonly directory: string; readonly workspaceID?: string }
          readonly data: { readonly sessionID: string; readonly to: string }
        }
    )
  | { readonly type: "log.synced"; readonly aggregateID: string; readonly seq?: number }

export type SessionInterruptInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionInterruptOutput = void

export type SessionBackgroundInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionBackgroundOutput = void

export type SessionMessageInput = {
  readonly sessionID: { readonly sessionID: string; readonly messageID: string }["sessionID"]
  readonly messageID: { readonly sessionID: string; readonly messageID: string }["messageID"]
}

export type SessionMessageOutput = {
  readonly data:
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "agent-switched"
        readonly agent: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "model-switched"
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly previous?: { readonly id: string; readonly providerID: string; readonly variant?: string }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly text: string
        readonly files?: ReadonlyArray<{
          readonly data: string
          readonly mime: string
          readonly source: { readonly type: "inline" } | { readonly type: "uri"; readonly uri: string }
          readonly name?: string
          readonly description?: string
          readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
        }>
        readonly agents?: ReadonlyArray<{
          readonly name: string
          readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
        }>
        readonly type: "user"
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly sessionID: string
        readonly text: string
        readonly description?: string
        readonly type: "synthetic"
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "system"
        readonly text: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "skill"
        readonly name: string
        readonly text: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number; readonly completed?: number }
        readonly type: "shell"
        readonly shell: {
          readonly id: string
          readonly status: "running" | "exited" | "timeout" | "killed"
          readonly command: string
          readonly cwd: string
          readonly shell: string
          readonly file: string
          readonly pid?: number
          readonly exit?: number | "Infinity" | "-Infinity" | "NaN"
          readonly metadata: { readonly [x: string]: JsonValue }
          readonly time: {
            readonly started: number | "Infinity" | "-Infinity" | "NaN"
            readonly completed?: number | "Infinity" | "-Infinity" | "NaN"
          }
        }
        readonly output?: {
          readonly output: string
          readonly cursor: number
          readonly size: number
          readonly truncated: boolean
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number; readonly completed?: number }
        readonly type: "assistant"
        readonly agent: string
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly content: ReadonlyArray<
          | { readonly type: "text"; readonly text: string }
          | {
              readonly type: "reasoning"
              readonly text: string
              readonly state?: { readonly [x: string]: JsonValue }
              readonly time?: { readonly created: number; readonly completed?: number }
            }
          | {
              readonly type: "tool"
              readonly id: string
              readonly name: string
              readonly executed?: boolean
              readonly providerState?: { readonly [x: string]: JsonValue }
              readonly providerResultState?: { readonly [x: string]: JsonValue }
              readonly state:
                | { readonly status: "pending"; readonly input: string }
                | {
                    readonly status: "running"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                  }
                | {
                    readonly status: "completed"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly attachments?: ReadonlyArray<{
                      readonly data: string
                      readonly mime: string
                      readonly source: { readonly type: "inline" } | { readonly type: "uri"; readonly uri: string }
                      readonly name?: string
                      readonly description?: string
                      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
                    }>
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                    readonly outputPaths?: ReadonlyArray<string>
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly result?: JsonValue
                  }
                | {
                    readonly status: "error"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly error: { readonly type: string; readonly message: string }
                    readonly result?: JsonValue
                  }
              readonly time: {
                readonly created: number
                readonly ran?: number
                readonly completed?: number
                readonly pruned?: number
              }
            }
        >
        readonly snapshot?: { readonly start?: string; readonly end?: string; readonly files?: ReadonlyArray<string> }
        readonly finish?: "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown"
        readonly cost?: number
        readonly tokens?: {
          readonly input: number
          readonly output: number
          readonly reasoning: number
          readonly cache: { readonly read: number; readonly write: number }
        }
        readonly error?: { readonly type: string; readonly message: string }
        readonly retry?: {
          readonly attempt: number
          readonly at: number
          readonly error: { readonly type: string; readonly message: string }
        }
      }
    | {
        readonly type: "compaction"
        readonly status: "queued" | "running" | "completed" | "failed"
        readonly reason: "auto" | "manual"
        readonly summary: string
        readonly recent: string
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
      }
}["data"]

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

export type MessageListOutput = {
  readonly data: ReadonlyArray<
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "agent-switched"
        readonly agent: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "model-switched"
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly previous?: { readonly id: string; readonly providerID: string; readonly variant?: string }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly text: string
        readonly files?: ReadonlyArray<{
          readonly data: string
          readonly mime: string
          readonly source: { readonly type: "inline" } | { readonly type: "uri"; readonly uri: string }
          readonly name?: string
          readonly description?: string
          readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
        }>
        readonly agents?: ReadonlyArray<{
          readonly name: string
          readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
        }>
        readonly type: "user"
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly sessionID: string
        readonly text: string
        readonly description?: string
        readonly type: "synthetic"
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "system"
        readonly text: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "skill"
        readonly name: string
        readonly text: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number; readonly completed?: number }
        readonly type: "shell"
        readonly shell: {
          readonly id: string
          readonly status: "running" | "exited" | "timeout" | "killed"
          readonly command: string
          readonly cwd: string
          readonly shell: string
          readonly file: string
          readonly pid?: number
          readonly exit?: number | "Infinity" | "-Infinity" | "NaN"
          readonly metadata: { readonly [x: string]: JsonValue }
          readonly time: {
            readonly started: number | "Infinity" | "-Infinity" | "NaN"
            readonly completed?: number | "Infinity" | "-Infinity" | "NaN"
          }
        }
        readonly output?: {
          readonly output: string
          readonly cursor: number
          readonly size: number
          readonly truncated: boolean
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number; readonly completed?: number }
        readonly type: "assistant"
        readonly agent: string
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly content: ReadonlyArray<
          | { readonly type: "text"; readonly text: string }
          | {
              readonly type: "reasoning"
              readonly text: string
              readonly state?: { readonly [x: string]: JsonValue }
              readonly time?: { readonly created: number; readonly completed?: number }
            }
          | {
              readonly type: "tool"
              readonly id: string
              readonly name: string
              readonly executed?: boolean
              readonly providerState?: { readonly [x: string]: JsonValue }
              readonly providerResultState?: { readonly [x: string]: JsonValue }
              readonly state:
                | { readonly status: "pending"; readonly input: string }
                | {
                    readonly status: "running"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                  }
                | {
                    readonly status: "completed"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly attachments?: ReadonlyArray<{
                      readonly data: string
                      readonly mime: string
                      readonly source: { readonly type: "inline" } | { readonly type: "uri"; readonly uri: string }
                      readonly name?: string
                      readonly description?: string
                      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
                    }>
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                    readonly outputPaths?: ReadonlyArray<string>
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly result?: JsonValue
                  }
                | {
                    readonly status: "error"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly error: { readonly type: string; readonly message: string }
                    readonly result?: JsonValue
                  }
              readonly time: {
                readonly created: number
                readonly ran?: number
                readonly completed?: number
                readonly pruned?: number
              }
            }
        >
        readonly snapshot?: { readonly start?: string; readonly end?: string; readonly files?: ReadonlyArray<string> }
        readonly finish?: "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown"
        readonly cost?: number
        readonly tokens?: {
          readonly input: number
          readonly output: number
          readonly reasoning: number
          readonly cache: { readonly read: number; readonly write: number }
        }
        readonly error?: { readonly type: string; readonly message: string }
        readonly retry?: {
          readonly attempt: number
          readonly at: number
          readonly error: { readonly type: string; readonly message: string }
        }
      }
    | {
        readonly type: "compaction"
        readonly status: "queued" | "running" | "completed" | "failed"
        readonly reason: "auto" | "manual"
        readonly summary: string
        readonly recent: string
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
      }
  >
  readonly cursor: { readonly previous?: string | null; readonly next?: string | null }
}

export type ModelListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ModelListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly modelID: string
    readonly providerID: string
    readonly family?: string
    readonly name: string
    readonly package?: string
    readonly settings?: { readonly [x: string]: JsonValue }
    readonly headers?: { readonly [x: string]: string }
    readonly body?: { readonly [x: string]: JsonValue }
    readonly capabilities: {
      readonly tools: boolean
      readonly input: ReadonlyArray<string>
      readonly output: ReadonlyArray<string>
    }
    readonly variants: ReadonlyArray<{
      readonly id: string
      readonly settings?: { readonly [x: string]: JsonValue }
      readonly headers?: { readonly [x: string]: string }
      readonly body?: { readonly [x: string]: JsonValue }
    }>
    readonly time: { readonly released: number }
    readonly cost: ReadonlyArray<{
      readonly tier?: { readonly type: "context"; readonly size: number }
      readonly input: number
      readonly output: number
      readonly cache: { readonly read: number; readonly write: number }
    }>
    readonly status: "alpha" | "beta" | "deprecated" | "active"
    readonly enabled: boolean
    readonly limit: { readonly context: number; readonly input?: number; readonly output: number }
  }>
}

export type ModelDefaultInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ModelDefaultOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly id: string
    readonly modelID: string
    readonly providerID: string
    readonly family?: string
    readonly name: string
    readonly package?: string
    readonly settings?: { readonly [x: string]: JsonValue }
    readonly headers?: { readonly [x: string]: string }
    readonly body?: { readonly [x: string]: JsonValue }
    readonly capabilities: {
      readonly tools: boolean
      readonly input: ReadonlyArray<string>
      readonly output: ReadonlyArray<string>
    }
    readonly variants: ReadonlyArray<{
      readonly id: string
      readonly settings?: { readonly [x: string]: JsonValue }
      readonly headers?: { readonly [x: string]: string }
      readonly body?: { readonly [x: string]: JsonValue }
    }>
    readonly time: { readonly released: number }
    readonly cost: ReadonlyArray<{
      readonly tier?: { readonly type: "context"; readonly size: number }
      readonly input: number
      readonly output: number
      readonly cache: { readonly read: number; readonly write: number }
    }>
    readonly status: "alpha" | "beta" | "deprecated" | "active"
    readonly enabled: boolean
    readonly limit: { readonly context: number; readonly input?: number; readonly output: number }
  } | null
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

export type GenerateTextOutput = { readonly data: { readonly text: string } }["data"]

export type ProviderListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ProviderListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly integrationID?: string
    readonly name: string
    readonly disabled?: boolean
    readonly package: string
    readonly settings?: { readonly [x: string]: JsonValue }
    readonly headers?: { readonly [x: string]: string }
    readonly body?: { readonly [x: string]: JsonValue }
  }>
}

export type ProviderGetInput = {
  readonly providerID: { readonly providerID: string }["providerID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ProviderGetOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly id: string
    readonly integrationID?: string
    readonly name: string
    readonly disabled?: boolean
    readonly package: string
    readonly settings?: { readonly [x: string]: JsonValue }
    readonly headers?: { readonly [x: string]: string }
    readonly body?: { readonly [x: string]: JsonValue }
  }
}

export type IntegrationListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type IntegrationListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly methods: ReadonlyArray<
      | {
          readonly id: string
          readonly type: "oauth"
          readonly label: string
          readonly prompts?: ReadonlyArray<
            | {
                readonly type: "text"
                readonly key: string
                readonly message: string
                readonly placeholder?: string
                readonly when?: { readonly key: string; readonly op: "eq" | "neq"; readonly value: string }
              }
            | {
                readonly type: "select"
                readonly key: string
                readonly message: string
                readonly options: ReadonlyArray<{
                  readonly label: string
                  readonly value: string
                  readonly hint?: string
                }>
                readonly when?: { readonly key: string; readonly op: "eq" | "neq"; readonly value: string }
              }
          >
        }
      | { readonly type: "key"; readonly label?: string }
      | { readonly type: "env"; readonly names: ReadonlyArray<string> }
    >
    readonly connections: ReadonlyArray<
      | { readonly type: "credential"; readonly id: string; readonly label: string }
      | { readonly type: "env"; readonly name: string }
    >
  }>
}

export type IntegrationGetInput = {
  readonly integrationID: { readonly integrationID: string }["integrationID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type IntegrationGetOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly id: string
    readonly name: string
    readonly methods: ReadonlyArray<
      | {
          readonly id: string
          readonly type: "oauth"
          readonly label: string
          readonly prompts?: ReadonlyArray<
            | {
                readonly type: "text"
                readonly key: string
                readonly message: string
                readonly placeholder?: string
                readonly when?: { readonly key: string; readonly op: "eq" | "neq"; readonly value: string }
              }
            | {
                readonly type: "select"
                readonly key: string
                readonly message: string
                readonly options: ReadonlyArray<{
                  readonly label: string
                  readonly value: string
                  readonly hint?: string
                }>
                readonly when?: { readonly key: string; readonly op: "eq" | "neq"; readonly value: string }
              }
          >
        }
      | { readonly type: "key"; readonly label?: string }
      | { readonly type: "env"; readonly names: ReadonlyArray<string> }
    >
    readonly connections: ReadonlyArray<
      | { readonly type: "credential"; readonly id: string; readonly label: string }
      | { readonly type: "env"; readonly name: string }
    >
  } | null
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
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly attemptID: string
    readonly url: string
    readonly instructions: string
    readonly mode: "auto" | "code"
    readonly time: {
      readonly created: number | "Infinity" | "-Infinity" | "NaN"
      readonly expires: number | "Infinity" | "-Infinity" | "NaN"
    }
  }
}

export type IntegrationAttemptStatusInput = {
  readonly attemptID: { readonly attemptID: string }["attemptID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type IntegrationAttemptStatusOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data:
    | {
        readonly status: "pending"
        readonly time: {
          readonly created: number | "Infinity" | "-Infinity" | "NaN"
          readonly expires: number | "Infinity" | "-Infinity" | "NaN"
        }
      }
    | {
        readonly status: "complete"
        readonly time: {
          readonly created: number | "Infinity" | "-Infinity" | "NaN"
          readonly expires: number | "Infinity" | "-Infinity" | "NaN"
        }
      }
    | {
        readonly status: "failed"
        readonly message: string
        readonly time: {
          readonly created: number | "Infinity" | "-Infinity" | "NaN"
          readonly expires: number | "Infinity" | "-Infinity" | "NaN"
        }
      }
    | {
        readonly status: "expired"
        readonly time: {
          readonly created: number | "Infinity" | "-Infinity" | "NaN"
          readonly expires: number | "Infinity" | "-Infinity" | "NaN"
        }
      }
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

export type ServerMcpListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerMcpListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly name: string
    readonly status:
      | { readonly status: "connected" }
      | { readonly status: "pending" }
      | { readonly status: "disabled" }
      | { readonly status: "failed"; readonly error: string }
      | { readonly status: "needs_auth" }
      | { readonly status: "needs_client_registration"; readonly error: string }
    readonly integrationID?: string
  }>
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

export type ProjectListOutput = ReadonlyArray<{
  readonly id: string
  readonly worktree: string
  readonly vcs?: "git" | "hg"
  readonly name?: string
  readonly icon?: { readonly url?: string; readonly override?: string; readonly color?: string }
  readonly commands?: { readonly start?: string }
  readonly time: { readonly created: number; readonly updated: number; readonly initialized?: number }
  readonly sandboxes: ReadonlyArray<string>
}>

export type ProjectCurrentInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ProjectCurrentOutput = { readonly id: string; readonly directory: string }

export type ProjectDirectoriesInput = {
  readonly projectID: { readonly projectID: string }["projectID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ProjectDirectoriesOutput = ReadonlyArray<{ readonly directory: string; readonly strategy?: string }>

export type FormListRequestsInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type FormListRequestsOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<
    | {
        readonly id: string
        readonly sessionID: string
        readonly title?: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly mode: "form"
        readonly fields: ReadonlyArray<
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
        >
      }
    | {
        readonly id: string
        readonly sessionID: string
        readonly title?: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly mode: "url"
        readonly url: string
      }
  >
}

export type FormListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type FormListOutput = {
  readonly data: ReadonlyArray<
    | {
        readonly id: string
        readonly sessionID: string
        readonly title?: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly mode: "form"
        readonly fields: ReadonlyArray<
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
        >
      }
    | {
        readonly id: string
        readonly sessionID: string
        readonly title?: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly mode: "url"
        readonly url: string
      }
  >
}["data"]

export type FormCreateInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id?: {
    readonly id?: string | null
    readonly title?: string
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly mode: "form" | "url"
    readonly fields?: ReadonlyArray<
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
    > | null
    readonly url?: string | null
  }["id"]
  readonly title?: {
    readonly id?: string | null
    readonly title?: string
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly mode: "form" | "url"
    readonly fields?: ReadonlyArray<
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
    > | null
    readonly url?: string | null
  }["title"]
  readonly metadata?: {
    readonly id?: string | null
    readonly title?: string
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly mode: "form" | "url"
    readonly fields?: ReadonlyArray<
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
    > | null
    readonly url?: string | null
  }["metadata"]
  readonly mode: {
    readonly id?: string | null
    readonly title?: string
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly mode: "form" | "url"
    readonly fields?: ReadonlyArray<
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
    > | null
    readonly url?: string | null
  }["mode"]
  readonly fields?: {
    readonly id?: string | null
    readonly title?: string
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly mode: "form" | "url"
    readonly fields?: ReadonlyArray<
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
    > | null
    readonly url?: string | null
  }["fields"]
  readonly url?: {
    readonly id?: string | null
    readonly title?: string
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly mode: "form" | "url"
    readonly fields?: ReadonlyArray<
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
    > | null
    readonly url?: string | null
  }["url"]
}

export type FormCreateOutput = {
  readonly data:
    | {
        readonly id: string
        readonly sessionID: string
        readonly title?: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly mode: "form"
        readonly fields: ReadonlyArray<
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
        >
      }
    | {
        readonly id: string
        readonly sessionID: string
        readonly title?: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly mode: "url"
        readonly url: string
      }
}["data"]

export type FormGetInput = {
  readonly sessionID: { readonly sessionID: string; readonly formID: string }["sessionID"]
  readonly formID: { readonly sessionID: string; readonly formID: string }["formID"]
}

export type FormGetOutput = {
  readonly data:
    | {
        readonly id: string
        readonly sessionID: string
        readonly title?: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly mode: "form"
        readonly fields: ReadonlyArray<
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
        >
      }
    | {
        readonly id: string
        readonly sessionID: string
        readonly title?: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly mode: "url"
        readonly url: string
      }
}["data"]

export type FormStateInput = {
  readonly sessionID: { readonly sessionID: string; readonly formID: string }["sessionID"]
  readonly formID: { readonly sessionID: string; readonly formID: string }["formID"]
}

export type FormStateOutput = {
  readonly data:
    | { readonly status: "pending" }
    | {
        readonly status: "answered"
        readonly answer: { readonly [x: string]: string | number | boolean | ReadonlyArray<string> }
      }
    | { readonly status: "cancelled" }
}["data"]

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

export type PermissionListRequestsInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type PermissionListRequestsOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly sessionID: string
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
  }>
}

export type PermissionListSavedInput = { readonly projectID?: { readonly projectID?: string | undefined }["projectID"] }

export type PermissionListSavedOutput = {
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly projectID: string
    readonly action: string
    readonly resource: string
  }>
}["data"]

export type PermissionRemoveSavedInput = { readonly id: { readonly id: string }["id"] }

export type PermissionRemoveSavedOutput = void

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

export type PermissionCreateOutput = {
  readonly data: { readonly id: string; readonly effect: "allow" | "deny" | "ask" }
}["data"]

export type PermissionListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type PermissionListOutput = {
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly sessionID: string
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
  }>
}["data"]

export type PermissionGetInput = {
  readonly sessionID: { readonly sessionID: string; readonly requestID: string }["sessionID"]
  readonly requestID: { readonly sessionID: string; readonly requestID: string }["requestID"]
}

export type PermissionGetOutput = {
  readonly data: {
    readonly id: string
    readonly sessionID: string
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
  }
}["data"]

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
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{ readonly path: string; readonly type: "file" | "directory" }>
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
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{ readonly path: string; readonly type: "file" | "directory" }>
}

export type CommandListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type CommandListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly name: string
    readonly template: string
    readonly description?: string
    readonly agent?: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly subtask?: boolean
  }>
}

export type SkillListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type SkillListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly name: string
    readonly description?: string
    readonly slash?: boolean
    readonly autoinvoke?: boolean
    readonly location: string
    readonly content: string
  }>
}

export type EventSubscribeOutput =
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "models-dev.refreshed"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {}
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "integration.updated"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {}
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "integration.connection.updated"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly integrationID: string }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "catalog.updated"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {}
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "agent.updated"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {}
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.created"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly info: {
          readonly id: string
          readonly slug: string
          readonly projectID: string
          readonly workspaceID?: string
          readonly directory: string
          readonly path?: string
          readonly parentID?: string
          readonly summary?: {
            readonly additions: number
            readonly deletions: number
            readonly files: number
            readonly diffs?: ReadonlyArray<{
              readonly file?: string
              readonly patch?: string
              readonly additions: number
              readonly deletions: number
              readonly status?: "added" | "deleted" | "modified"
            }>
          }
          readonly cost?: number
          readonly tokens?: {
            readonly input: number
            readonly output: number
            readonly reasoning: number
            readonly cache: { readonly read: number; readonly write: number }
          }
          readonly share?: { readonly url: string }
          readonly title: string
          readonly agent?: string
          readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
          readonly version: string
          readonly metadata?: { readonly [x: string]: any }
          readonly time: {
            readonly created: number
            readonly updated: number
            readonly compacting?: number
            readonly archived?: number
          }
          readonly permission?: ReadonlyArray<{
            readonly permission: string
            readonly pattern: string
            readonly action: "allow" | "deny" | "ask"
          }>
          readonly revert?: {
            readonly messageID: string
            readonly partID?: string
            readonly snapshot?: string
            readonly diff?: string
          }
        }
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.updated"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly info: {
          readonly id: string
          readonly slug: string
          readonly projectID: string
          readonly workspaceID?: string
          readonly directory: string
          readonly path?: string
          readonly parentID?: string
          readonly summary?: {
            readonly additions: number
            readonly deletions: number
            readonly files: number
            readonly diffs?: ReadonlyArray<{
              readonly file?: string
              readonly patch?: string
              readonly additions: number
              readonly deletions: number
              readonly status?: "added" | "deleted" | "modified"
            }>
          }
          readonly cost?: number
          readonly tokens?: {
            readonly input: number
            readonly output: number
            readonly reasoning: number
            readonly cache: { readonly read: number; readonly write: number }
          }
          readonly share?: { readonly url: string }
          readonly title: string
          readonly agent?: string
          readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
          readonly version: string
          readonly metadata?: { readonly [x: string]: any }
          readonly time: {
            readonly created: number
            readonly updated: number
            readonly compacting?: number
            readonly archived?: number
          }
          readonly permission?: ReadonlyArray<{
            readonly permission: string
            readonly pattern: string
            readonly action: "allow" | "deny" | "ask"
          }>
          readonly revert?: {
            readonly messageID: string
            readonly partID?: string
            readonly snapshot?: string
            readonly diff?: string
          }
        }
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.deleted"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly info: {
          readonly id: string
          readonly slug: string
          readonly projectID: string
          readonly workspaceID?: string
          readonly directory: string
          readonly path?: string
          readonly parentID?: string
          readonly summary?: {
            readonly additions: number
            readonly deletions: number
            readonly files: number
            readonly diffs?: ReadonlyArray<{
              readonly file?: string
              readonly patch?: string
              readonly additions: number
              readonly deletions: number
              readonly status?: "added" | "deleted" | "modified"
            }>
          }
          readonly cost?: number
          readonly tokens?: {
            readonly input: number
            readonly output: number
            readonly reasoning: number
            readonly cache: { readonly read: number; readonly write: number }
          }
          readonly share?: { readonly url: string }
          readonly title: string
          readonly agent?: string
          readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
          readonly version: string
          readonly metadata?: { readonly [x: string]: any }
          readonly time: {
            readonly created: number
            readonly updated: number
            readonly compacting?: number
            readonly archived?: number
          }
          readonly permission?: ReadonlyArray<{
            readonly permission: string
            readonly pattern: string
            readonly action: "allow" | "deny" | "ask"
          }>
          readonly revert?: {
            readonly messageID: string
            readonly partID?: string
            readonly snapshot?: string
            readonly diff?: string
          }
        }
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "message.updated"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly info:
          | {
              readonly id: string
              readonly sessionID: string
              readonly role: "user"
              readonly time: { readonly created: number }
              readonly format?:
                | (
                    | { readonly type: "text" }
                    | {
                        readonly type: "json_schema"
                        readonly schema: { readonly [x: string]: any }
                        readonly retryCount?: number | undefined | undefined
                      }
                  )
                | undefined
              readonly summary?:
                | {
                    readonly title?: string | undefined
                    readonly body?: string | undefined
                    readonly diffs: ReadonlyArray<{
                      readonly file?: string
                      readonly patch?: string
                      readonly additions: number
                      readonly deletions: number
                      readonly status?: "added" | "deleted" | "modified"
                    }>
                  }
                | undefined
              readonly agent: string
              readonly model: {
                readonly providerID: string
                readonly modelID: string
                readonly variant?: string | undefined
              }
              readonly system?: string | undefined
              readonly tools?: { readonly [x: string]: boolean } | undefined
            }
          | {
              readonly id: string
              readonly sessionID: string
              readonly role: "assistant"
              readonly time: { readonly created: number; readonly completed?: number | undefined }
              readonly error?:
                | {
                    readonly name: "ProviderAuthError"
                    readonly data: { readonly providerID: string; readonly message: string }
                  }
                | {
                    readonly name: "UnknownError"
                    readonly data: { readonly message: string; readonly ref?: string | undefined }
                  }
                | { readonly name: "MessageOutputLengthError"; readonly data: {} }
                | { readonly name: "MessageAbortedError"; readonly data: { readonly message: string } }
                | {
                    readonly name: "StructuredOutputError"
                    readonly data: { readonly message: string; readonly retries: number }
                  }
                | {
                    readonly name: "ContextOverflowError"
                    readonly data: { readonly message: string; readonly responseBody?: string | undefined }
                  }
                | { readonly name: "ContentFilterError"; readonly data: { readonly message: string } }
                | {
                    readonly name: "APIError"
                    readonly data: {
                      readonly message: string
                      readonly statusCode?: number | undefined
                      readonly isRetryable: boolean
                      readonly responseHeaders?: { readonly [x: string]: string } | undefined
                      readonly responseBody?: string | undefined
                      readonly metadata?: { readonly [x: string]: string } | undefined
                    }
                  }
                | undefined
              readonly parentID: string
              readonly modelID: string
              readonly providerID: string
              readonly mode: string
              readonly agent: string
              readonly path: { readonly cwd: string; readonly root: string }
              readonly summary?: boolean | undefined
              readonly cost: number
              readonly tokens: {
                readonly total?: number | undefined
                readonly input: number
                readonly output: number
                readonly reasoning: number
                readonly cache: { readonly read: number; readonly write: number }
              }
              readonly structured?: any | undefined
              readonly variant?: string | undefined
              readonly finish?: string | undefined
            }
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "message.removed"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly sessionID: string; readonly messageID: string }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "message.part.updated"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly part:
          | {
              readonly id: string
              readonly sessionID: string
              readonly messageID: string
              readonly type: "text"
              readonly text: string
              readonly synthetic?: boolean | undefined
              readonly ignored?: boolean | undefined
              readonly time?: { readonly start: number; readonly end?: number | undefined } | undefined
              readonly metadata?: { readonly [x: string]: any } | undefined
            }
          | {
              readonly id: string
              readonly sessionID: string
              readonly messageID: string
              readonly type: "subtask"
              readonly prompt: string
              readonly description: string
              readonly agent: string
              readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
              readonly command?: string | undefined
            }
          | {
              readonly id: string
              readonly sessionID: string
              readonly messageID: string
              readonly type: "reasoning"
              readonly text: string
              readonly metadata?: { readonly [x: string]: any } | undefined
              readonly time: { readonly start: number; readonly end?: number | undefined }
            }
          | {
              readonly id: string
              readonly sessionID: string
              readonly messageID: string
              readonly type: "file"
              readonly mime: string
              readonly filename?: string | undefined
              readonly url: string
              readonly source?:
                | (
                    | {
                        readonly text: { readonly value: string; readonly start: number; readonly end: number }
                        readonly type: "file"
                        readonly path: string
                      }
                    | {
                        readonly text: { readonly value: string; readonly start: number; readonly end: number }
                        readonly type: "symbol"
                        readonly path: string
                        readonly range: {
                          readonly start: { readonly line: number; readonly character: number }
                          readonly end: { readonly line: number; readonly character: number }
                        }
                        readonly name: string
                        readonly kind: number
                      }
                    | {
                        readonly text: { readonly value: string; readonly start: number; readonly end: number }
                        readonly type: "resource"
                        readonly clientName: string
                        readonly uri: string
                      }
                  )
                | undefined
            }
          | {
              readonly id: string
              readonly sessionID: string
              readonly messageID: string
              readonly type: "tool"
              readonly callID: string
              readonly tool: string
              readonly state:
                | { readonly status: "pending"; readonly input: { readonly [x: string]: any }; readonly raw: string }
                | {
                    readonly status: "running"
                    readonly input: { readonly [x: string]: any }
                    readonly title?: string | undefined
                    readonly metadata?: { readonly [x: string]: any } | undefined
                    readonly time: { readonly start: number }
                  }
                | {
                    readonly status: "completed"
                    readonly input: { readonly [x: string]: any }
                    readonly output: string
                    readonly title: string
                    readonly metadata: { readonly [x: string]: any }
                    readonly time: {
                      readonly start: number
                      readonly end: number
                      readonly compacted?: number | undefined
                    }
                    readonly attachments?:
                      | ReadonlyArray<{
                          readonly id: string
                          readonly sessionID: string
                          readonly messageID: string
                          readonly type: "file"
                          readonly mime: string
                          readonly filename?: string | undefined
                          readonly url: string
                          readonly source?:
                            | (
                                | {
                                    readonly text: {
                                      readonly value: string
                                      readonly start: number
                                      readonly end: number
                                    }
                                    readonly type: "file"
                                    readonly path: string
                                  }
                                | {
                                    readonly text: {
                                      readonly value: string
                                      readonly start: number
                                      readonly end: number
                                    }
                                    readonly type: "symbol"
                                    readonly path: string
                                    readonly range: {
                                      readonly start: { readonly line: number; readonly character: number }
                                      readonly end: { readonly line: number; readonly character: number }
                                    }
                                    readonly name: string
                                    readonly kind: number
                                  }
                                | {
                                    readonly text: {
                                      readonly value: string
                                      readonly start: number
                                      readonly end: number
                                    }
                                    readonly type: "resource"
                                    readonly clientName: string
                                    readonly uri: string
                                  }
                              )
                            | undefined
                        }>
                      | undefined
                  }
                | {
                    readonly status: "error"
                    readonly input: { readonly [x: string]: any }
                    readonly error: string
                    readonly metadata?: { readonly [x: string]: any } | undefined
                    readonly time: { readonly start: number; readonly end: number }
                  }
              readonly metadata?: { readonly [x: string]: any } | undefined
            }
          | {
              readonly id: string
              readonly sessionID: string
              readonly messageID: string
              readonly type: "step-start"
              readonly snapshot?: string | undefined
            }
          | {
              readonly id: string
              readonly sessionID: string
              readonly messageID: string
              readonly type: "step-finish"
              readonly reason: string
              readonly snapshot?: string | undefined
              readonly cost: number
              readonly tokens: {
                readonly total?: number | undefined
                readonly input: number
                readonly output: number
                readonly reasoning: number
                readonly cache: { readonly read: number; readonly write: number }
              }
            }
          | {
              readonly id: string
              readonly sessionID: string
              readonly messageID: string
              readonly type: "snapshot"
              readonly snapshot: string
            }
          | {
              readonly id: string
              readonly sessionID: string
              readonly messageID: string
              readonly type: "patch"
              readonly hash: string
              readonly files: ReadonlyArray<string>
            }
          | {
              readonly id: string
              readonly sessionID: string
              readonly messageID: string
              readonly type: "agent"
              readonly name: string
              readonly source?: { readonly value: string; readonly start: number; readonly end: number } | undefined
            }
          | {
              readonly id: string
              readonly sessionID: string
              readonly messageID: string
              readonly type: "retry"
              readonly attempt: number
              readonly error: {
                readonly name: "APIError"
                readonly data: {
                  readonly message: string
                  readonly statusCode?: number | undefined
                  readonly isRetryable: boolean
                  readonly responseHeaders?: { readonly [x: string]: string } | undefined
                  readonly responseBody?: string | undefined
                  readonly metadata?: { readonly [x: string]: string } | undefined
                }
              }
              readonly time: { readonly created: number }
            }
          | {
              readonly id: string
              readonly sessionID: string
              readonly messageID: string
              readonly type: "compaction"
              readonly auto: boolean
              readonly overflow?: boolean | undefined
              readonly tail_start_id?: string | undefined
            }
        readonly time: number
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "message.part.removed"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly sessionID: string; readonly messageID: string; readonly partID: string }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.agent.selected"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly sessionID: string; readonly agent: string }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.model.selected"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.moved"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly location: { readonly directory: string; readonly workspaceID?: string }
        readonly subpath?: string
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.renamed"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly sessionID: string; readonly title: string }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.deleted"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly sessionID: string }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.forked"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly sessionID: string; readonly parentID: string; readonly from?: string }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.prompt.promoted"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly sessionID: string; readonly inputID: string }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.prompt.admitted"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly inputID: string
        readonly prompt: {
          readonly text: string
          readonly files?: ReadonlyArray<{
            readonly data: string
            readonly mime: string
            readonly source: { readonly type: "inline" } | { readonly type: "uri"; readonly uri: string }
            readonly name?: string
            readonly description?: string
            readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
          }>
          readonly agents?: ReadonlyArray<{
            readonly name: string
            readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
          }>
        }
        readonly delivery: "steer" | "queue"
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.execution.started"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly sessionID: string }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.execution.succeeded"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly sessionID: string }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.execution.failed"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly sessionID: string; readonly error: { readonly type: string; readonly message: string } }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.execution.interrupted"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly sessionID: string; readonly reason: "user" | "shutdown" | "superseded" }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.instructions.updated"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly sessionID: string; readonly text: string }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.synthetic"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly text: string
        readonly description?: string
        readonly metadata?: { readonly [x: string]: unknown }
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.skill.activated"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly sessionID: string; readonly name: string; readonly text: string }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.shell.started"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly shell: {
          readonly id: string
          readonly status: "running" | "exited" | "timeout" | "killed"
          readonly command: string
          readonly cwd: string
          readonly shell: string
          readonly file: string
          readonly pid?: number
          readonly exit?: number
          readonly metadata: { readonly [x: string]: unknown }
          readonly time: { readonly started: number; readonly completed?: number }
        }
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.shell.ended"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly shell: {
          readonly id: string
          readonly status: "running" | "exited" | "timeout" | "killed"
          readonly command: string
          readonly cwd: string
          readonly shell: string
          readonly file: string
          readonly pid?: number
          readonly exit?: number
          readonly metadata: { readonly [x: string]: unknown }
          readonly time: { readonly started: number; readonly completed?: number }
        }
        readonly output: {
          readonly output: string
          readonly cursor: number
          readonly size: number
          readonly truncated: boolean
        }
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.step.started"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly agent: string
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly snapshot?: string
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.step.ended"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly finish: "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown"
        readonly cost: number
        readonly tokens: {
          readonly input: number
          readonly output: number
          readonly reasoning: number
          readonly cache: { readonly read: number; readonly write: number }
        }
        readonly snapshot?: string
        readonly files?: ReadonlyArray<string>
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.step.failed"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly error: { readonly type: string; readonly message: string }
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.text.started"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly sessionID: string; readonly assistantMessageID: string; readonly ordinal: number }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.text.delta"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly ordinal: number
        readonly delta: string
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.text.ended"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly ordinal: number
        readonly text: string
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.reasoning.started"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly ordinal: number
        readonly state?: { readonly [x: string]: unknown }
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.reasoning.delta"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly ordinal: number
        readonly delta: string
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.reasoning.ended"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly ordinal: number
        readonly text: string
        readonly state?: { readonly [x: string]: unknown }
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.tool.input.started"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly callID: string
        readonly name: string
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.tool.input.delta"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly callID: string
        readonly delta: string
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.tool.input.ended"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly callID: string
        readonly text: string
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.tool.called"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly callID: string
        readonly input: { readonly [x: string]: unknown }
        readonly executed: boolean
        readonly state?: { readonly [x: string]: unknown }
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.tool.progress"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly callID: string
        readonly structured: { readonly [x: string]: unknown }
        readonly content: ReadonlyArray<
          | { readonly type: "text"; readonly text: string }
          | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
        >
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.tool.success"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly callID: string
        readonly structured: { readonly [x: string]: unknown }
        readonly content: ReadonlyArray<
          | { readonly type: "text"; readonly text: string }
          | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
        >
        readonly outputPaths?: ReadonlyArray<string>
        readonly result?: unknown
        readonly executed: boolean
        readonly resultState?: { readonly [x: string]: unknown }
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.tool.failed"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly callID: string
        readonly error: { readonly type: string; readonly message: string }
        readonly result?: unknown
        readonly executed: boolean
        readonly resultState?: { readonly [x: string]: unknown }
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.retry.scheduled"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly attempt: number
        readonly at: number
        readonly error: { readonly type: string; readonly message: string }
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.compaction.admitted"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly sessionID: string; readonly inputID: string }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.compaction.started"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly sessionID: string; readonly reason: "auto" | "manual" }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.compaction.delta"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly sessionID: string; readonly text: string }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.compaction.ended"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly reason: "auto" | "manual"
        readonly text: string
        readonly recent: string
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.compaction.failed"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly sessionID: string }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.revert.staged"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly revert: {
          readonly messageID: string
          readonly partID?: string
          readonly snapshot?: string
          readonly diff?: string
          readonly files?: ReadonlyArray<{
            readonly path: string
            readonly status: "added" | "modified" | "deleted"
            readonly additions: number
            readonly deletions: number
            readonly patch: string
          }>
        }
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.revert.cleared"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly sessionID: string }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.revert.committed"
      readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly sessionID: string; readonly to: string }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "filesystem.changed"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly file: string; readonly event: "add" | "change" | "unlink" }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "reference.updated"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {}
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "permission.v2.asked"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly id: string
        readonly sessionID: string
        readonly action: string
        readonly resources: ReadonlyArray<string>
        readonly save?: ReadonlyArray<string>
        readonly metadata?: { readonly [x: string]: unknown }
        readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "permission.v2.replied"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly requestID: string
        readonly reply: "once" | "always" | "reject"
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "plugin.added"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly id: string }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "plugin.updated"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {}
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "project.directories.updated"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly projectID: string }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "command.updated"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {}
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "config.updated"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {}
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "skill.updated"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {}
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "pty.created"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly info: {
          readonly id: string
          readonly title: string
          readonly command: string
          readonly args: ReadonlyArray<string>
          readonly cwd: string
          readonly status: "running" | "exited"
          readonly pid: number
          readonly exitCode?: number
        }
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "pty.updated"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly info: {
          readonly id: string
          readonly title: string
          readonly command: string
          readonly args: ReadonlyArray<string>
          readonly cwd: string
          readonly status: "running" | "exited"
          readonly pid: number
          readonly exitCode?: number
        }
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "pty.exited"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly id: string; readonly exitCode: number }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "pty.deleted"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly id: string }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "shell.created"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly info: {
          readonly id: string
          readonly status: "running" | "exited" | "timeout" | "killed"
          readonly command: string
          readonly cwd: string
          readonly shell: string
          readonly file: string
          readonly pid?: number
          readonly exit?: number
          readonly metadata: { readonly [x: string]: unknown }
          readonly time: { readonly started: number; readonly completed?: number }
        }
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "shell.exited"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly id: string
        readonly exit?: number
        readonly status: "running" | "exited" | "timeout" | "killed"
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "shell.deleted"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly id: string }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "question.v2.asked"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly id: string
        readonly sessionID: string
        readonly questions: ReadonlyArray<{
          readonly question: string
          readonly header: string
          readonly options: ReadonlyArray<{ readonly label: string; readonly description: string }>
          readonly multiple?: boolean
          readonly custom?: boolean
        }>
        readonly tool?: { readonly messageID: string; readonly callID: string }
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "question.v2.replied"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly requestID: string
        readonly answers: ReadonlyArray<ReadonlyArray<string>>
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "question.v2.rejected"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly sessionID: string; readonly requestID: string }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "form.created"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly form:
          | {
              readonly id: string
              readonly sessionID: string
              readonly title?: string
              readonly metadata?: { readonly [x: string]: unknown }
              readonly mode: "form"
              readonly fields: ReadonlyArray<
                | {
                    readonly key: string
                    readonly title?: string
                    readonly description?: string
                    readonly required?: boolean
                    readonly when?: ReadonlyArray<{
                      readonly key: string
                      readonly op: "eq" | "neq"
                      readonly value: string | number | boolean
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
                      readonly value: string | number | boolean
                    }>
                    readonly type: "number"
                    readonly minimum?: number
                    readonly maximum?: number
                    readonly default?: number
                  }
                | {
                    readonly key: string
                    readonly title?: string
                    readonly description?: string
                    readonly required?: boolean
                    readonly when?: ReadonlyArray<{
                      readonly key: string
                      readonly op: "eq" | "neq"
                      readonly value: string | number | boolean
                    }>
                    readonly type: "integer"
                    readonly minimum?: number
                    readonly maximum?: number
                    readonly default?: number
                  }
                | {
                    readonly key: string
                    readonly title?: string
                    readonly description?: string
                    readonly required?: boolean
                    readonly when?: ReadonlyArray<{
                      readonly key: string
                      readonly op: "eq" | "neq"
                      readonly value: string | number | boolean
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
                      readonly value: string | number | boolean
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
              >
            }
          | {
              readonly id: string
              readonly sessionID: string
              readonly title?: string
              readonly metadata?: { readonly [x: string]: unknown }
              readonly mode: "url"
              readonly url: string
            }
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "form.replied"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly id: string
        readonly sessionID: string
        readonly answer: { readonly [x: string]: string | number | boolean | ReadonlyArray<string> }
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "form.cancelled"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly id: string; readonly sessionID: string }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "todo.updated"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly todos: ReadonlyArray<{ readonly content: string; readonly status: string; readonly priority: string }>
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.status"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly status:
          | { readonly type: "idle" }
          | {
              readonly type: "retry"
              readonly attempt: number
              readonly message: string
              readonly action?: {
                readonly reason: string
                readonly provider: string
                readonly title: string
                readonly message: string
                readonly label: string
                readonly link?: string
              }
              readonly next: number
            }
          | { readonly type: "busy" }
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.idle"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly sessionID: string }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "tui.prompt.append"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly text: string }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "tui.command.execute"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly command:
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
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "tui.toast.show"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly title?: string
        readonly message: string
        readonly variant: "info" | "success" | "warning" | "error"
        readonly duration?: number | undefined
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "tui.session.select"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly sessionID: string }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "installation.updated"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly version: string }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "installation.update-available"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly version: string }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "vcs.branch.updated"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly branch?: string }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "mcp.status.changed"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly server: string }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "permission.asked"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly id: string
        readonly sessionID: string
        readonly permission: string
        readonly patterns: ReadonlyArray<string>
        readonly metadata: { readonly [x: string]: unknown }
        readonly always: ReadonlyArray<string>
        readonly tool?: { readonly messageID: string; readonly callID: string } | undefined
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "permission.replied"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly requestID: string
        readonly reply: "once" | "always" | "reject"
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "question.asked"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly id: string
        readonly sessionID: string
        readonly questions: ReadonlyArray<{
          readonly question: string
          readonly header: string
          readonly options: ReadonlyArray<{ readonly label: string; readonly description: string }>
          readonly multiple?: boolean | undefined
          readonly custom?: boolean | undefined
        }>
        readonly tool?: { readonly messageID: string; readonly callID: string } | undefined
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "question.replied"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID: string
        readonly requestID: string
        readonly answers: ReadonlyArray<ReadonlyArray<string>>
      }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "question.rejected"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly sessionID: string; readonly requestID: string }
    }
  | {
      readonly id: string
      readonly created: number
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.error"
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly sessionID?: string | undefined
        readonly error?:
          | {
              readonly name: "ProviderAuthError"
              readonly data: { readonly providerID: string; readonly message: string }
            }
          | {
              readonly name: "UnknownError"
              readonly data: { readonly message: string; readonly ref?: string | undefined }
            }
          | { readonly name: "MessageOutputLengthError"; readonly data: {} }
          | { readonly name: "MessageAbortedError"; readonly data: { readonly message: string } }
          | {
              readonly name: "StructuredOutputError"
              readonly data: { readonly message: string; readonly retries: number }
            }
          | {
              readonly name: "ContextOverflowError"
              readonly data: { readonly message: string; readonly responseBody?: string | undefined }
            }
          | { readonly name: "ContentFilterError"; readonly data: { readonly message: string } }
          | {
              readonly name: "APIError"
              readonly data: {
                readonly message: string
                readonly statusCode?: number | undefined
                readonly isRetryable: boolean
                readonly responseHeaders?: { readonly [x: string]: string } | undefined
                readonly responseBody?: string | undefined
                readonly metadata?: { readonly [x: string]: string } | undefined
              }
            }
          | undefined
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown } | undefined
      readonly location?: { readonly directory: string; readonly workspaceID?: string } | undefined
      readonly type: "server.connected"
      readonly data: {}
    }

export type PtyListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type PtyListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly title: string
    readonly command: string
    readonly args: ReadonlyArray<string>
    readonly cwd: string
    readonly status: "running" | "exited"
    readonly pid: number
    readonly exitCode?: number
  }>
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
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly id: string
    readonly title: string
    readonly command: string
    readonly args: ReadonlyArray<string>
    readonly cwd: string
    readonly status: "running" | "exited"
    readonly pid: number
    readonly exitCode?: number
  }
}

export type PtyGetInput = {
  readonly ptyID: { readonly ptyID: string }["ptyID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type PtyGetOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly id: string
    readonly title: string
    readonly command: string
    readonly args: ReadonlyArray<string>
    readonly cwd: string
    readonly status: "running" | "exited"
    readonly pid: number
    readonly exitCode?: number
  }
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
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly id: string
    readonly title: string
    readonly command: string
    readonly args: ReadonlyArray<string>
    readonly cwd: string
    readonly status: "running" | "exited"
    readonly pid: number
    readonly exitCode?: number
  }
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
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly status: "running" | "exited" | "timeout" | "killed"
    readonly command: string
    readonly cwd: string
    readonly shell: string
    readonly file: string
    readonly pid?: number
    readonly exit?: number | "Infinity" | "-Infinity" | "NaN"
    readonly metadata: { readonly [x: string]: JsonValue }
    readonly time: {
      readonly started: number | "Infinity" | "-Infinity" | "NaN"
      readonly completed?: number | "Infinity" | "-Infinity" | "NaN"
    }
  }>
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
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly id: string
    readonly status: "running" | "exited" | "timeout" | "killed"
    readonly command: string
    readonly cwd: string
    readonly shell: string
    readonly file: string
    readonly pid?: number
    readonly exit?: number | "Infinity" | "-Infinity" | "NaN"
    readonly metadata: { readonly [x: string]: JsonValue }
    readonly time: {
      readonly started: number | "Infinity" | "-Infinity" | "NaN"
      readonly completed?: number | "Infinity" | "-Infinity" | "NaN"
    }
  }
}

export type ShellGetInput = {
  readonly id: { readonly id: string }["id"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ShellGetOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly id: string
    readonly status: "running" | "exited" | "timeout" | "killed"
    readonly command: string
    readonly cwd: string
    readonly shell: string
    readonly file: string
    readonly pid?: number
    readonly exit?: number | "Infinity" | "-Infinity" | "NaN"
    readonly metadata: { readonly [x: string]: JsonValue }
    readonly time: {
      readonly started: number | "Infinity" | "-Infinity" | "NaN"
      readonly completed?: number | "Infinity" | "-Infinity" | "NaN"
    }
  }
}

export type ShellTimeoutInput = {
  readonly id: { readonly id: string }["id"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly timeout: { readonly timeout: number }["timeout"]
}

export type ShellTimeoutOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly id: string
    readonly status: "running" | "exited" | "timeout" | "killed"
    readonly command: string
    readonly cwd: string
    readonly shell: string
    readonly file: string
    readonly pid?: number
    readonly exit?: number | "Infinity" | "-Infinity" | "NaN"
    readonly metadata: { readonly [x: string]: JsonValue }
    readonly time: {
      readonly started: number | "Infinity" | "-Infinity" | "NaN"
      readonly completed?: number | "Infinity" | "-Infinity" | "NaN"
    }
  }
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
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly output: string
    readonly cursor: number
    readonly size: number
    readonly truncated: boolean
  }
}

export type ShellRemoveInput = {
  readonly id: { readonly id: string }["id"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ShellRemoveOutput = void

export type QuestionListRequestsInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type QuestionListRequestsOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly sessionID: string
    readonly questions: ReadonlyArray<{
      readonly question: string
      readonly header: string
      readonly options: ReadonlyArray<{ readonly label: string; readonly description: string }>
      readonly multiple?: boolean
      readonly custom?: boolean
    }>
    readonly tool?: { readonly messageID: string; readonly callID: string }
  }>
}

export type QuestionListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type QuestionListOutput = {
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly sessionID: string
    readonly questions: ReadonlyArray<{
      readonly question: string
      readonly header: string
      readonly options: ReadonlyArray<{ readonly label: string; readonly description: string }>
      readonly multiple?: boolean
      readonly custom?: boolean
    }>
    readonly tool?: { readonly messageID: string; readonly callID: string }
  }>
}["data"]

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
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly name: string
    readonly path: string
    readonly description?: string
    readonly hidden?: boolean
    readonly source:
      | { readonly type: "local"; readonly path: string; readonly description?: string; readonly hidden?: boolean }
      | {
          readonly type: "git"
          readonly repository: string
          readonly branch?: string
          readonly description?: string
          readonly hidden?: boolean
        }
  }>
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

export type ProjectCopyCreateOutput = { readonly directory: string }

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
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly file: string
    readonly additions: number
    readonly deletions: number
    readonly status: "added" | "deleted" | "modified"
  }>
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
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly file?: string
    readonly patch?: string
    readonly additions: number
    readonly deletions: number
    readonly status?: "added" | "deleted" | "modified"
  }>
}

export type DebugLocationOutput = ReadonlyArray<{ readonly directory: string; readonly workspaceID?: string }>

export type DebugEvictLocationInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type DebugEvictLocationOutput = void
