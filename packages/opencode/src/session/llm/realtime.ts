/**
 * OpenAI Realtime (WebSocket) transport — scaffold only.
 *
 * This module is NOT wired into the live `session/llm.ts` stream path yet.
 * See `REALTIME-DESIGN.md` (same directory) for the design rationale and
 * open questions for maintainers.
 *
 * What this file provides today:
 *   - `REALTIME_URL` — the wss endpoint constant.
 *   - `adapterState()` / `toLLMEvents()` — a pure mapper from parsed Realtime
 *     JSON events onto the unified `LLMEvent` shape, with no I/O. Unit-testable.
 *   - `stream()` — a stub Effect that fails with `RealtimeNotImplemented` so
 *     accidental wiring is loud, not silent.
 *
 * Future work (out of scope for this PR):
 *   - WebSocket lifecycle (open, send `session.update`, push messages, close).
 *   - AbortSignal -> ws.close bridge.
 *   - Idle-timeout integration (see feat/llm-stream-idle-timeout PR).
 *   - Provider dispatch in `session/llm.ts`.
 */

import { LLMEvent } from "@opencode-ai/llm"
import { Effect } from "effect"
import * as Stream from "effect/Stream"

export const REALTIME_URL = "wss://api.openai.com/v1/realtime"
export const REALTIME_BETA_HEADER = "OpenAI-Beta"
export const REALTIME_BETA_VALUE = "realtime=v1"

export class RealtimeNotImplemented extends Error {
  readonly _tag = "RealtimeNotImplemented"
  constructor() {
    super("OpenAI Realtime transport is a scaffold and not yet wired into the live stream path")
  }
}

/**
 * Per-stream mapper state. Mirrors the shape of `ai-sdk.ts`'s `adapterState()`
 * on purpose so the dispatch site in `session/llm.ts` can treat both adapters
 * uniformly when this gets wired in.
 */
export function adapterState() {
  return {
    step: 0,
    activeTextID: undefined as string | undefined,
    // Realtime gives each output item its own id; we map call_id -> tool name
    // so subsequent argument-delta events can resolve the name without
    // re-reading the original `response.output_item.added` payload.
    toolNames: {} as Record<string, string>,
  }
}

export type State = ReturnType<typeof adapterState>

/**
 * Loosely-typed Realtime server event. The protocol is wide and additive, so
 * this scaffold treats every field as optional and unknown — the mapper
 * narrows what it needs case-by-case. Unknown event types fall through to
 * `[]` in `toLLMEvents()`.
 */
export interface RealtimeEvent {
  readonly type: string
  readonly item_id?: string
  readonly call_id?: string
  readonly delta?: string
  readonly name?: string
  readonly response?: { readonly id?: string; readonly status?: string }
  readonly item?: {
    readonly id?: string
    readonly type?: string
    readonly name?: string
    readonly call_id?: string
    readonly arguments?: string
  }
  readonly error?: { readonly message?: string }
}

export function toLLMEvents(state: State, event: RealtimeEvent): ReadonlyArray<LLMEvent> {
  switch (event.type) {
    case "session.created":
      return []

    case "response.created":
      return [LLMEvent.stepStart({ index: state.step })]

    case "response.output_item.added": {
      const item = event.item ?? {}
      if (item.type === "message" && item.id) {
        state.activeTextID = item.id
        return [LLMEvent.textStart({ id: item.id })]
      }
      if ((item.type === "function_call" || item.type === "tool_call") && item.call_id && item.name) {
        state.toolNames[item.call_id] = item.name
        return [LLMEvent.toolInputStart({ id: item.call_id, name: item.name })]
      }
      return []
    }

    case "response.output_text.delta": {
      const id = event.item_id ?? state.activeTextID
      if (!id || !event.delta) return []
      return [LLMEvent.textDelta({ id, text: event.delta })]
    }

    case "response.output_text.done": {
      const id = event.item_id ?? state.activeTextID
      if (!id) return []
      state.activeTextID = undefined
      return [LLMEvent.textEnd({ id })]
    }

    case "response.function_call_arguments.delta": {
      if (!event.call_id || !event.delta) return []
      const name = state.toolNames[event.call_id]
      if (!name) return []
      return [LLMEvent.toolInputDelta({ id: event.call_id, name, text: event.delta })]
    }

    case "response.function_call_arguments.done": {
      if (!event.call_id) return []
      const name = event.name ?? state.toolNames[event.call_id]
      if (!name) return []
      return [LLMEvent.toolInputEnd({ id: event.call_id, name })]
    }

    case "response.output_item.done": {
      const item = event.item ?? {}
      if ((item.type !== "function_call" && item.type !== "tool_call") || !item.call_id) return []
      const name = item.name ?? state.toolNames[item.call_id] ?? "unknown"
      delete state.toolNames[item.call_id]
      let input: unknown = item.arguments
      if (typeof input === "string") {
        try {
          input = JSON.parse(input)
        } catch {
          // Leave as string; the loop will surface the parse failure when
          // invoking the tool. This matches how the SSE path treats malformed
          // function-call arguments.
        }
      }
      return [LLMEvent.toolCall({ id: item.call_id, name, input })]
    }

    case "response.done": {
      const reason = event.response?.status === "failed" ? "error" : "stop"
      const out: LLMEvent[] = [
        LLMEvent.stepFinish({ index: state.step, reason }),
        LLMEvent.finish({ reason }),
      ]
      // Reset so the same adapter state can be reused for a follow-up turn.
      // The ai-sdk adapter does the same thing on `finish`.
      Object.assign(state, adapterState())
      return out
    }

    case "error":
      // Surfaced by the caller via Stream.fail; here we just drop it so the
      // pure mapper stays total. The transport layer is responsible for
      // catching `error` events on the socket and short-circuiting the stream.
      return []

    default:
      return []
  }
}

/**
 * Live streaming entry point. Returns a stream that immediately fails so the
 * scaffold can't be wired in by accident. Future PR will replace this with an
 * acquireRelease over a WebSocket.
 */
export function stream(): Effect.Effect<Stream.Stream<LLMEvent, RealtimeNotImplemented>> {
  return Effect.succeed(Stream.fail(new RealtimeNotImplemented()))
}

export * as LLMRealtime from "./realtime"
