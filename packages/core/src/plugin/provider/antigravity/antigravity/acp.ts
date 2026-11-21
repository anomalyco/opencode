export * as AntigravityACP from "./acp.js"

import type {
  ReadTextFileRequest,
  ReadTextFileResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from "@agentclientprotocol/sdk"
import { Schema } from "effect"

/** The CLI lists one entry per effort level, so the same model appears several times. */
export const Model = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
})
export type Model = typeof Model.Type

/** Updates carry only the fields that changed, so every field but the id may be missing. */
export interface ToolCall {
  readonly toolCallId: string
  readonly toolName?: string
  readonly args?: unknown
  /** Where the call stands: "pending", "in_progress", "completed" or "failed". */
  readonly status?: string
  readonly title?: string
}

export type Update =
  | { readonly kind: "message"; readonly text: string }
  | { readonly kind: "thought"; readonly text: string }
  | { readonly kind: "tool-call"; readonly call: ToolCall }
  | { readonly kind: "tool-call-update"; readonly call: ToolCall }

export interface Usage {
  readonly input: number
  readonly output: number
  readonly thought: number | undefined
  readonly cacheRead: number | undefined
  readonly cacheWrite: number | undefined
  readonly total: number
}

export interface Turn {
  /** Why the agent stopped: "end_turn", "max_tokens", "max_turn_requests", "refusal" or "cancelled". */
  readonly stopReason: string
  readonly usage: Usage | undefined
}

export interface AgentInfo {
  readonly name: string
  readonly version: string
}

export interface Session {
  readonly sessionId: string
  readonly models: readonly Model[]
  readonly currentModel: string | undefined
}

export interface Options {
  /** The Antigravity CLI to run. Defaults to "agy" on PATH. */
  readonly command?: string
  /** The arguments for the CLI. Defaults to ["acp"], the CLI's ACP server. */
  readonly args?: readonly string[]
  readonly cwd?: string
  readonly clientInfo?: { readonly name: string; readonly version: string }
  /**
   * Answers the agent's permission requests.
   *
   * Without one, every request is refused, so the agent never acts on the machine on its own.
   */
  readonly permission?: (
    request: RequestPermissionRequest,
  ) => RequestPermissionResponse | Promise<RequestPermissionResponse>
  /** Reads a file for the agent. The agent may only ask when this is set. */
  readonly readTextFile?: (request: ReadTextFileRequest) => ReadTextFileResponse | Promise<ReadTextFileResponse>
  /** Writes a file for the agent. The agent may only ask when this is set. */
  readonly writeTextFile?: (request: WriteTextFileRequest) => WriteTextFileResponse | Promise<WriteTextFileResponse>
}

export class Failed extends Schema.TaggedError<Failed>()("AntigravityACP.Failed", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}
