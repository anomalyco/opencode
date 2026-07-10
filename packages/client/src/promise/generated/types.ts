export type JsonValue = null | boolean | number | string | Array<JsonValue> | { [key: string]: JsonValue }

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

export type HealthGetOutput = { healthy: true; version: string; pid: number }

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
  data: Array<{
    id: string
    name: string
    model?: { id: string; providerID: string; variant?: string }
    request: {
      settings: { [x: string]: JsonValue }
      headers: { [x: string]: string }
      body: { [x: string]: JsonValue }
    }
    system?: string
    description?: string
    mode: "subagent" | "primary" | "all"
    hidden: boolean
    color?: string | "primary" | "secondary" | "accent" | "success" | "warning" | "error" | "info"
    steps?: number
    permissions: Array<{ action: string; resource: string; effect: "allow" | "deny" | "ask" }>
  }>
}

export type PluginListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type PluginListOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Array<{ id: string }>
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
  data: Array<{
    id: string
    parentID?: string
    fork?: { sessionID: string; messageID?: string }
    projectID: string
    agent?: string
    model?: { id: string; providerID: string; variant?: string }
    cost: number
    tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
    time: { created: number; updated: number; archived?: number }
    title: string
    location: { directory: string; workspaceID?: string }
    subpath?: string
    revert?: {
      messageID: string
      partID?: string
      snapshot?: string
      files?: Array<{
        file: string
        patch: string
        additions: number
        deletions: number
        status: "added" | "deleted" | "modified"
      }>
    }
  }>
  cursor: { previous?: string | null; next?: string | null }
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
  data: {
    id: string
    parentID?: string
    fork?: { sessionID: string; messageID?: string }
    projectID: string
    agent?: string
    model?: { id: string; providerID: string; variant?: string }
    cost: number
    tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
    time: { created: number; updated: number; archived?: number }
    title: string
    location: { directory: string; workspaceID?: string }
    subpath?: string
    revert?: {
      messageID: string
      partID?: string
      snapshot?: string
      files?: Array<{
        file: string
        patch: string
        additions: number
        deletions: number
        status: "added" | "deleted" | "modified"
      }>
    }
  }
}["data"]

export type SessionActiveOutput = { data: { [x: string]: { type: "running" } } }["data"]

export type SessionGetInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionGetOutput = {
  data: {
    id: string
    parentID?: string
    fork?: { sessionID: string; messageID?: string }
    projectID: string
    agent?: string
    model?: { id: string; providerID: string; variant?: string }
    cost: number
    tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
    time: { created: number; updated: number; archived?: number }
    title: string
    location: { directory: string; workspaceID?: string }
    subpath?: string
    revert?: {
      messageID: string
      partID?: string
      snapshot?: string
      files?: Array<{
        file: string
        patch: string
        additions: number
        deletions: number
        status: "added" | "deleted" | "modified"
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
  data: {
    id: string
    parentID?: string
    fork?: { sessionID: string; messageID?: string }
    projectID: string
    agent?: string
    model?: { id: string; providerID: string; variant?: string }
    cost: number
    tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
    time: { created: number; updated: number; archived?: number }
    title: string
    location: { directory: string; workspaceID?: string }
    subpath?: string
    revert?: {
      messageID: string
      partID?: string
      snapshot?: string
      files?: Array<{
        file: string
        patch: string
        additions: number
        deletions: number
        status: "added" | "deleted" | "modified"
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

export type SessionPromptOutput = {
  data: {
    admittedSeq: number
    id: string
    sessionID: string
    timeCreated: number
    type: "user"
    data: {
      text: string
      files?: Array<{
        data: string
        mime: string
        source: { type: "inline" } | { type: "uri"; uri: string }
        name?: string
        description?: string
        mention?: { start: number; end: number; text: string }
      }>
      agents?: Array<{ name: string; mention?: { start: number; end: number; text: string } }>
      metadata?: { [x: string]: JsonValue }
    }
    delivery: "steer" | "queue"
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
  data: {
    admittedSeq: number
    id: string
    sessionID: string
    timeCreated: number
    type: "user"
    data: {
      text: string
      files?: Array<{
        data: string
        mime: string
        source: { type: "inline" } | { type: "uri"; uri: string }
        name?: string
        description?: string
        mention?: { start: number; end: number; text: string }
      }>
      agents?: Array<{ name: string; mention?: { start: number; end: number; text: string } }>
      metadata?: { [x: string]: JsonValue }
    }
    delivery: "steer" | "queue"
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

export type SessionSyntheticOutput = {
  data: {
    admittedSeq: number
    id: string
    sessionID: string
    timeCreated: number
    type: "synthetic"
    data: { text: string; description?: string; metadata?: { [x: string]: JsonValue } }
    delivery: "steer" | "queue"
  }
}["data"]

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
  data: { admittedSeq: number; id: string; sessionID: string; timeCreated: number; type: "compaction" }
}["data"]

export type SessionWaitInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionWaitOutput = void

export type SessionRevertStageInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly messageID: { readonly messageID: string; readonly files?: boolean | undefined }["messageID"]
  readonly files?: { readonly messageID: string; readonly files?: boolean | undefined }["files"]
}

export type SessionRevertStageOutput = {
  data: {
    messageID: string
    partID?: string
    snapshot?: string
    files?: Array<{
      file: string
      patch: string
      additions: number
      deletions: number
      status: "added" | "deleted" | "modified"
    }>
  }
}["data"]

export type SessionRevertClearInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionRevertClearOutput = void

export type SessionRevertCommitInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionRevertCommitOutput = void

export type SessionContextInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionContextOutput = {
  data: Array<
    | {
        id: string
        metadata?: { [x: string]: JsonValue }
        time: { created: number }
        type: "agent-switched"
        agent: string
      }
    | {
        id: string
        metadata?: { [x: string]: JsonValue }
        time: { created: number }
        type: "model-switched"
        model: { id: string; providerID: string; variant?: string }
        previous?: { id: string; providerID: string; variant?: string }
      }
    | {
        id: string
        metadata?: { [x: string]: JsonValue }
        time: { created: number }
        text: string
        files?: Array<{
          data: string
          mime: string
          source: { type: "inline" } | { type: "uri"; uri: string }
          name?: string
          description?: string
          mention?: { start: number; end: number; text: string }
        }>
        agents?: Array<{ name: string; mention?: { start: number; end: number; text: string } }>
        type: "user"
      }
    | {
        id: string
        metadata?: { [x: string]: JsonValue }
        time: { created: number }
        text: string
        description?: string
        type: "synthetic"
      }
    | { id: string; metadata?: { [x: string]: JsonValue }; time: { created: number }; type: "system"; text: string }
    | {
        id: string
        metadata?: { [x: string]: JsonValue }
        time: { created: number }
        type: "skill"
        skill: string
        name: string
        text: string
      }
    | {
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
    | {
        id: string
        metadata?: { [x: string]: JsonValue }
        time: { created: number; completed?: number }
        type: "assistant"
        agent: string
        model: { id: string; providerID: string; variant?: string }
        content: Array<
          | { type: "text"; text: string }
          | {
              type: "reasoning"
              text: string
              state?: { [x: string]: JsonValue }
              time?: { created: number; completed?: number }
            }
          | {
              type: "tool"
              id: string
              name: string
              executed?: boolean
              providerState?: { [x: string]: JsonValue }
              providerResultState?: { [x: string]: JsonValue }
              state:
                | { status: "streaming"; input: string }
                | {
                    status: "running"
                    input: { [x: string]: JsonValue }
                    structured: { [x: string]: JsonValue }
                    content: Array<
                      { type: "text"; text: string } | { type: "file"; uri: string; mime: string; name?: string }
                    >
                  }
                | {
                    status: "completed"
                    input: { [x: string]: JsonValue }
                    content: Array<
                      { type: "text"; text: string } | { type: "file"; uri: string; mime: string; name?: string }
                    >
                    structured: { [x: string]: JsonValue }
                    result?: JsonValue
                  }
                | {
                    status: "error"
                    input: { [x: string]: JsonValue }
                    content: Array<
                      { type: "text"; text: string } | { type: "file"; uri: string; mime: string; name?: string }
                    >
                    structured: { [x: string]: JsonValue }
                    error: { type: string; message: string }
                    result?: JsonValue
                  }
              time: { created: number; ran?: number; completed?: number }
            }
        >
        snapshot?: { start?: string; end?: string; files?: Array<string> }
        finish?: "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown"
        cost?: number
        tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
        error?: { type: string; message: string }
        retry?: { attempt: number; at: number; error: { type: string; message: string } }
      }
    | (
        | {
            type: "compaction"
            id: string
            metadata?: { [x: string]: JsonValue }
            time: { created: number }
            status: "running"
            reason: "auto" | "manual"
            summary: string
            recent: string
          }
        | {
            type: "compaction"
            id: string
            metadata?: { [x: string]: JsonValue }
            time: { created: number }
            status: "completed"
            reason: "auto" | "manual"
            summary: string
            recent: string
          }
        | {
            type: "compaction"
            id: string
            metadata?: { [x: string]: JsonValue }
            time: { created: number }
            status: "failed"
            reason: "auto" | "manual"
            error: { type: string; message: string }
          }
      )
  >
}["data"]

export type SessionPendingListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionPendingListOutput = {
  data: Array<
    | {
        admittedSeq: number
        id: string
        sessionID: string
        timeCreated: number
        type: "user"
        data: {
          text: string
          files?: Array<{
            data: string
            mime: string
            source: { type: "inline" } | { type: "uri"; uri: string }
            name?: string
            description?: string
            mention?: { start: number; end: number; text: string }
          }>
          agents?: Array<{ name: string; mention?: { start: number; end: number; text: string } }>
          metadata?: { [x: string]: JsonValue }
        }
        delivery: "steer" | "queue"
      }
    | {
        admittedSeq: number
        id: string
        sessionID: string
        timeCreated: number
        type: "synthetic"
        data: { text: string; description?: string; metadata?: { [x: string]: JsonValue } }
        delivery: "steer" | "queue"
      }
    | { admittedSeq: number; id: string; sessionID: string; timeCreated: number; type: "compaction" }
  >
}["data"]

export type SessionInstructionsEntryListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionInstructionsEntryListOutput = { data: Array<{ key: string; value: JsonValue }> }["data"]

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
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.agent.selected"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: { sessionID: string; agent: string }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.model.selected"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: { sessionID: string; model: { id: string; providerID: string; variant?: string } }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.moved"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: { sessionID: string; location: { directory: string; workspaceID?: string }; subpath?: string }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.renamed"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: { sessionID: string; title: string }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.deleted"
          durable: { aggregateID: string; seq: number; version: 2 }
          location?: { directory: string; workspaceID?: string }
          data: { sessionID: string }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.forked"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: { sessionID: string; parentID: string; from?: string }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.input.promoted"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: { sessionID: string; inputID: string }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.input.admitted"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: {
            sessionID: string
            inputID: string
            input:
              | {
                  type: "user"
                  data: {
                    text: string
                    files?: Array<{
                      data: string
                      mime: string
                      source: { type: "inline" } | { type: "uri"; uri: string }
                      name?: string
                      description?: string
                      mention?: { start: number; end: number; text: string }
                    }>
                    agents?: Array<{ name: string; mention?: { start: number; end: number; text: string } }>
                    metadata?: { [x: string]: unknown }
                  }
                  delivery: "steer" | "queue"
                }
              | {
                  type: "synthetic"
                  data: { text: string; description?: string; metadata?: { [x: string]: unknown } }
                  delivery: "steer" | "queue"
                }
          }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.execution.started"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: { sessionID: string }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.execution.succeeded"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: { sessionID: string }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.execution.failed"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: { sessionID: string; error: { type: string; message: string } }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.execution.interrupted"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: { sessionID: string; reason: "user" | "shutdown" | "superseded" }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.instructions.updated"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: { sessionID: string; text: string }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.synthetic"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: { sessionID: string; text: string; description?: string; metadata?: { [x: string]: unknown } }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.skill.activated"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: { sessionID: string; id: string; name: string; text: string }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.shell.started"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: {
            sessionID: string
            shell: {
              id: string
              status: "running" | "exited" | "timeout" | "killed"
              command: string
              cwd: string
              shell: string
              file: string
              pid?: number
              exit?: number
              metadata: { [x: string]: unknown }
              time: { started: number; completed?: number }
            }
          }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.shell.ended"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: {
            sessionID: string
            shell: {
              id: string
              status: "running" | "exited" | "timeout" | "killed"
              command: string
              cwd: string
              shell: string
              file: string
              pid?: number
              exit?: number
              metadata: { [x: string]: unknown }
              time: { started: number; completed?: number }
            }
            output: { output: string; cursor: number; size: number; truncated: boolean }
          }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.step.started"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: {
            sessionID: string
            assistantMessageID: string
            agent: string
            model: { id: string; providerID: string; variant?: string }
            snapshot?: string
          }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.step.ended"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: {
            sessionID: string
            assistantMessageID: string
            finish: "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown"
            cost: number
            tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
            snapshot?: string
            files?: Array<string>
          }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.step.failed"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: {
            sessionID: string
            assistantMessageID: string
            error: { type: string; message: string }
            cost?: number
            tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
          }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.text.started"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: { sessionID: string; assistantMessageID: string; ordinal: number }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.text.ended"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: { sessionID: string; assistantMessageID: string; ordinal: number; text: string }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.reasoning.started"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: { sessionID: string; assistantMessageID: string; ordinal: number; state?: { [x: string]: unknown } }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.reasoning.ended"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: {
            sessionID: string
            assistantMessageID: string
            ordinal: number
            text: string
            state?: { [x: string]: unknown }
          }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.tool.input.started"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: { sessionID: string; assistantMessageID: string; callID: string; name: string }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.tool.input.ended"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: { sessionID: string; assistantMessageID: string; callID: string; text: string }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.tool.called"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: {
            sessionID: string
            assistantMessageID: string
            callID: string
            input: { [x: string]: unknown }
            executed: boolean
            state?: { [x: string]: unknown }
          }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.tool.progress"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: {
            sessionID: string
            assistantMessageID: string
            callID: string
            structured: { [x: string]: unknown }
            content: Array<{ type: "text"; text: string } | { type: "file"; uri: string; mime: string; name?: string }>
          }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.tool.success"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: {
            sessionID: string
            assistantMessageID: string
            callID: string
            structured: { [x: string]: unknown }
            content: Array<{ type: "text"; text: string } | { type: "file"; uri: string; mime: string; name?: string }>
            result?: unknown
            executed: boolean
            resultState?: { [x: string]: unknown }
          }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.tool.failed"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: {
            sessionID: string
            assistantMessageID: string
            callID: string
            error: { type: string; message: string }
            result?: unknown
            executed: boolean
            resultState?: { [x: string]: unknown }
          }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.retry.scheduled"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: {
            sessionID: string
            assistantMessageID: string
            attempt: number
            at: number
            error: { type: string; message: string }
          }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.compaction.admitted"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: { sessionID: string; inputID: string }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.compaction.started"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: { sessionID: string; reason: "auto" | "manual"; recent: string; inputID?: string }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.compaction.ended"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: { sessionID: string; reason: "auto" | "manual"; text: string; recent: string }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.compaction.failed"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: {
            sessionID: string
            reason: "auto" | "manual"
            error: { type: string; message: string }
            inputID?: string
          }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.revert.staged"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: {
            sessionID: string
            revert: {
              messageID: string
              partID?: string
              snapshot?: string
              files?: Array<{
                file: string
                patch: string
                additions: number
                deletions: number
                status: "added" | "deleted" | "modified"
              }>
            }
          }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.revert.cleared"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: { sessionID: string }
        }
      | {
          id: string
          created: number
          metadata?: { [x: string]: unknown }
          type: "session.revert.committed"
          durable: { aggregateID: string; seq: number; version: 1 }
          location?: { directory: string; workspaceID?: string }
          data: { sessionID: string; to: string }
        }
    )
  | { type: "log.synced"; aggregateID: string; seq?: number }

export type SessionInterruptInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionInterruptOutput = void

export type SessionBackgroundInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionBackgroundOutput = void

export type SessionMessageInput = {
  readonly sessionID: { readonly sessionID: string; readonly messageID: string }["sessionID"]
  readonly messageID: { readonly sessionID: string; readonly messageID: string }["messageID"]
}

export type SessionMessageOutput = {
  data:
    | {
        id: string
        metadata?: { [x: string]: JsonValue }
        time: { created: number }
        type: "agent-switched"
        agent: string
      }
    | {
        id: string
        metadata?: { [x: string]: JsonValue }
        time: { created: number }
        type: "model-switched"
        model: { id: string; providerID: string; variant?: string }
        previous?: { id: string; providerID: string; variant?: string }
      }
    | {
        id: string
        metadata?: { [x: string]: JsonValue }
        time: { created: number }
        text: string
        files?: Array<{
          data: string
          mime: string
          source: { type: "inline" } | { type: "uri"; uri: string }
          name?: string
          description?: string
          mention?: { start: number; end: number; text: string }
        }>
        agents?: Array<{ name: string; mention?: { start: number; end: number; text: string } }>
        type: "user"
      }
    | {
        id: string
        metadata?: { [x: string]: JsonValue }
        time: { created: number }
        text: string
        description?: string
        type: "synthetic"
      }
    | { id: string; metadata?: { [x: string]: JsonValue }; time: { created: number }; type: "system"; text: string }
    | {
        id: string
        metadata?: { [x: string]: JsonValue }
        time: { created: number }
        type: "skill"
        skill: string
        name: string
        text: string
      }
    | {
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
    | {
        id: string
        metadata?: { [x: string]: JsonValue }
        time: { created: number; completed?: number }
        type: "assistant"
        agent: string
        model: { id: string; providerID: string; variant?: string }
        content: Array<
          | { type: "text"; text: string }
          | {
              type: "reasoning"
              text: string
              state?: { [x: string]: JsonValue }
              time?: { created: number; completed?: number }
            }
          | {
              type: "tool"
              id: string
              name: string
              executed?: boolean
              providerState?: { [x: string]: JsonValue }
              providerResultState?: { [x: string]: JsonValue }
              state:
                | { status: "streaming"; input: string }
                | {
                    status: "running"
                    input: { [x: string]: JsonValue }
                    structured: { [x: string]: JsonValue }
                    content: Array<
                      { type: "text"; text: string } | { type: "file"; uri: string; mime: string; name?: string }
                    >
                  }
                | {
                    status: "completed"
                    input: { [x: string]: JsonValue }
                    content: Array<
                      { type: "text"; text: string } | { type: "file"; uri: string; mime: string; name?: string }
                    >
                    structured: { [x: string]: JsonValue }
                    result?: JsonValue
                  }
                | {
                    status: "error"
                    input: { [x: string]: JsonValue }
                    content: Array<
                      { type: "text"; text: string } | { type: "file"; uri: string; mime: string; name?: string }
                    >
                    structured: { [x: string]: JsonValue }
                    error: { type: string; message: string }
                    result?: JsonValue
                  }
              time: { created: number; ran?: number; completed?: number }
            }
        >
        snapshot?: { start?: string; end?: string; files?: Array<string> }
        finish?: "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown"
        cost?: number
        tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
        error?: { type: string; message: string }
        retry?: { attempt: number; at: number; error: { type: string; message: string } }
      }
    | (
        | {
            type: "compaction"
            id: string
            metadata?: { [x: string]: JsonValue }
            time: { created: number }
            status: "running"
            reason: "auto" | "manual"
            summary: string
            recent: string
          }
        | {
            type: "compaction"
            id: string
            metadata?: { [x: string]: JsonValue }
            time: { created: number }
            status: "completed"
            reason: "auto" | "manual"
            summary: string
            recent: string
          }
        | {
            type: "compaction"
            id: string
            metadata?: { [x: string]: JsonValue }
            time: { created: number }
            status: "failed"
            reason: "auto" | "manual"
            error: { type: string; message: string }
          }
      )
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
  data: Array<
    | {
        id: string
        metadata?: { [x: string]: JsonValue }
        time: { created: number }
        type: "agent-switched"
        agent: string
      }
    | {
        id: string
        metadata?: { [x: string]: JsonValue }
        time: { created: number }
        type: "model-switched"
        model: { id: string; providerID: string; variant?: string }
        previous?: { id: string; providerID: string; variant?: string }
      }
    | {
        id: string
        metadata?: { [x: string]: JsonValue }
        time: { created: number }
        text: string
        files?: Array<{
          data: string
          mime: string
          source: { type: "inline" } | { type: "uri"; uri: string }
          name?: string
          description?: string
          mention?: { start: number; end: number; text: string }
        }>
        agents?: Array<{ name: string; mention?: { start: number; end: number; text: string } }>
        type: "user"
      }
    | {
        id: string
        metadata?: { [x: string]: JsonValue }
        time: { created: number }
        text: string
        description?: string
        type: "synthetic"
      }
    | { id: string; metadata?: { [x: string]: JsonValue }; time: { created: number }; type: "system"; text: string }
    | {
        id: string
        metadata?: { [x: string]: JsonValue }
        time: { created: number }
        type: "skill"
        skill: string
        name: string
        text: string
      }
    | {
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
    | {
        id: string
        metadata?: { [x: string]: JsonValue }
        time: { created: number; completed?: number }
        type: "assistant"
        agent: string
        model: { id: string; providerID: string; variant?: string }
        content: Array<
          | { type: "text"; text: string }
          | {
              type: "reasoning"
              text: string
              state?: { [x: string]: JsonValue }
              time?: { created: number; completed?: number }
            }
          | {
              type: "tool"
              id: string
              name: string
              executed?: boolean
              providerState?: { [x: string]: JsonValue }
              providerResultState?: { [x: string]: JsonValue }
              state:
                | { status: "streaming"; input: string }
                | {
                    status: "running"
                    input: { [x: string]: JsonValue }
                    structured: { [x: string]: JsonValue }
                    content: Array<
                      { type: "text"; text: string } | { type: "file"; uri: string; mime: string; name?: string }
                    >
                  }
                | {
                    status: "completed"
                    input: { [x: string]: JsonValue }
                    content: Array<
                      { type: "text"; text: string } | { type: "file"; uri: string; mime: string; name?: string }
                    >
                    structured: { [x: string]: JsonValue }
                    result?: JsonValue
                  }
                | {
                    status: "error"
                    input: { [x: string]: JsonValue }
                    content: Array<
                      { type: "text"; text: string } | { type: "file"; uri: string; mime: string; name?: string }
                    >
                    structured: { [x: string]: JsonValue }
                    error: { type: string; message: string }
                    result?: JsonValue
                  }
              time: { created: number; ran?: number; completed?: number }
            }
        >
        snapshot?: { start?: string; end?: string; files?: Array<string> }
        finish?: "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown"
        cost?: number
        tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
        error?: { type: string; message: string }
        retry?: { attempt: number; at: number; error: { type: string; message: string } }
      }
    | (
        | {
            type: "compaction"
            id: string
            metadata?: { [x: string]: JsonValue }
            time: { created: number }
            status: "running"
            reason: "auto" | "manual"
            summary: string
            recent: string
          }
        | {
            type: "compaction"
            id: string
            metadata?: { [x: string]: JsonValue }
            time: { created: number }
            status: "completed"
            reason: "auto" | "manual"
            summary: string
            recent: string
          }
        | {
            type: "compaction"
            id: string
            metadata?: { [x: string]: JsonValue }
            time: { created: number }
            status: "failed"
            reason: "auto" | "manual"
            error: { type: string; message: string }
          }
      )
  >
  cursor: { previous?: string | null; next?: string | null }
}

export type ModelListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ModelListOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Array<{
    id: string
    modelID: string
    providerID: string
    family?: string
    name: string
    package?: string
    settings?: { [x: string]: JsonValue }
    headers?: { [x: string]: string }
    body?: { [x: string]: JsonValue }
    capabilities: { tools: boolean; input: Array<string>; output: Array<string> }
    variants: Array<{
      id: string
      settings?: { [x: string]: JsonValue }
      headers?: { [x: string]: string }
      body?: { [x: string]: JsonValue }
    }>
    time: { released: number }
    cost: Array<{
      tier?: { type: "context"; size: number }
      input: number
      output: number
      cache: { read: number; write: number }
    }>
    status: "alpha" | "beta" | "deprecated" | "active"
    enabled: boolean
    limit: { context: number; input?: number; output: number }
  }>
}

export type ModelDefaultInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ModelDefaultOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: {
    id: string
    modelID: string
    providerID: string
    family?: string
    name: string
    package?: string
    settings?: { [x: string]: JsonValue }
    headers?: { [x: string]: string }
    body?: { [x: string]: JsonValue }
    capabilities: { tools: boolean; input: Array<string>; output: Array<string> }
    variants: Array<{
      id: string
      settings?: { [x: string]: JsonValue }
      headers?: { [x: string]: string }
      body?: { [x: string]: JsonValue }
    }>
    time: { released: number }
    cost: Array<{
      tier?: { type: "context"; size: number }
      input: number
      output: number
      cache: { read: number; write: number }
    }>
    status: "alpha" | "beta" | "deprecated" | "active"
    enabled: boolean
    limit: { context: number; input?: number; output: number }
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

export type GenerateTextOutput = { data: { text: string } }["data"]

export type ProviderListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ProviderListOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Array<{
    id: string
    integrationID?: string
    name: string
    disabled?: boolean
    package: string
    settings?: { [x: string]: JsonValue }
    headers?: { [x: string]: string }
    body?: { [x: string]: JsonValue }
  }>
}

export type ProviderGetInput = {
  readonly providerID: { readonly providerID: string }["providerID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ProviderGetOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: {
    id: string
    integrationID?: string
    name: string
    disabled?: boolean
    package: string
    settings?: { [x: string]: JsonValue }
    headers?: { [x: string]: string }
    body?: { [x: string]: JsonValue }
  }
}

export type IntegrationListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type IntegrationListOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Array<{
    id: string
    name: string
    methods: Array<
      | {
          id: string
          type: "oauth"
          label: string
          prompts?: Array<
            | {
                type: "text"
                key: string
                message: string
                placeholder?: string
                when?: { key: string; op: "eq" | "neq"; value: string }
              }
            | {
                type: "select"
                key: string
                message: string
                options: Array<{ label: string; value: string; hint?: string }>
                when?: { key: string; op: "eq" | "neq"; value: string }
              }
          >
        }
      | { type: "key"; label?: string }
      | { type: "env"; names: Array<string> }
    >
    connections: Array<{ type: "credential"; id: string; label: string } | { type: "env"; name: string }>
  }>
}

export type IntegrationGetInput = {
  readonly integrationID: { readonly integrationID: string }["integrationID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type IntegrationGetOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: {
    id: string
    name: string
    methods: Array<
      | {
          id: string
          type: "oauth"
          label: string
          prompts?: Array<
            | {
                type: "text"
                key: string
                message: string
                placeholder?: string
                when?: { key: string; op: "eq" | "neq"; value: string }
              }
            | {
                type: "select"
                key: string
                message: string
                options: Array<{ label: string; value: string; hint?: string }>
                when?: { key: string; op: "eq" | "neq"; value: string }
              }
          >
        }
      | { type: "key"; label?: string }
      | { type: "env"; names: Array<string> }
    >
    connections: Array<{ type: "credential"; id: string; label: string } | { type: "env"; name: string }>
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
  data:
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
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Array<{
    name: string
    status:
      | { status: "connected" }
      | { status: "pending" }
      | { status: "disabled" }
      | { status: "failed"; error: string }
      | { status: "needs_auth" }
      | { status: "needs_client_registration"; error: string }
    integrationID?: string
  }>
}

export type ServerMcpResourceCatalogInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerMcpResourceCatalogOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: {
    resources: Array<{ server: string; name: string; uri: string; description?: string; mimeType?: string }>
    templates: Array<{ server: string; name: string; uriTemplate: string; description?: string; mimeType?: string }>
  }
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

export type ProjectListOutput = Array<{
  id: string
  worktree: string
  vcs?: "git" | "hg"
  name?: string
  icon?: { url?: string; override?: string; color?: string }
  commands?: { start?: string }
  time: { created: number; updated: number; initialized?: number }
  sandboxes: Array<string>
}>

export type ProjectCurrentInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ProjectCurrentOutput = { id: string; directory: string }

export type ProjectDirectoriesInput = {
  readonly projectID: { readonly projectID: string }["projectID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ProjectDirectoriesOutput = Array<{ directory: string; strategy?: string }>

export type FormRequestListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type FormRequestListOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Array<{
    id: string
    sessionID: string
    title: string
    metadata?: { [x: string]: JsonValue }
    fields: [
      (
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "string"
            format?: "email" | "uri" | "date" | "date-time"
            minLength?: number
            maxLength?: number
            pattern?: string
            placeholder?: string
            default?: string
            options?: Array<{ value: string; label: string; description?: string }>
            custom?: boolean
          }
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "number"
            minimum?: number | "Infinity" | "-Infinity" | "NaN"
            maximum?: number | "Infinity" | "-Infinity" | "NaN"
            default?: number | "Infinity" | "-Infinity" | "NaN"
          }
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "integer"
            minimum?: number | "Infinity" | "-Infinity" | "NaN"
            maximum?: number | "Infinity" | "-Infinity" | "NaN"
            default?: number | "Infinity" | "-Infinity" | "NaN"
          }
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "boolean"
            default?: boolean
          }
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "multiselect"
            options: Array<{ value: string; label: string; description?: string }>
            minItems?: number
            maxItems?: number
            custom?: boolean
            default?: Array<string>
          }
        | { key: string; type: "external"; url: string; title?: string; description?: string }
      ),
      ...Array<
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "string"
            format?: "email" | "uri" | "date" | "date-time"
            minLength?: number
            maxLength?: number
            pattern?: string
            placeholder?: string
            default?: string
            options?: Array<{ value: string; label: string; description?: string }>
            custom?: boolean
          }
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "number"
            minimum?: number | "Infinity" | "-Infinity" | "NaN"
            maximum?: number | "Infinity" | "-Infinity" | "NaN"
            default?: number | "Infinity" | "-Infinity" | "NaN"
          }
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "integer"
            minimum?: number | "Infinity" | "-Infinity" | "NaN"
            maximum?: number | "Infinity" | "-Infinity" | "NaN"
            default?: number | "Infinity" | "-Infinity" | "NaN"
          }
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "boolean"
            default?: boolean
          }
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "multiselect"
            options: Array<{ value: string; label: string; description?: string }>
            minItems?: number
            maxItems?: number
            custom?: boolean
            default?: Array<string>
          }
        | { key: string; type: "external"; url: string; title?: string; description?: string }
      >,
    ]
  }>
}

export type FormListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type FormListOutput = {
  data: Array<{
    id: string
    sessionID: string
    title: string
    metadata?: { [x: string]: JsonValue }
    fields: [
      (
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "string"
            format?: "email" | "uri" | "date" | "date-time"
            minLength?: number
            maxLength?: number
            pattern?: string
            placeholder?: string
            default?: string
            options?: Array<{ value: string; label: string; description?: string }>
            custom?: boolean
          }
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "number"
            minimum?: number | "Infinity" | "-Infinity" | "NaN"
            maximum?: number | "Infinity" | "-Infinity" | "NaN"
            default?: number | "Infinity" | "-Infinity" | "NaN"
          }
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "integer"
            minimum?: number | "Infinity" | "-Infinity" | "NaN"
            maximum?: number | "Infinity" | "-Infinity" | "NaN"
            default?: number | "Infinity" | "-Infinity" | "NaN"
          }
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "boolean"
            default?: boolean
          }
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "multiselect"
            options: Array<{ value: string; label: string; description?: string }>
            minItems?: number
            maxItems?: number
            custom?: boolean
            default?: Array<string>
          }
        | { key: string; type: "external"; url: string; title?: string; description?: string }
      ),
      ...Array<
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "string"
            format?: "email" | "uri" | "date" | "date-time"
            minLength?: number
            maxLength?: number
            pattern?: string
            placeholder?: string
            default?: string
            options?: Array<{ value: string; label: string; description?: string }>
            custom?: boolean
          }
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "number"
            minimum?: number | "Infinity" | "-Infinity" | "NaN"
            maximum?: number | "Infinity" | "-Infinity" | "NaN"
            default?: number | "Infinity" | "-Infinity" | "NaN"
          }
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "integer"
            minimum?: number | "Infinity" | "-Infinity" | "NaN"
            maximum?: number | "Infinity" | "-Infinity" | "NaN"
            default?: number | "Infinity" | "-Infinity" | "NaN"
          }
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "boolean"
            default?: boolean
          }
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "multiselect"
            options: Array<{ value: string; label: string; description?: string }>
            minItems?: number
            maxItems?: number
            custom?: boolean
            default?: Array<string>
          }
        | { key: string; type: "external"; url: string; title?: string; description?: string }
      >,
    ]
  }>
}["data"]

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

export type FormCreateOutput = {
  data: {
    id: string
    sessionID: string
    title: string
    metadata?: { [x: string]: JsonValue }
    fields: [
      (
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "string"
            format?: "email" | "uri" | "date" | "date-time"
            minLength?: number
            maxLength?: number
            pattern?: string
            placeholder?: string
            default?: string
            options?: Array<{ value: string; label: string; description?: string }>
            custom?: boolean
          }
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "number"
            minimum?: number | "Infinity" | "-Infinity" | "NaN"
            maximum?: number | "Infinity" | "-Infinity" | "NaN"
            default?: number | "Infinity" | "-Infinity" | "NaN"
          }
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "integer"
            minimum?: number | "Infinity" | "-Infinity" | "NaN"
            maximum?: number | "Infinity" | "-Infinity" | "NaN"
            default?: number | "Infinity" | "-Infinity" | "NaN"
          }
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "boolean"
            default?: boolean
          }
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "multiselect"
            options: Array<{ value: string; label: string; description?: string }>
            minItems?: number
            maxItems?: number
            custom?: boolean
            default?: Array<string>
          }
        | { key: string; type: "external"; url: string; title?: string; description?: string }
      ),
      ...Array<
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "string"
            format?: "email" | "uri" | "date" | "date-time"
            minLength?: number
            maxLength?: number
            pattern?: string
            placeholder?: string
            default?: string
            options?: Array<{ value: string; label: string; description?: string }>
            custom?: boolean
          }
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "number"
            minimum?: number | "Infinity" | "-Infinity" | "NaN"
            maximum?: number | "Infinity" | "-Infinity" | "NaN"
            default?: number | "Infinity" | "-Infinity" | "NaN"
          }
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "integer"
            minimum?: number | "Infinity" | "-Infinity" | "NaN"
            maximum?: number | "Infinity" | "-Infinity" | "NaN"
            default?: number | "Infinity" | "-Infinity" | "NaN"
          }
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "boolean"
            default?: boolean
          }
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "multiselect"
            options: Array<{ value: string; label: string; description?: string }>
            minItems?: number
            maxItems?: number
            custom?: boolean
            default?: Array<string>
          }
        | { key: string; type: "external"; url: string; title?: string; description?: string }
      >,
    ]
  }
}["data"]

export type FormGetInput = {
  readonly sessionID: { readonly sessionID: string; readonly formID: string }["sessionID"]
  readonly formID: { readonly sessionID: string; readonly formID: string }["formID"]
}

export type FormGetOutput = {
  data: {
    id: string
    sessionID: string
    title: string
    metadata?: { [x: string]: JsonValue }
    fields: [
      (
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "string"
            format?: "email" | "uri" | "date" | "date-time"
            minLength?: number
            maxLength?: number
            pattern?: string
            placeholder?: string
            default?: string
            options?: Array<{ value: string; label: string; description?: string }>
            custom?: boolean
          }
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "number"
            minimum?: number | "Infinity" | "-Infinity" | "NaN"
            maximum?: number | "Infinity" | "-Infinity" | "NaN"
            default?: number | "Infinity" | "-Infinity" | "NaN"
          }
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "integer"
            minimum?: number | "Infinity" | "-Infinity" | "NaN"
            maximum?: number | "Infinity" | "-Infinity" | "NaN"
            default?: number | "Infinity" | "-Infinity" | "NaN"
          }
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "boolean"
            default?: boolean
          }
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "multiselect"
            options: Array<{ value: string; label: string; description?: string }>
            minItems?: number
            maxItems?: number
            custom?: boolean
            default?: Array<string>
          }
        | { key: string; type: "external"; url: string; title?: string; description?: string }
      ),
      ...Array<
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "string"
            format?: "email" | "uri" | "date" | "date-time"
            minLength?: number
            maxLength?: number
            pattern?: string
            placeholder?: string
            default?: string
            options?: Array<{ value: string; label: string; description?: string }>
            custom?: boolean
          }
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "number"
            minimum?: number | "Infinity" | "-Infinity" | "NaN"
            maximum?: number | "Infinity" | "-Infinity" | "NaN"
            default?: number | "Infinity" | "-Infinity" | "NaN"
          }
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "integer"
            minimum?: number | "Infinity" | "-Infinity" | "NaN"
            maximum?: number | "Infinity" | "-Infinity" | "NaN"
            default?: number | "Infinity" | "-Infinity" | "NaN"
          }
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "boolean"
            default?: boolean
          }
        | {
            key: string
            title?: string
            description?: string
            required?: boolean
            when?: Array<{
              key: string
              op: "eq" | "neq"
              value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            type: "multiselect"
            options: Array<{ value: string; label: string; description?: string }>
            minItems?: number
            maxItems?: number
            custom?: boolean
            default?: Array<string>
          }
        | { key: string; type: "external"; url: string; title?: string; description?: string }
      >,
    ]
  }
}["data"]

export type FormStateInput = {
  readonly sessionID: { readonly sessionID: string; readonly formID: string }["sessionID"]
  readonly formID: { readonly sessionID: string; readonly formID: string }["formID"]
}

export type FormStateOutput = {
  data:
    | { status: "pending" }
    | { status: "answered"; answer: { [x: string]: string | number | boolean | Array<string> } }
    | { status: "cancelled" }
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

export type PermissionRequestListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type PermissionRequestListOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Array<{
    id: string
    sessionID: string
    action: string
    resources: Array<string>
    save?: Array<string>
    metadata?: { [x: string]: JsonValue }
    source?: { type: "tool"; messageID: string; callID: string }
  }>
}

export type PermissionSavedListInput = { readonly projectID?: { readonly projectID?: string | undefined }["projectID"] }

export type PermissionSavedListOutput = {
  data: Array<{ id: string; projectID: string; action: string; resource: string }>
}["data"]

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

export type PermissionCreateOutput = { data: { id: string; effect: "allow" | "deny" | "ask" } }["data"]

export type PermissionListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type PermissionListOutput = {
  data: Array<{
    id: string
    sessionID: string
    action: string
    resources: Array<string>
    save?: Array<string>
    metadata?: { [x: string]: JsonValue }
    source?: { type: "tool"; messageID: string; callID: string }
  }>
}["data"]

export type PermissionGetInput = {
  readonly sessionID: { readonly sessionID: string; readonly requestID: string }["sessionID"]
  readonly requestID: { readonly sessionID: string; readonly requestID: string }["requestID"]
}

export type PermissionGetOutput = {
  data: {
    id: string
    sessionID: string
    action: string
    resources: Array<string>
    save?: Array<string>
    metadata?: { [x: string]: JsonValue }
    source?: { type: "tool"; messageID: string; callID: string }
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
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Array<{ path: string; type: "file" | "directory" }>
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
  data: Array<{ path: string; type: "file" | "directory" }>
}

export type CommandListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type CommandListOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Array<{
    name: string
    template: string
    description?: string
    agent?: string
    model?: { id: string; providerID: string; variant?: string }
    subtask?: boolean
  }>
}

export type SkillListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type SkillListOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Array<{
    id: string
    name: string
    description?: string
    slash?: boolean
    autoinvoke?: boolean
    location: string
    content: string
  }>
}

export type EventSubscribeOutput =
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "models-dev.refreshed"
      location?: { directory: string; workspaceID?: string }
      data: {}
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "integration.updated"
      location?: { directory: string; workspaceID?: string }
      data: {}
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "integration.connection.updated"
      location?: { directory: string; workspaceID?: string }
      data: { integrationID: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "catalog.updated"
      location?: { directory: string; workspaceID?: string }
      data: {}
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "agent.updated"
      location?: { directory: string; workspaceID?: string }
      data: {}
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.created"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: {
        sessionID: string
        info: {
          id: string
          slug: string
          projectID: string
          workspaceID?: string
          directory: string
          path?: string
          parentID?: string
          summary?: {
            additions: number
            deletions: number
            files: number
            diffs?: Array<{
              file?: string
              patch?: string
              additions: number
              deletions: number
              status?: "added" | "deleted" | "modified"
            }>
          }
          cost?: number
          tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
          share?: { url: string }
          title: string
          agent?: string
          model?: { id: string; providerID: string; variant?: string }
          version: string
          metadata?: { [x: string]: any }
          time: { created: number; updated: number; compacting?: number; archived?: number }
          permission?: Array<{ permission: string; pattern: string; action: "allow" | "deny" | "ask" }>
          revert?: { messageID: string; partID?: string; snapshot?: string; diff?: string }
        }
      }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.updated"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: {
        sessionID: string
        info: {
          id: string
          slug: string
          projectID: string
          workspaceID?: string
          directory: string
          path?: string
          parentID?: string
          summary?: {
            additions: number
            deletions: number
            files: number
            diffs?: Array<{
              file?: string
              patch?: string
              additions: number
              deletions: number
              status?: "added" | "deleted" | "modified"
            }>
          }
          cost?: number
          tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
          share?: { url: string }
          title: string
          agent?: string
          model?: { id: string; providerID: string; variant?: string }
          version: string
          metadata?: { [x: string]: any }
          time: { created: number; updated: number; compacting?: number; archived?: number }
          permission?: Array<{ permission: string; pattern: string; action: "allow" | "deny" | "ask" }>
          revert?: { messageID: string; partID?: string; snapshot?: string; diff?: string }
        }
      }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.deleted"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: {
        sessionID: string
        info: {
          id: string
          slug: string
          projectID: string
          workspaceID?: string
          directory: string
          path?: string
          parentID?: string
          summary?: {
            additions: number
            deletions: number
            files: number
            diffs?: Array<{
              file?: string
              patch?: string
              additions: number
              deletions: number
              status?: "added" | "deleted" | "modified"
            }>
          }
          cost?: number
          tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
          share?: { url: string }
          title: string
          agent?: string
          model?: { id: string; providerID: string; variant?: string }
          version: string
          metadata?: { [x: string]: any }
          time: { created: number; updated: number; compacting?: number; archived?: number }
          permission?: Array<{ permission: string; pattern: string; action: "allow" | "deny" | "ask" }>
          revert?: { messageID: string; partID?: string; snapshot?: string; diff?: string }
        }
      }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "message.updated"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: {
        sessionID: string
        info:
          | {
              id: string
              sessionID: string
              role: "user"
              time: { created: number }
              format?:
                | (
                    | { type: "text" }
                    | { type: "json_schema"; schema: { [x: string]: any }; retryCount?: number | undefined | undefined }
                  )
                | undefined
              summary?:
                | {
                    title?: string | undefined
                    body?: string | undefined
                    diffs: Array<{
                      file?: string
                      patch?: string
                      additions: number
                      deletions: number
                      status?: "added" | "deleted" | "modified"
                    }>
                  }
                | undefined
              agent: string
              model: { providerID: string; modelID: string; variant?: string | undefined }
              system?: string | undefined
              tools?: { [x: string]: boolean } | undefined
            }
          | {
              id: string
              sessionID: string
              role: "assistant"
              time: { created: number; completed?: number | undefined }
              error?:
                | { name: "ProviderAuthError"; data: { providerID: string; message: string } }
                | { name: "UnknownError"; data: { message: string; ref?: string | undefined } }
                | { name: "MessageOutputLengthError"; data: {} }
                | { name: "MessageAbortedError"; data: { message: string } }
                | { name: "StructuredOutputError"; data: { message: string; retries: number } }
                | { name: "ContextOverflowError"; data: { message: string; responseBody?: string | undefined } }
                | { name: "ContentFilterError"; data: { message: string } }
                | {
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
      }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "message.removed"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; messageID: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "message.part.updated"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: {
        sessionID: string
        part:
          | {
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
          | {
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
          | {
              id: string
              sessionID: string
              messageID: string
              type: "reasoning"
              text: string
              metadata?: { [x: string]: any } | undefined
              time: { start: number; end?: number | undefined }
            }
          | {
              id: string
              sessionID: string
              messageID: string
              type: "file"
              mime: string
              filename?: string | undefined
              url: string
              source?:
                | (
                    | { text: { value: string; start: number; end: number }; type: "file"; path: string }
                    | {
                        text: { value: string; start: number; end: number }
                        type: "symbol"
                        path: string
                        range: { start: { line: number; character: number }; end: { line: number; character: number } }
                        name: string
                        kind: number
                      }
                    | {
                        text: { value: string; start: number; end: number }
                        type: "resource"
                        clientName: string
                        uri: string
                      }
                  )
                | undefined
            }
          | {
              id: string
              sessionID: string
              messageID: string
              type: "tool"
              callID: string
              tool: string
              state:
                | { status: "pending"; input: { [x: string]: any }; raw: string }
                | {
                    status: "running"
                    input: { [x: string]: any }
                    title?: string | undefined
                    metadata?: { [x: string]: any } | undefined
                    time: { start: number }
                  }
                | {
                    status: "completed"
                    input: { [x: string]: any }
                    output: string
                    title: string
                    metadata: { [x: string]: any }
                    time: { start: number; end: number; compacted?: number | undefined }
                    attachments?:
                      | Array<{
                          id: string
                          sessionID: string
                          messageID: string
                          type: "file"
                          mime: string
                          filename?: string | undefined
                          url: string
                          source?:
                            | (
                                | { text: { value: string; start: number; end: number }; type: "file"; path: string }
                                | {
                                    text: { value: string; start: number; end: number }
                                    type: "symbol"
                                    path: string
                                    range: {
                                      start: { line: number; character: number }
                                      end: { line: number; character: number }
                                    }
                                    name: string
                                    kind: number
                                  }
                                | {
                                    text: { value: string; start: number; end: number }
                                    type: "resource"
                                    clientName: string
                                    uri: string
                                  }
                              )
                            | undefined
                        }>
                      | undefined
                  }
                | {
                    status: "error"
                    input: { [x: string]: any }
                    error: string
                    metadata?: { [x: string]: any } | undefined
                    time: { start: number; end: number }
                  }
              metadata?: { [x: string]: any } | undefined
            }
          | { id: string; sessionID: string; messageID: string; type: "step-start"; snapshot?: string | undefined }
          | {
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
          | { id: string; sessionID: string; messageID: string; type: "snapshot"; snapshot: string }
          | { id: string; sessionID: string; messageID: string; type: "patch"; hash: string; files: Array<string> }
          | {
              id: string
              sessionID: string
              messageID: string
              type: "agent"
              name: string
              source?: { value: string; start: number; end: number } | undefined
            }
          | {
              id: string
              sessionID: string
              messageID: string
              type: "retry"
              attempt: number
              error: {
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
              time: { created: number }
            }
          | {
              id: string
              sessionID: string
              messageID: string
              type: "compaction"
              auto: boolean
              overflow?: boolean | undefined
              tail_start_id?: string | undefined
            }
        time: number
      }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "message.part.removed"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; messageID: string; partID: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.agent.selected"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; agent: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.model.selected"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; model: { id: string; providerID: string; variant?: string } }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.moved"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; location: { directory: string; workspaceID?: string }; subpath?: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.renamed"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; title: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.usage.updated"
      location?: { directory: string; workspaceID?: string }
      data: {
        sessionID: string
        cost: number
        tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
      }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.deleted"
      durable: { aggregateID: string; seq: number; version: 2 }
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.forked"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; parentID: string; from?: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.input.promoted"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; inputID: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.input.admitted"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: {
        sessionID: string
        inputID: string
        input:
          | {
              type: "user"
              data: {
                text: string
                files?: Array<{
                  data: string
                  mime: string
                  source: { type: "inline" } | { type: "uri"; uri: string }
                  name?: string
                  description?: string
                  mention?: { start: number; end: number; text: string }
                }>
                agents?: Array<{ name: string; mention?: { start: number; end: number; text: string } }>
                metadata?: { [x: string]: unknown }
              }
              delivery: "steer" | "queue"
            }
          | {
              type: "synthetic"
              data: { text: string; description?: string; metadata?: { [x: string]: unknown } }
              delivery: "steer" | "queue"
            }
      }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.execution.started"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.execution.succeeded"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.execution.failed"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; error: { type: string; message: string } }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.execution.interrupted"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; reason: "user" | "shutdown" | "superseded" }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.instructions.updated"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; text: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.synthetic"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; text: string; description?: string; metadata?: { [x: string]: unknown } }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.skill.activated"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; id: string; name: string; text: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.shell.started"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: {
        sessionID: string
        shell: {
          id: string
          status: "running" | "exited" | "timeout" | "killed"
          command: string
          cwd: string
          shell: string
          file: string
          pid?: number
          exit?: number
          metadata: { [x: string]: unknown }
          time: { started: number; completed?: number }
        }
      }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.shell.ended"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: {
        sessionID: string
        shell: {
          id: string
          status: "running" | "exited" | "timeout" | "killed"
          command: string
          cwd: string
          shell: string
          file: string
          pid?: number
          exit?: number
          metadata: { [x: string]: unknown }
          time: { started: number; completed?: number }
        }
        output: { output: string; cursor: number; size: number; truncated: boolean }
      }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.step.started"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: {
        sessionID: string
        assistantMessageID: string
        agent: string
        model: { id: string; providerID: string; variant?: string }
        snapshot?: string
      }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.step.ended"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: {
        sessionID: string
        assistantMessageID: string
        finish: "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown"
        cost: number
        tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
        snapshot?: string
        files?: Array<string>
      }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.step.failed"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: {
        sessionID: string
        assistantMessageID: string
        error: { type: string; message: string }
        cost?: number
        tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
      }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.text.started"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; assistantMessageID: string; ordinal: number }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.text.delta"
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; assistantMessageID: string; ordinal: number; delta: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.text.ended"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; assistantMessageID: string; ordinal: number; text: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.reasoning.started"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; assistantMessageID: string; ordinal: number; state?: { [x: string]: unknown } }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.reasoning.delta"
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; assistantMessageID: string; ordinal: number; delta: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.reasoning.ended"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: {
        sessionID: string
        assistantMessageID: string
        ordinal: number
        text: string
        state?: { [x: string]: unknown }
      }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.tool.input.started"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; assistantMessageID: string; callID: string; name: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.tool.input.delta"
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; assistantMessageID: string; callID: string; delta: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.tool.input.ended"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; assistantMessageID: string; callID: string; text: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.tool.called"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: {
        sessionID: string
        assistantMessageID: string
        callID: string
        input: { [x: string]: unknown }
        executed: boolean
        state?: { [x: string]: unknown }
      }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.tool.progress"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: {
        sessionID: string
        assistantMessageID: string
        callID: string
        structured: { [x: string]: unknown }
        content: Array<{ type: "text"; text: string } | { type: "file"; uri: string; mime: string; name?: string }>
      }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.tool.success"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: {
        sessionID: string
        assistantMessageID: string
        callID: string
        structured: { [x: string]: unknown }
        content: Array<{ type: "text"; text: string } | { type: "file"; uri: string; mime: string; name?: string }>
        result?: unknown
        executed: boolean
        resultState?: { [x: string]: unknown }
      }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.tool.failed"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: {
        sessionID: string
        assistantMessageID: string
        callID: string
        error: { type: string; message: string }
        result?: unknown
        executed: boolean
        resultState?: { [x: string]: unknown }
      }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.retry.scheduled"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: {
        sessionID: string
        assistantMessageID: string
        attempt: number
        at: number
        error: { type: string; message: string }
      }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.compaction.admitted"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; inputID: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.compaction.started"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; reason: "auto" | "manual"; recent: string; inputID?: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.compaction.delta"
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; text: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.compaction.ended"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; reason: "auto" | "manual"; text: string; recent: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.compaction.failed"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; reason: "auto" | "manual"; error: { type: string; message: string }; inputID?: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.revert.staged"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: {
        sessionID: string
        revert: {
          messageID: string
          partID?: string
          snapshot?: string
          files?: Array<{
            file: string
            patch: string
            additions: number
            deletions: number
            status: "added" | "deleted" | "modified"
          }>
        }
      }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.revert.cleared"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.revert.committed"
      durable: { aggregateID: string; seq: number; version: 1 }
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; to: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "filesystem.changed"
      location?: { directory: string; workspaceID?: string }
      data: { file: string; event: "add" | "change" | "unlink" }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "reference.updated"
      location?: { directory: string; workspaceID?: string }
      data: {}
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "permission.v2.asked"
      location?: { directory: string; workspaceID?: string }
      data: {
        id: string
        sessionID: string
        action: string
        resources: Array<string>
        save?: Array<string>
        metadata?: { [x: string]: unknown }
        source?: { type: "tool"; messageID: string; callID: string }
      }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "permission.v2.replied"
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; requestID: string; reply: "once" | "always" | "reject" }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "plugin.added"
      location?: { directory: string; workspaceID?: string }
      data: { id: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "plugin.updated"
      location?: { directory: string; workspaceID?: string }
      data: {}
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "project.directories.updated"
      location?: { directory: string; workspaceID?: string }
      data: { projectID: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "command.updated"
      location?: { directory: string; workspaceID?: string }
      data: {}
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "config.updated"
      location?: { directory: string; workspaceID?: string }
      data: {}
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "skill.updated"
      location?: { directory: string; workspaceID?: string }
      data: {}
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "pty.created"
      location?: { directory: string; workspaceID?: string }
      data: {
        info: {
          id: string
          title: string
          command: string
          args: Array<string>
          cwd: string
          status: "running" | "exited"
          pid: number
          exitCode?: number
        }
      }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "pty.updated"
      location?: { directory: string; workspaceID?: string }
      data: {
        info: {
          id: string
          title: string
          command: string
          args: Array<string>
          cwd: string
          status: "running" | "exited"
          pid: number
          exitCode?: number
        }
      }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "pty.exited"
      location?: { directory: string; workspaceID?: string }
      data: { id: string; exitCode: number }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "pty.deleted"
      location?: { directory: string; workspaceID?: string }
      data: { id: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "shell.created"
      location?: { directory: string; workspaceID?: string }
      data: {
        info: {
          id: string
          status: "running" | "exited" | "timeout" | "killed"
          command: string
          cwd: string
          shell: string
          file: string
          pid?: number
          exit?: number
          metadata: { [x: string]: unknown }
          time: { started: number; completed?: number }
        }
      }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "shell.exited"
      location?: { directory: string; workspaceID?: string }
      data: { id: string; exit?: number; status: "running" | "exited" | "timeout" | "killed" }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "shell.deleted"
      location?: { directory: string; workspaceID?: string }
      data: { id: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "question.v2.asked"
      location?: { directory: string; workspaceID?: string }
      data: {
        id: string
        sessionID: string
        questions: Array<{
          question: string
          header: string
          options: Array<{ label: string; description: string }>
          multiple?: boolean
          custom?: boolean
        }>
        tool?: { messageID: string; callID: string }
      }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "question.v2.replied"
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; requestID: string; answers: Array<Array<string>> }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "question.v2.rejected"
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; requestID: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "form.created"
      location?: { directory: string; workspaceID?: string }
      data: {
        form: {
          id: string
          sessionID: string
          title: string
          metadata?: { [x: string]: unknown }
          fields: [
            (
              | {
                  key: string
                  title?: string
                  description?: string
                  required?: boolean
                  when?: Array<{ key: string; op: "eq" | "neq"; value: string | number | boolean }>
                  type: "string"
                  format?: "email" | "uri" | "date" | "date-time"
                  minLength?: number
                  maxLength?: number
                  pattern?: string
                  placeholder?: string
                  default?: string
                  options?: Array<{ value: string; label: string; description?: string }>
                  custom?: boolean
                }
              | {
                  key: string
                  title?: string
                  description?: string
                  required?: boolean
                  when?: Array<{ key: string; op: "eq" | "neq"; value: string | number | boolean }>
                  type: "number"
                  minimum?: number
                  maximum?: number
                  default?: number
                }
              | {
                  key: string
                  title?: string
                  description?: string
                  required?: boolean
                  when?: Array<{ key: string; op: "eq" | "neq"; value: string | number | boolean }>
                  type: "integer"
                  minimum?: number
                  maximum?: number
                  default?: number
                }
              | {
                  key: string
                  title?: string
                  description?: string
                  required?: boolean
                  when?: Array<{ key: string; op: "eq" | "neq"; value: string | number | boolean }>
                  type: "boolean"
                  default?: boolean
                }
              | {
                  key: string
                  title?: string
                  description?: string
                  required?: boolean
                  when?: Array<{ key: string; op: "eq" | "neq"; value: string | number | boolean }>
                  type: "multiselect"
                  options: Array<{ value: string; label: string; description?: string }>
                  minItems?: number
                  maxItems?: number
                  custom?: boolean
                  default?: Array<string>
                }
              | { key: string; type: "external"; url: string; title?: string; description?: string }
            ),
            ...Array<
              | {
                  key: string
                  title?: string
                  description?: string
                  required?: boolean
                  when?: Array<{ key: string; op: "eq" | "neq"; value: string | number | boolean }>
                  type: "string"
                  format?: "email" | "uri" | "date" | "date-time"
                  minLength?: number
                  maxLength?: number
                  pattern?: string
                  placeholder?: string
                  default?: string
                  options?: Array<{ value: string; label: string; description?: string }>
                  custom?: boolean
                }
              | {
                  key: string
                  title?: string
                  description?: string
                  required?: boolean
                  when?: Array<{ key: string; op: "eq" | "neq"; value: string | number | boolean }>
                  type: "number"
                  minimum?: number
                  maximum?: number
                  default?: number
                }
              | {
                  key: string
                  title?: string
                  description?: string
                  required?: boolean
                  when?: Array<{ key: string; op: "eq" | "neq"; value: string | number | boolean }>
                  type: "integer"
                  minimum?: number
                  maximum?: number
                  default?: number
                }
              | {
                  key: string
                  title?: string
                  description?: string
                  required?: boolean
                  when?: Array<{ key: string; op: "eq" | "neq"; value: string | number | boolean }>
                  type: "boolean"
                  default?: boolean
                }
              | {
                  key: string
                  title?: string
                  description?: string
                  required?: boolean
                  when?: Array<{ key: string; op: "eq" | "neq"; value: string | number | boolean }>
                  type: "multiselect"
                  options: Array<{ value: string; label: string; description?: string }>
                  minItems?: number
                  maxItems?: number
                  custom?: boolean
                  default?: Array<string>
                }
              | { key: string; type: "external"; url: string; title?: string; description?: string }
            >,
          ]
        }
      }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "form.replied"
      location?: { directory: string; workspaceID?: string }
      data: { id: string; sessionID: string; answer: { [x: string]: string | number | boolean | Array<string> } }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "form.cancelled"
      location?: { directory: string; workspaceID?: string }
      data: { id: string; sessionID: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.status"
      location?: { directory: string; workspaceID?: string }
      data: {
        sessionID: string
        status:
          | { type: "idle" }
          | {
              type: "retry"
              attempt: number
              message: string
              action?: {
                reason: string
                provider: string
                title: string
                message: string
                label: string
                link?: string
              }
              next: number
            }
          | { type: "busy" }
      }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.idle"
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "tui.prompt.append"
      location?: { directory: string; workspaceID?: string }
      data: { text: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "tui.command.execute"
      location?: { directory: string; workspaceID?: string }
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
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "tui.toast.show"
      location?: { directory: string; workspaceID?: string }
      data: {
        title?: string
        message: string
        variant: "info" | "success" | "warning" | "error"
        duration?: number | undefined
      }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "tui.session.select"
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "installation.updated"
      location?: { directory: string; workspaceID?: string }
      data: { version: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "installation.update-available"
      location?: { directory: string; workspaceID?: string }
      data: { version: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "vcs.branch.updated"
      location?: { directory: string; workspaceID?: string }
      data: { branch?: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "mcp.status.changed"
      location?: { directory: string; workspaceID?: string }
      data: { server: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "mcp.resources.changed"
      location?: { directory: string; workspaceID?: string }
      data: { server: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "permission.asked"
      location?: { directory: string; workspaceID?: string }
      data: {
        id: string
        sessionID: string
        permission: string
        patterns: Array<string>
        metadata: { [x: string]: unknown }
        always: Array<string>
        tool?: { messageID: string; callID: string } | undefined
      }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "permission.replied"
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; requestID: string; reply: "once" | "always" | "reject" }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "question.asked"
      location?: { directory: string; workspaceID?: string }
      data: {
        id: string
        sessionID: string
        questions: Array<{
          question: string
          header: string
          options: Array<{ label: string; description: string }>
          multiple?: boolean | undefined
          custom?: boolean | undefined
        }>
        tool?: { messageID: string; callID: string } | undefined
      }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "question.replied"
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; requestID: string; answers: Array<Array<string>> }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "question.rejected"
      location?: { directory: string; workspaceID?: string }
      data: { sessionID: string; requestID: string }
    }
  | {
      id: string
      created: number
      metadata?: { [x: string]: unknown }
      type: "session.error"
      location?: { directory: string; workspaceID?: string }
      data: {
        sessionID?: string | undefined
        error?:
          | { name: "ProviderAuthError"; data: { providerID: string; message: string } }
          | { name: "UnknownError"; data: { message: string; ref?: string | undefined } }
          | { name: "MessageOutputLengthError"; data: {} }
          | { name: "MessageAbortedError"; data: { message: string } }
          | { name: "StructuredOutputError"; data: { message: string; retries: number } }
          | { name: "ContextOverflowError"; data: { message: string; responseBody?: string | undefined } }
          | { name: "ContentFilterError"; data: { message: string } }
          | {
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
          | undefined
      }
    }
  | {
      id: string
      metadata?: { [x: string]: unknown } | undefined
      location?: { directory: string; workspaceID?: string } | undefined
      type: "server.connected"
      data: {}
    }

export type PtyListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type PtyListOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Array<{
    id: string
    title: string
    command: string
    args: Array<string>
    cwd: string
    status: "running" | "exited"
    pid: number
    exitCode?: number
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
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: {
    id: string
    title: string
    command: string
    args: Array<string>
    cwd: string
    status: "running" | "exited"
    pid: number
    exitCode?: number
  }
}

export type PtyGetInput = {
  readonly ptyID: { readonly ptyID: string }["ptyID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type PtyGetOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: {
    id: string
    title: string
    command: string
    args: Array<string>
    cwd: string
    status: "running" | "exited"
    pid: number
    exitCode?: number
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
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: {
    id: string
    title: string
    command: string
    args: Array<string>
    cwd: string
    status: "running" | "exited"
    pid: number
    exitCode?: number
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
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Array<{
    id: string
    status: "running" | "exited" | "timeout" | "killed"
    command: string
    cwd: string
    shell: string
    file: string
    pid?: number
    exit?: number | "Infinity" | "-Infinity" | "NaN"
    metadata: { [x: string]: JsonValue }
    time: { started: number | "Infinity" | "-Infinity" | "NaN"; completed?: number | "Infinity" | "-Infinity" | "NaN" }
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
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: {
    id: string
    status: "running" | "exited" | "timeout" | "killed"
    command: string
    cwd: string
    shell: string
    file: string
    pid?: number
    exit?: number | "Infinity" | "-Infinity" | "NaN"
    metadata: { [x: string]: JsonValue }
    time: { started: number | "Infinity" | "-Infinity" | "NaN"; completed?: number | "Infinity" | "-Infinity" | "NaN" }
  }
}

export type ShellGetInput = {
  readonly id: { readonly id: string }["id"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ShellGetOutput = {
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: {
    id: string
    status: "running" | "exited" | "timeout" | "killed"
    command: string
    cwd: string
    shell: string
    file: string
    pid?: number
    exit?: number | "Infinity" | "-Infinity" | "NaN"
    metadata: { [x: string]: JsonValue }
    time: { started: number | "Infinity" | "-Infinity" | "NaN"; completed?: number | "Infinity" | "-Infinity" | "NaN" }
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
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: {
    id: string
    status: "running" | "exited" | "timeout" | "killed"
    command: string
    cwd: string
    shell: string
    file: string
    pid?: number
    exit?: number | "Infinity" | "-Infinity" | "NaN"
    metadata: { [x: string]: JsonValue }
    time: { started: number | "Infinity" | "-Infinity" | "NaN"; completed?: number | "Infinity" | "-Infinity" | "NaN" }
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
  data: Array<{
    id: string
    sessionID: string
    questions: Array<{
      question: string
      header: string
      options: Array<{ label: string; description: string }>
      multiple?: boolean
      custom?: boolean
    }>
    tool?: { messageID: string; callID: string }
  }>
}

export type QuestionListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type QuestionListOutput = {
  data: Array<{
    id: string
    sessionID: string
    questions: Array<{
      question: string
      header: string
      options: Array<{ label: string; description: string }>
      multiple?: boolean
      custom?: boolean
    }>
    tool?: { messageID: string; callID: string }
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
  location: { directory: string; workspaceID?: string; project: { id: string; directory: string } }
  data: Array<{
    name: string
    path: string
    description?: string
    hidden?: boolean
    source:
      | { type: "local"; path: string; description?: string; hidden?: boolean }
      | { type: "git"; repository: string; branch?: string; description?: string; hidden?: boolean }
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

export type ProjectCopyCreateOutput = { directory: string }

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
  data: Array<{ file: string; additions: number; deletions: number; status: "added" | "deleted" | "modified" }>
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
  data: Array<{
    file: string
    patch: string
    additions: number
    deletions: number
    status: "added" | "deleted" | "modified"
  }>
}

export type DebugLocationListOutput = Array<{ directory: string; workspaceID?: string }>

export type DebugLocationEvictInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type DebugLocationEvictOutput = void
