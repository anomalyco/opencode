import type { Effect, Scope, Stream } from "effect"
import type { Headers } from "effect/unstable/http"
import type { AIError, HttpContext } from "../../schema/index.js"

export interface WebSocketChannelExecutor {
  readonly execute: (
    exchange: WebSocketChannelExchange,
  ) => Effect.Effect<WebSocketChannelExecution, AIError, Scope.Scope>
}

export interface WebSocketChannelExecution {
  readonly frames: Stream.Stream<string, AIError>
  readonly http?: HttpContext
  /** Commits staged state after the decoded Route stream ends successfully. */
  readonly complete: Effect.Effect<void>
}

export interface WebSocketChannelExchange {
  readonly id: string
  readonly connect: {
    readonly url: string
    readonly headers: Headers.Headers
    /** Provider-safe connection age after which Core should rotate before sending. */
    readonly rotateAfterMs?: number
  }
  readonly fallback: () => Stream.Stream<string, AIError>
  readonly driver: WebSocketChannelDriver
}

export interface WebSocketChannelDriver {
  readonly create: (checkpoint: ChannelCheckpoint | undefined) => Effect.Effect<ChannelCreate, AIError>
  readonly observe: (create: ChannelCreate, frame: string) => Effect.Effect<ChannelObservation, AIError>
  /** Undefined when this response cannot accept a user update. */
  readonly steer?: (text: string) => Effect.Effect<string | undefined, AIError>
}

export interface ChannelCreate {
  readonly message: string
  readonly mode: "full" | "incremental" | "automatic"
}

export type ChannelObservation =
  | { readonly type: "ignore" }
  | { readonly type: "frame"; readonly frame: string }
  | {
      readonly type: "completed"
      readonly frame: string
      readonly checkpoint?: ChannelCheckpoint
      readonly continuation?: string
    }
  | {
      readonly type: "incomplete"
      readonly frame: string
      readonly checkpoint?: ChannelCheckpoint
      readonly continuation?: string
    }
  | { readonly type: "provider-failure"; readonly error: AIError }
  | { readonly type: "rejected"; readonly error: AIError; readonly recovery: "retry-full" }
  | { readonly type: "rejected"; readonly error: AIError; readonly recovery: "rotate-and-retry-full" }

export interface ChannelCheckpoint {
  readonly protocol: string
  readonly value: unknown
  /** Input deferred while a server-created response was already running. */
  readonly pendingInput?: boolean
}
