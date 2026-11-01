import { createHash } from "node:crypto"
import type { LanguageModelV3CallOptions, LanguageModelV3StreamPart } from "@ai-sdk/provider"
import { DSML_GUARD_MESSAGE, EMPTY_VETTING_LOOP_MESSAGE, emptyVettingLoopDetector } from "./dsml"
import { queueDSMLRecoveryAudit, type DSMLRecoveryAuditInput } from "../../provider/dsml-recovery-audit"

const RESPONSE_LIMIT = 2 * 1024 * 1024
const GLOBAL_LIMIT = 32 * 1024 * 1024
let handles = 0
let retained = 0

export function isDSV4Scope(providerID: string, modelID: string) {
  return providerID === "llmgw" && modelID === "dsv4"
}

/**
 * `1` promotes textual invocations back into tool calls; unset keeps the strict
 * guard only; `0` turns the middleware off entirely.
 */
export function recoveryStatus() {
  return process.env.OPENCODE_DSV4_RECOVERY_ENABLED === "1" ? "enabled" : "disabled"
}

/** The strict guard runs by default and is disabled only by an explicit `0`. */
export function guardStatus() {
  return process.env.OPENCODE_DSV4_RECOVERY_ENABLED === "0" ? "disabled" : "enabled"
}

type Options = {
  params: Pick<LanguageModelV3CallOptions, "tools" | "toolChoice">
  onSuspect?: () => void
  onError?: (message: string) => void
  sessionID: string
  messageID: string
  abort?: AbortSignal
  gatewayRequestID?: string
  audit?: (input: DSMLRecoveryAuditInput) => void
}

class Rejected extends Error {
  constructor(readonly reason: string) {
    super(DSML_GUARD_MESSAGE)
  }
}

function quoted(text: string, position: number) {
  const before = text.slice(0, position)
  const line = before.slice(before.lastIndexOf("\n") + 1)
  if (/^(?: {4}|\t|\s*>)/.test(line)) return true
  let inline: number | undefined
  for (const marker of line.matchAll(/`+/g))
    inline = inline === marker[0].length ? undefined : (inline ?? marker[0].length)
  if (inline !== undefined) return true
  if ((line.match(/"/g)?.length ?? 0) % 2 === 1) return true
  if ((line.match(/'/g)?.length ?? 0) % 2 === 1) return true
  let fence: string | undefined
  for (const value of before.split("\n")) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(value)
    if (!match) continue
    if (!fence) fence = match[1]
    else if (fence[0] === match[1][0] && match[1].length >= fence.length && /^\s*$/.test(match[2])) fence = undefined
  }
  return !!fence
}

function allowed(name: string, params: Options["params"]) {
  if (params.toolChoice?.type === "none") throw new Rejected("tool_choice_none")
  if (!params.tools?.some((tool) => tool.type === "function" && tool.name === name))
    throw new Rejected("undeclared_tool")
  if (params.toolChoice?.type === "tool" && params.toolChoice.toolName !== name) throw new Rejected("undeclared_tool")
}

export function recoverDSMLStream(stream: ReadableStream<LanguageModelV3StreamPart>, options: Options) {
  const reader = stream.getReader()
  let counted = false
  let bytes = 0
  let text = ""
  let pending: Extract<LanguageModelV3StreamPart, { type: "text-delta" }> | undefined
  const held: LanguageModelV3StreamPart[] = []
  const native = new Set<string>()
  let nativeCount = 0
  let priorNativeValid = true
  let nativeTrackingOverflow = false
  const loop = emptyVettingLoopDetector()
  let loopDetected = false
  let suspect = false
  let audited = false
  let closed = false
  let finish: Extract<LanguageModelV3StreamPart, { type: "finish" }> | undefined
  let proseLine = ""
  let proseFence: string | undefined
  let proseAmbiguous = false
  let protectionPrefix = ""
  const observeProse = (value: string) => {
    for (const character of value) {
      if (character !== "\n") {
        proseLine += character
        if (proseLine.length > 4096) {
          proseLine = proseLine.slice(-4096)
          proseAmbiguous = true
        }
        continue
      }
      if (!proseAmbiguous) {
        const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(proseLine)
        if (marker && !proseFence) proseFence = marker[1]
        else if (
          marker &&
          proseFence &&
          proseFence[0] === marker[1][0] &&
          marker[1].length >= proseFence.length &&
          /^\s*$/.test(marker[2])
        )
          proseFence = undefined
      }
      proseLine = ""
      proseAmbiguous = false
    }
  }
  const audit = (disposition: DSMLRecoveryAuditInput["disposition"], reason: string) => {
    if (audited || (!suspect && !loopDetected)) return
    audited = true
    try {
      ;(options.audit ?? queueDSMLRecoveryAudit)({
        sessionID: options.sessionID,
        messageID: options.messageID,
        providerID: "llmgw",
        modelID: "dsv4",
        disposition,
        reason,
        recoveredCount: 0,
        nativeCount,
        candidateCount: [...text.matchAll(/<｜DSML｜invoke\b/g)].length,
        sourceHash: createHash("sha256").update(text).digest("hex"),
        gatewayRequestID: options.gatewayRequestID,
      })
    } catch {
      /* audit must never mask the stream result */
    }
  }
  const release = () => {
    if (closed) return
    closed = true
    retained -= bytes
    if (counted) handles--
    held.length = 0
    native.clear()
    options.abort?.removeEventListener("abort", abort)
  }
  const cancel = () => {
    void reader.cancel().catch(() => {})
  }
  let controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>
  const abort = () => {
    audit("aborted", "cancelled")
    cancel()
    release()
    controller.error(options.abort?.reason ?? new Error("cancelled"))
  }
  const charge = (value: number) => {
    bytes += value
    retained += value
    if (bytes > RESPONSE_LIMIT) throw new Rejected("response_limit")
    if (retained > GLOBAL_LIMIT) throw new Rejected("global_limit")
  }
  const startSuspicion = () => {
    suspect = true
    try {
      options.onSuspect?.()
    } catch {
      /* visibility must not block the stream */
    }
    if (handles >= 8) throw new Rejected("global_limit")
    handles++
    counted = true
  }
  const output = new ReadableStream<LanguageModelV3StreamPart>({
    start(value) {
      controller = value
      options.abort?.addEventListener("abort", abort, { once: true })
      if (options.abort?.aborted) abort()
    },
    async pull(ctrl) {
      try {
        while (!closed) {
          const next = await reader.read()
          if (closed) return
          if (next.done) {
            if (!suspect) {
              if (pending) ctrl.enqueue(pending)
              release()
              ctrl.close()
              return
            }
            if (!finish) throw new Rejected("missing_finish")
            if (finish.finishReason.unified !== "stop" && finish.finishReason.unified !== "tool-calls")
              throw new Rejected("truncated_finish")
            const protectedText = protectionPrefix + text
            const protocolMarkers = [...protectedText.matchAll(/<\/?｜DSML｜/g)].filter(
              (m) => m.index >= protectionPrefix.length,
            )
            const quotedOnly =
              !proseAmbiguous &&
              protocolMarkers.length > 0 &&
              protocolMarkers.every((m) => quoted(protectedText, m.index))
            if (held.some((part) => part.type === "tool-input-start" && !native.has(part.id)))
              throw new Rejected("invalid_arguments")
            if (nativeCount) {
              if (!priorNativeValid || nativeTrackingOverflow) throw new Rejected("invalid_native")
            } else if (!quotedOnly) {
              // Assistant prose is never a tool source, even if it resembles a
              // complete invoke. Only provider-native calls reach SDK validation.
              throw new Rejected("malformed_protocol")
            }
            if (text) ctrl.enqueue({ type: "text-delta", id: pending?.id ?? "dsml-recovery", delta: text })
            for (const part of held) ctrl.enqueue(part)
            if (!quotedOnly) audit("rejected", "native_preserved")
            release()
            ctrl.close()
            return
          }
          const part = next.value
          if (part.type === "text-delta") {
            const stop = loop.feed(part.delta)
            if (stop !== -1) {
              loopDetected = true
              text = (suspect ? text : (pending?.delta ?? "")) + part.delta.slice(0, stop)
              pending = { ...part, delta: "" }
              throw new Rejected("empty_vetting_loop")
            }
          }
          if (part.type === "error" && suspect) throw new Rejected("upstream_error")
          if (part.type === "tool-call") {
            nativeCount = Math.min(nativeCount + 1, 1_000_000)
            const idBytes = Buffer.byteLength(part.toolCallId)
            if (native.has(part.toolCallId)) priorNativeValid = false
            else if (
              idBytes > 128 ||
              native.size >= 256 ||
              retained + idBytes > GLOBAL_LIMIT ||
              bytes + idBytes > RESPONSE_LIMIT
            )
              nativeTrackingOverflow = true
            else {
              native.add(part.toolCallId)
              bytes += idBytes
              retained += idBytes
            }
            // The SDK owns JSON/schema validation. Keep only bounded identity
            // and declared-name/choice evidence for a later suspicious fragment.
            try {
              allowed(part.toolName, options.params)
            } catch (error) {
              priorNativeValid = false
              if (suspect) throw error
            }
            if (suspect && nativeTrackingOverflow) throw new Rejected("global_limit")
          }
          if (part.type === "text-delta") {
            if (suspect) {
              text += part.delta
              charge(Buffer.byteLength(part.delta))
              continue
            }
            const joined = (pending?.delta ?? "") + part.delta
            const marker = /<\/?｜DSML｜/.exec(joined)
            if (marker) {
              const prefix = joined.slice(0, marker.index)
              if (prefix) {
                observeProse(prefix)
                ctrl.enqueue({ ...part, delta: prefix })
              }
              protectionPrefix = (proseFence ? proseFence + "\n" : "") + proseLine
              text = joined.slice(marker.index)
              pending = { ...part, delta: "" }
              startSuspicion()
              charge(Buffer.byteLength(text))
              continue
            }
            // Retain one bounded marker lookbehind; ordinary text keeps flowing.
            const cut = Math.max(0, joined.length - 24)
            if (cut) {
              observeProse(joined.slice(0, cut))
              ctrl.enqueue({ ...part, delta: joined.slice(0, cut) })
            }
            pending = { ...part, delta: joined.slice(cut) }
            if (cut) return
            continue
          }
          if (suspect) {
            if (part.type.startsWith("reasoning") || part.type === "response-metadata" || part.type === "raw") {
              ctrl.enqueue(part)
              return
            }
            held.push(part)
            charge(Buffer.byteLength(JSON.stringify(part)))
            if (part.type === "finish") finish = part
            continue
          }
          if (pending && (part.type === "text-end" || part.type === "finish")) {
            observeProse(pending.delta)
            ctrl.enqueue(pending)
            pending = undefined
          }
          ctrl.enqueue(part)
          return
        }
      } catch (error) {
        if (closed) return
        if (!suspect && !loopDetected) {
          cancel()
          release()
          ctrl.error(error)
          return
        }
        const reason = error instanceof Rejected ? error.reason : "upstream_error"
        audit(reason.endsWith("limit") ? "overflow" : "rejected", reason)
        if ((suspect || loopDetected) && text)
          ctrl.enqueue({ type: "text-delta", id: pending?.id ?? "dsml-recovery", delta: text })
        const message = loopDetected ? EMPTY_VETTING_LOOP_MESSAGE : DSML_GUARD_MESSAGE
        try {
          options.onError?.(message)
        } catch {
          /* diagnostics must not mask the stream result */
        }
        ctrl.enqueue({ type: "error", error: new Error(message) })
        cancel()
        release()
        ctrl.close()
      }
    },
    cancel() {
      audit("aborted", "cancelled")
      cancel()
      release()
    },
  })
  return output
}

const DSML_CLOSING_MARKER = "</｜DSML｜"

// Stricter DSML-only guard used when recovery is disabled. It never promotes
// textual invocations; it only refuses a response that emits the closing marker.
export function guardDSMLStream(
  stream: ReadableStream<LanguageModelV3StreamPart>,
  onError?: (message: string) => void,
) {
  const reader = stream.getReader()
  let tail = ""
  let failed = false
  return new ReadableStream<LanguageModelV3StreamPart>({
    async pull(ctrl) {
      while (true) {
        const next = await reader.read()
        if (next.done) {
          ctrl.close()
          return
        }
        const part = next.value
        if (part.type === "stream-start") {
          tail = ""
          failed = false
        }
        if (part.type === "text-delta") {
          const text = tail + part.delta
          tail = text.slice(1 - DSML_CLOSING_MARKER.length)
          const malformed = !failed && text.includes(DSML_CLOSING_MARKER)
          if (malformed) failed = true
          ctrl.enqueue(part)
          if (malformed) {
            try {
              onError?.(DSML_GUARD_MESSAGE)
            } catch {
              /* diagnostics must not mask the stream result */
            }
            ctrl.enqueue({ type: "error", error: new Error(DSML_GUARD_MESSAGE) })
            ctrl.close()
            void reader.cancel().catch(() => {})
            return
          }
          return
        }
        if (part.type === "finish" && failed) {
          try {
            onError?.(DSML_GUARD_MESSAGE)
          } catch {
            /* diagnostics must not mask the stream result */
          }
          ctrl.enqueue({ type: "error", error: new Error(DSML_GUARD_MESSAGE) })
          ctrl.close()
          return
        }
        ctrl.enqueue(part)
        return
      }
    },
    cancel() {
      void reader.cancel().catch(() => {})
    },
  })
}
