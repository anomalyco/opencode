export type JsonValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue }

export type InvalidCursorError = { readonly _tag: "InvalidCursorError"; readonly message: string }
export const isInvalidCursorError = (value: unknown): value is InvalidCursorError =>
  typeof value === "object" && value !== null && "_tag" in value && value._tag === "InvalidCursorError"

export type InvalidRequestError = {
  readonly _tag: "InvalidRequestError"
  readonly message: string
  readonly kind?: string | undefined
  readonly field?: string | undefined
}
export const isInvalidRequestError = (value: unknown): value is InvalidRequestError =>
  typeof value === "object" && value !== null && "_tag" in value && value._tag === "InvalidRequestError"

export type UnauthorizedError = { readonly _tag: "UnauthorizedError"; readonly message: string }
export const isUnauthorizedError = (value: unknown): value is UnauthorizedError =>
  typeof value === "object" && value !== null && "_tag" in value && value._tag === "UnauthorizedError"

export type SessionNotFoundError = {
  readonly _tag: "SessionNotFoundError"
  readonly sessionID: string
  readonly message: string
}
export const isSessionNotFoundError = (value: unknown): value is SessionNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value._tag === "SessionNotFoundError"

export type ConflictError = {
  readonly _tag: "ConflictError"
  readonly message: string
  readonly resource?: string | undefined
}
export const isConflictError = (value: unknown): value is ConflictError =>
  typeof value === "object" && value !== null && "_tag" in value && value._tag === "ConflictError"

export type ServiceUnavailableError = {
  readonly _tag: "ServiceUnavailableError"
  readonly message: string
  readonly service?: string | undefined
}
export const isServiceUnavailableError = (value: unknown): value is ServiceUnavailableError =>
  typeof value === "object" && value !== null && "_tag" in value && value._tag === "ServiceUnavailableError"

export type MessageNotFoundError = {
  readonly _tag: "MessageNotFoundError"
  readonly sessionID: string
  readonly messageID: string
  readonly message: string
}
export const isMessageNotFoundError = (value: unknown): value is MessageNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value._tag === "MessageNotFoundError"

export type UnknownError = {
  readonly _tag: "UnknownError"
  readonly message: string
  readonly ref?: string | undefined
}
export const isUnknownError = (value: unknown): value is UnknownError =>
  typeof value === "object" && value !== null && "_tag" in value && value._tag === "UnknownError"

export type SessionsListInput = {
  readonly workspace?: {
    readonly workspace?: string | undefined
    readonly limit?: string | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["workspace"]
  readonly limit?: {
    readonly workspace?: string | undefined
    readonly limit?: string | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["limit"]
  readonly order?: {
    readonly workspace?: string | undefined
    readonly limit?: string | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["order"]
  readonly search?: {
    readonly workspace?: string | undefined
    readonly limit?: string | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["search"]
  readonly directory?: {
    readonly workspace?: string | undefined
    readonly limit?: string | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["directory"]
  readonly project?: {
    readonly workspace?: string | undefined
    readonly limit?: string | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["project"]
  readonly subpath?: {
    readonly workspace?: string | undefined
    readonly limit?: string | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["subpath"]
  readonly cursor?: {
    readonly workspace?: string | undefined
    readonly limit?: string | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["cursor"]
}

export type SessionsListOutput = {
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly parentID?: string
    readonly projectID: string
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string | null } | null
    readonly cost: number
    readonly tokens: {
      readonly input: number
      readonly output: number
      readonly reasoning: number
      readonly cache: { readonly read: number; readonly write: number }
    }
    readonly time: { readonly created: number; readonly updated: number; readonly archived?: number | null }
    readonly title: string
    readonly location: { readonly directory: string; readonly workspaceID?: string | null | null }
    readonly subpath?: string | null
    readonly revert?: {
      readonly messageID: string
      readonly partID?: string | null
      readonly snapshot?: string | null
      readonly diff?: string | null
      readonly files?: ReadonlyArray<{
        readonly path: string
        readonly status: "added" | "modified" | "deleted"
        readonly additions: number
        readonly deletions: number
        readonly patch: string
      }> | null
    } | null
  }>
  readonly cursor: { readonly previous?: string | null; readonly next?: string | null }
}

export type SessionsCreateInput = {
  readonly id?: {
    readonly id?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string | null } | null
    readonly location?: { readonly directory: string; readonly workspaceID?: string | null | null } | null
  }["id"]
  readonly agent?: {
    readonly id?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string | null } | null
    readonly location?: { readonly directory: string; readonly workspaceID?: string | null | null } | null
  }["agent"]
  readonly model?: {
    readonly id?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string | null } | null
    readonly location?: { readonly directory: string; readonly workspaceID?: string | null | null } | null
  }["model"]
  readonly location?: {
    readonly id?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string | null } | null
    readonly location?: { readonly directory: string; readonly workspaceID?: string | null | null } | null
  }["location"]
}

export type SessionsCreateOutput = {
  readonly data: {
    readonly id: string
    readonly parentID?: string
    readonly projectID: string
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string | null } | null
    readonly cost: number
    readonly tokens: {
      readonly input: number
      readonly output: number
      readonly reasoning: number
      readonly cache: { readonly read: number; readonly write: number }
    }
    readonly time: { readonly created: number; readonly updated: number; readonly archived?: number | null }
    readonly title: string
    readonly location: { readonly directory: string; readonly workspaceID?: string | null | null }
    readonly subpath?: string | null
    readonly revert?: {
      readonly messageID: string
      readonly partID?: string | null
      readonly snapshot?: string | null
      readonly diff?: string | null
      readonly files?: ReadonlyArray<{
        readonly path: string
        readonly status: "added" | "modified" | "deleted"
        readonly additions: number
        readonly deletions: number
        readonly patch: string
      }> | null
    } | null
  }
}["data"]

export type SessionsGetInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsGetOutput = {
  readonly data: {
    readonly id: string
    readonly parentID?: string
    readonly projectID: string
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string | null } | null
    readonly cost: number
    readonly tokens: {
      readonly input: number
      readonly output: number
      readonly reasoning: number
      readonly cache: { readonly read: number; readonly write: number }
    }
    readonly time: { readonly created: number; readonly updated: number; readonly archived?: number | null }
    readonly title: string
    readonly location: { readonly directory: string; readonly workspaceID?: string | null | null }
    readonly subpath?: string | null
    readonly revert?: {
      readonly messageID: string
      readonly partID?: string | null
      readonly snapshot?: string | null
      readonly diff?: string | null
      readonly files?: ReadonlyArray<{
        readonly path: string
        readonly status: "added" | "modified" | "deleted"
        readonly additions: number
        readonly deletions: number
        readonly patch: string
      }> | null
    } | null
  }
}["data"]

export type SessionsSwitchAgentInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly agent: { readonly agent: string }["agent"]
}

export type SessionsSwitchAgentOutput = void

export type SessionsSwitchModelInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly model: {
    readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string | undefined }
  }["model"]
}

export type SessionsSwitchModelOutput = void

export type SessionsPromptInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id?: {
    readonly id?: string | undefined
    readonly prompt: {
      readonly text: string
      readonly files?:
        | ReadonlyArray<{
            readonly uri: string
            readonly mime: string
            readonly name?: string | undefined
            readonly description?: string | undefined
            readonly source?: { readonly start: number; readonly end: number; readonly text: string } | undefined
          }>
        | undefined
      readonly agents?:
        | ReadonlyArray<{
            readonly name: string
            readonly source?: { readonly start: number; readonly end: number; readonly text: string } | undefined
          }>
        | undefined
    }
    readonly delivery?: "steer" | "queue" | undefined
    readonly resume?: boolean | undefined
  }["id"]
  readonly prompt: {
    readonly id?: string | undefined
    readonly prompt: {
      readonly text: string
      readonly files?:
        | ReadonlyArray<{
            readonly uri: string
            readonly mime: string
            readonly name?: string | undefined
            readonly description?: string | undefined
            readonly source?: { readonly start: number; readonly end: number; readonly text: string } | undefined
          }>
        | undefined
      readonly agents?:
        | ReadonlyArray<{
            readonly name: string
            readonly source?: { readonly start: number; readonly end: number; readonly text: string } | undefined
          }>
        | undefined
    }
    readonly delivery?: "steer" | "queue" | undefined
    readonly resume?: boolean | undefined
  }["prompt"]
  readonly delivery?: {
    readonly id?: string | undefined
    readonly prompt: {
      readonly text: string
      readonly files?:
        | ReadonlyArray<{
            readonly uri: string
            readonly mime: string
            readonly name?: string | undefined
            readonly description?: string | undefined
            readonly source?: { readonly start: number; readonly end: number; readonly text: string } | undefined
          }>
        | undefined
      readonly agents?:
        | ReadonlyArray<{
            readonly name: string
            readonly source?: { readonly start: number; readonly end: number; readonly text: string } | undefined
          }>
        | undefined
    }
    readonly delivery?: "steer" | "queue" | undefined
    readonly resume?: boolean | undefined
  }["delivery"]
  readonly resume?: {
    readonly id?: string | undefined
    readonly prompt: {
      readonly text: string
      readonly files?:
        | ReadonlyArray<{
            readonly uri: string
            readonly mime: string
            readonly name?: string | undefined
            readonly description?: string | undefined
            readonly source?: { readonly start: number; readonly end: number; readonly text: string } | undefined
          }>
        | undefined
      readonly agents?:
        | ReadonlyArray<{
            readonly name: string
            readonly source?: { readonly start: number; readonly end: number; readonly text: string } | undefined
          }>
        | undefined
    }
    readonly delivery?: "steer" | "queue" | undefined
    readonly resume?: boolean | undefined
  }["resume"]
}

export type SessionsPromptOutput = {
  readonly data: {
    readonly admittedSeq: number
    readonly id: string
    readonly sessionID: string
    readonly prompt: {
      readonly text: string
      readonly files?: ReadonlyArray<{
        readonly uri: string
        readonly mime: string
        readonly name?: string | null
        readonly description?: string | null
        readonly source?: { readonly start: number; readonly end: number; readonly text: string } | null
      }> | null
      readonly agents?: ReadonlyArray<{
        readonly name: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string } | null
      }> | null
    }
    readonly delivery: "steer" | "queue"
    readonly timeCreated: number
    readonly promotedSeq?: number | null
  }
}["data"]

export type SessionsCompactInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsCompactOutput = void

export type SessionsWaitInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsWaitOutput = void

export type SessionsStageInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly messageID: { readonly messageID: string; readonly files?: boolean | undefined }["messageID"]
  readonly files?: { readonly messageID: string; readonly files?: boolean | undefined }["files"]
}

export type SessionsStageOutput = {
  readonly data: {
    readonly messageID: string
    readonly partID?: string | undefined
    readonly snapshot?: string | undefined
    readonly diff?: string | undefined
    readonly files?:
      | ReadonlyArray<{
          readonly path: string
          readonly status: "added" | "modified" | "deleted"
          readonly additions: number
          readonly deletions: number
          readonly patch: string
        }>
      | undefined
  }
}["data"]

export type SessionsClearInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsClearOutput = void

export type SessionsCommitInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsCommitOutput = void

export type SessionsContextInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsContextOutput = {
  readonly data: ReadonlyArray<
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue } | null
        readonly time: { readonly created: number }
        readonly type: "agent-switched"
        readonly agent: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue } | null
        readonly time: { readonly created: number }
        readonly type: "model-switched"
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string | null }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue } | null
        readonly time: { readonly created: number }
        readonly text: string
        readonly files?: ReadonlyArray<{
          readonly uri: string
          readonly mime: string
          readonly name?: string | null
          readonly description?: string | null
          readonly source?: { readonly start: number; readonly end: number; readonly text: string } | null
        }> | null
        readonly agents?: ReadonlyArray<{
          readonly name: string
          readonly source?: { readonly start: number; readonly end: number; readonly text: string } | null
        }> | null
        readonly type: "user"
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue } | null
        readonly time: { readonly created: number }
        readonly sessionID: string
        readonly text: string
        readonly type: "synthetic"
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue } | null
        readonly time: { readonly created: number }
        readonly type: "system"
        readonly text: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue } | null
        readonly time: { readonly created: number; readonly completed?: number | null }
        readonly type: "shell"
        readonly callID: string
        readonly command: string
        readonly output: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue } | null
        readonly time: { readonly created: number; readonly completed?: number | null }
        readonly type: "assistant"
        readonly agent: string
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string | null }
        readonly content: ReadonlyArray<
          | { readonly type: "text"; readonly id: string; readonly text: string }
          | {
              readonly type: "reasoning"
              readonly id: string
              readonly text: string
              readonly providerMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } } | null
            }
          | {
              readonly type: "tool"
              readonly id: string
              readonly name: string
              readonly provider?: {
                readonly executed: boolean
                readonly metadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } } | null
                readonly resultMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } } | null
              } | null
              readonly state:
                | { readonly status: "pending"; readonly input: string }
                | {
                    readonly status: "running"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly structured: { readonly [x: string]: any }
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | {
                          readonly type: "file"
                          readonly uri: string
                          readonly mime: string
                          readonly name?: string | null
                        }
                    >
                  }
                | {
                    readonly status: "completed"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly attachments?: ReadonlyArray<{
                      readonly uri: string
                      readonly mime: string
                      readonly name?: string | null
                      readonly description?: string | null
                      readonly source?: { readonly start: number; readonly end: number; readonly text: string } | null
                    }> | null
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | {
                          readonly type: "file"
                          readonly uri: string
                          readonly mime: string
                          readonly name?: string | null
                        }
                    >
                    readonly outputPaths?: ReadonlyArray<string> | null
                    readonly structured: { readonly [x: string]: any }
                    readonly result?: JsonValue | null
                  }
                | {
                    readonly status: "error"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | {
                          readonly type: "file"
                          readonly uri: string
                          readonly mime: string
                          readonly name?: string | null
                        }
                    >
                    readonly structured: { readonly [x: string]: any }
                    readonly error: { readonly type: "unknown"; readonly message: string }
                    readonly result?: JsonValue | null
                  }
              readonly time: {
                readonly created: number
                readonly ran?: number | null
                readonly completed?: number | null
                readonly pruned?: number | null
              }
            }
        >
        readonly snapshot?: {
          readonly start?: string | null
          readonly end?: string | null
          readonly files?: ReadonlyArray<string> | null
        } | null
        readonly finish?: string | null
        readonly cost?: number | null
        readonly tokens?: {
          readonly input: number
          readonly output: number
          readonly reasoning: number
          readonly cache: { readonly read: number; readonly write: number }
        } | null
        readonly error?: { readonly type: "unknown"; readonly message: string } | null
      }
    | {
        readonly type: "compaction"
        readonly reason: "auto" | "manual"
        readonly summary: string
        readonly recent: string
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue } | null
        readonly time: { readonly created: number }
      }
  >
}["data"]
