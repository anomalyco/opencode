// packages/opencode/src/channels/runtime/draft-stream.ts
//
// DraftStream — reusable stateful handle for sending + editing a single
// preview message in a chat platform, with throttling and continuation
// chaining when the final text exceeds `maxChars`.
//
// State machine (per `createDraftStream` instance):
//   - no message yet   → update() calls send() to create one
//   - has message      → update() calls edit() on the existing one
//   - finalize()       → flushes pending update, then sends continuation
//                        messages for any text beyond `maxChars`
//   - clear()          → deletes the preview message (if any) and resets
//
// The handle is single-use: once `finalize` or `clear` has been called,
// further `update` calls are no-ops.

import { Effect } from "effect"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "channels/draft-stream" })

/** Hard upper bound enforced by Telegram. Other platforms may pass a smaller value. */
export const TELEGRAM_STREAM_MAX_CHARS = 4096

/** Default minimum interval between actual send/edit API calls. */
export const DEFAULT_THROTTLE_MS = 1000

/** Minimum allowed throttle — guards against caller passing 0 / negative. */
const MIN_THROTTLE_MS = 250

export interface DraftStreamConfig {
  /** Chat / channel identifier. Forwarded to send/edit/delete callbacks as-is. */
  readonly chatId: string
  /** Maximum characters per message. Defaults to 4096 (Telegram's hard limit). */
  readonly maxChars?: number
  /** Minimum interval between actual send/edit calls. Defaults to 1000 ms. */
  readonly throttleMs?: number
  /** Send a new message; resolve with the new message id. */
  readonly send: (text: string) => Effect.Effect<number, Error>
  /** Edit an existing message in place. */
  readonly edit: (messageId: number, text: string) => Effect.Effect<void, Error>
  /** Optional: delete a message (used by `clear`). */
  readonly delete?: (messageId: number) => Effect.Effect<void, Error>
  /** Optional: transform text right before send/edit (e.g. markdown → HTML). */
  readonly renderText?: (text: string) => string
}

export interface DraftStreamHandle {
  /** Update the preview with cumulative text. Throttled internally. */
  readonly update: (text: string) => Effect.Effect<void>
  /** Flush any pending update; send continuation messages if text > maxChars. */
  readonly finalize: () => Effect.Effect<void>
  /** Delete the preview message (if any) and reset internal state. */
  readonly clear: () => Effect.Effect<void>
  /** Current preview message id, or `undefined` if no message has been sent yet. */
  readonly messageId: () => number | undefined
}

interface InternalState {
  messageId: number | undefined
  /** Last text actually delivered to the transport (after render, after truncate). */
  lastDeliveredText: string
  /** Most recent text passed to `update` (cumulative). */
  pendingText: string
  /** Most recent raw (un-truncated) text passed to `update`. Used by `finalize` to
   *  detect overflow and send continuation messages for text beyond `maxChars`. */
  mostRecentFullText: string
  /** Timer handle for the throttled flush, if scheduled. */
  timer: ReturnType<typeof setTimeout> | undefined
  /** True once `finalize` or `clear` has run. */
  stopped: boolean
}

export function createDraftStream(config: DraftStreamConfig): DraftStreamHandle {
  const maxChars = config.maxChars ?? TELEGRAM_STREAM_MAX_CHARS
  const throttleMs = Math.max(MIN_THROTTLE_MS, config.throttleMs ?? DEFAULT_THROTTLE_MS)

  const state: InternalState = {
    messageId: undefined,
    lastDeliveredText: "",
    pendingText: "",
    mostRecentFullText: "",
    timer: undefined,
    stopped: false,
  }

  const render = (text: string): string => {
    const trimmed = text.trimEnd()
    const sliced = trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed
    return config.renderText ? config.renderText(sliced) : sliced
  }

  const clearTimer = (): void => {
    if (state.timer !== undefined) {
      clearTimeout(state.timer)
      state.timer = undefined
    }
  }

  /** Send a new message OR edit the existing preview, whichever applies. */
  const deliver = Effect.fnUntraced("DraftStream.deliver")(function* (rawText: string) {
    const text = render(rawText)
    if (text === state.lastDeliveredText) return

    if (state.messageId === undefined) {
      const id = yield* config.send(text)
      state.messageId = id
      log.debug("draft stream sent initial message", { chatId: config.chatId, messageId: id })
    } else {
      yield* config.edit(state.messageId, text)
      log.debug("draft stream edited message", { chatId: config.chatId, messageId: state.messageId })
    }
    state.lastDeliveredText = text
  })

  /** Internal flush: cancel timer, deliver pending text. */
  const flush = Effect.fnUntraced("DraftStream.flush")(function* () {
    clearTimer()
    if (state.pendingText === "" || state.stopped) return
    const snapshot = state.pendingText
    state.pendingText = ""
    yield* deliver(snapshot)
  })

  const update = (text: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (state.stopped) return
      state.pendingText = text
      state.mostRecentFullText = text
      if (state.timer !== undefined) return // already scheduled

      // Schedule a throttled flush.
      state.timer = setTimeout(() => {
        // Run the Effect in a fork; errors are logged but do not crash the timer.
        Effect.runFork(
          flush().pipe(
            Effect.catch((error: unknown) =>
              Effect.sync(() => {
                log.error("draft stream throttled flush failed", {
                  chatId: config.chatId,
                  error: String(error),
                })
              }),
            ),
          ),
        )
      }, throttleMs)
    })

  const finalize = Effect.fnUntraced("DraftStream.finalize")(function* () {
    if (state.stopped) return
    state.stopped = true
    clearTimer()

    // 1. Flush whatever the last `update` queued (the cumulative preview text).
    if (state.pendingText !== "" && state.pendingText !== state.lastDeliveredText) {
      yield* deliver(state.pendingText)
      state.pendingText = ""
    }

    // 2. If the (full) text exceeds maxChars, send continuation messages.
    //    The caller is expected to have passed the *full cumulative* text via
    //    the final `update` before calling `finalize`, so we read
    //    `lastDeliveredText` (which is the truncated preview) and compare it
    //    against the un-truncated source if available. To support this, the
    //    caller passes the full text via `update` — we track the *raw*
    //    un-truncated text in `pendingText` until consumed. By the time
    //    `finalize` runs, `pendingText` was just consumed above, so we
    //    re-derive: if the final `update` text was > maxChars and the preview
    //    was truncated, we need to send the remainder.
    //
    //    Implementation: the caller calls `update(fullText)` as the LAST
    //    call before `finalize`. If `fullText.length > maxChars`, we know
    //    the preview was truncated. The remainder is sent as new messages.
    //
    //    We do this by comparing the last `pendingText` (now consumed) to
    //    `lastDeliveredText`: if `pendingText.trimEnd().length > maxChars`
    //    and we just delivered a truncated version, the remainder is
    //    `pendingText.trimEnd().slice(maxChars)`.
    //
    //    To avoid losing this info across the deliver() call, we capture it
    //    here from a side channel: the most recent full text passed to
    //    `update` is also stored in a separate field, distinct from
    //    `pendingText` (which is the *queue* slot).
    //
    //    See the `mostRecentFullText` field below for the storage.
    const fullText = state.mostRecentFullText.trimEnd()
    if (fullText.length <= maxChars || state.messageId === undefined) return

    // Send continuation messages, each at most maxChars characters.
    let offset = maxChars
    let continuationIndex = 0
    while (offset < fullText.length) {
      const slice = fullText.slice(offset, offset + maxChars)
      const text = config.renderText ? config.renderText(slice) : slice
      yield* config.send(text)
      continuationIndex += 1
      offset += maxChars
    }
    log.debug("draft stream sent continuations", {
      chatId: config.chatId,
      count: continuationIndex,
    })
  })

  const clear = Effect.fnUntraced("DraftStream.clear")(function* () {
    if (state.stopped) return
    state.stopped = true
    clearTimer()
    state.pendingText = ""
    if (state.messageId !== undefined && config.delete) {
      yield* config.delete(state.messageId)
      log.debug("draft stream cleared", { chatId: config.chatId, messageId: state.messageId })
    }
    state.messageId = undefined
    state.lastDeliveredText = ""
  })

  const messageId = (): number | undefined => state.messageId

  return { update, finalize, clear, messageId }
}
