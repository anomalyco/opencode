import { Option } from "effect"
import { LLMEvent } from "../../schema/index.js"
import { decodeJson } from "../../utils/json.js"
import { isRecord } from "../shared.js"

/**
 * DeepSeek models describe tool calls with the DSML markup protocol. A serving
 * lane whose text→tool-call conversion fails (or is not configured) streams
 * that markup inside the chat `content` channel instead of structured
 * `tool_calls`, so the tool never runs (anomalyco/opencode#50206). This parser
 * recovers complete invokes into tool-call events and keeps leftover markup
 * fragments out of the text channel, where they would otherwise teach the
 * model to repeat the leak in later turns.
 *
 * Supported shapes (parameter values follow the DeepSeek encoding docs, and
 * both the fullwidth `｜` U+FF5C canonical delimiter and an ASCII `|` are
 * tolerated):
 *
 *   <｜DSML｜function_calls>   <｜DSML｜tool_calls>   <｜DSML｜ calls>
 *     <｜DSML｜invoke name="tool">
 *       <｜DSML｜parameter name="q" string="true">text</｜DSML｜parameter>
 *       <｜DSML｜parameter name="n" string="false">5</｜DSML｜parameter>
 *       { "or a bare JSON body": true }
 *     </｜DSML｜invoke>
 *   </｜DSML｜function_calls>
 *
 * A standalone `<｜DSML｜invoke ...>` without its wrapper, and a truncated
 * block at end of stream, still recover every complete invoke. Stray tags
 * (orphan closers, bare parameter tags) are stripped from the text because a
 * DSML special token is protocol output, never prose.
 */

/** DeepSeek's canonical delimiter is the fullwidth `｜` (U+FF5C); tolerate an ASCII `|`. */
const isDelimiter = (character: string) => character === "｜" || character === "|"

/** Any complete DSML tag, regardless of dialect. */
const TAG = /<\/?[｜|]DSML[｜|][^>]*>/
const WRAPPER_OPENER = /^<[｜|]DSML[｜|]\s*(?:calls|tool_calls|function_calls)>$/
const WRAPPER_CLOSER = /<\/[｜|]DSML[｜|]\s*(?:calls|tool_calls|function_calls)\s*>/
const INVOKE_OPENER = /^<[｜|]DSML[｜|]\s*invoke\b/
const INVOKE_CLOSER = /<\/[｜|]DSML[｜|]\s*invoke\s*>/
const INVOKE = /<[｜|]DSML[｜|]\s*invoke\s+name="([^"]*)"\s*>([\s\S]*?)<\/[｜|]DSML[｜|]\s*invoke\s*>/g
const PARAMETER =
  /<[｜|]DSML[｜|]\s*parameter\s+name="([^"]*)"(?:\s+string="(true|false)")?\s*>([\s\S]*?)<\/[｜|]DSML[｜|]\s*parameter\s*>/g

const decode = Option.liftThrowable(decodeJson)

export interface State {
  /** Text withheld from the text channel because it may be, or start, DSML markup. */
  readonly held: string
  /** Open markup region: a wrapped block or a standalone invoke, opener included. */
  readonly markup?: { readonly kind: "block" | "invoke"; readonly text: string }
  /** Number of tool calls recovered in this stream. */
  readonly recovered: number
}

export interface Output {
  /** Text safe to publish as ordinary message content. */
  readonly text?: string
  readonly events: ReadonlyArray<LLMEvent>
}

export const initial = (): State => ({ held: "", recovered: 0 })

/**
 * Recovered calls replay in session history across turns, so they need
 * globally unique ids rather than a per-stream counter.
 */
const callId = () => `tool_${crypto.randomUUID().replaceAll("-", "")}`

/**
 * Consume one content delta. Returns the text that may be published (markup
 * removed) plus the tool-call events recovered from any markup the delta
 * completed. Text that could still grow into a DSML tag is withheld until the
 * next delta decides.
 */
export const push = (state: State, text: string): [State, Output] => {
  const events: LLMEvent[] = []
  let out = ""
  let recovered = state.recovered
  let pending = (state.markup?.text ?? state.held) + text
  let kind: "block" | "invoke" | undefined = state.markup?.kind
  while (true) {
    if (kind !== undefined) {
      const closer = (kind === "block" ? WRAPPER_CLOSER : INVOKE_CLOSER).exec(pending)
      if (!closer) break
      // A standalone invoke region needs its own closer inside the payload for
      // the span regex to match; a wrapper closer is inert there.
      const found = recover(pending.slice(0, closer.index + closer[0].length))
      recovered += found.count
      events.push(...found.events)
      pending = pending.slice(closer.index + closer[0].length)
      kind = undefined
      continue
    }
    const tag = TAG.exec(pending)
    if (!tag) {
      const hold = holdbackLength(pending)
      out += pending.slice(0, pending.length - hold)
      pending = pending.slice(pending.length - hold)
      break
    }
    out += pending.slice(0, tag.index)
    const opener = WRAPPER_OPENER.test(tag[0]) ? "block" : INVOKE_OPENER.test(tag[0]) ? "invoke" : undefined
    // Stray tags (orphan closers, bare parameters) are markup noise: strip them.
    pending = pending.slice(tag.index + (opener === undefined ? tag[0].length : 0))
    if (opener === undefined) continue
    kind = opener
  }
  return [
    {
      held: kind === undefined ? pending : "",
      markup: kind === undefined ? undefined : { kind, text: pending },
      recovered,
    },
    { text: out === "" ? undefined : out, events },
  ]
}

/**
 * Flush at end of stream: recover complete invokes from a truncated markup
 * region and drop the rest — a partial tag or truncated call is protocol
 * noise, and republishing it would only teach the model to repeat the leak.
 * Without an open region the withheld tail is ordinary text that merely could
 * have started a tag, so it is published instead.
 */
export const flush = (state: State): [State, Output] => {
  if (state.markup !== undefined) {
    const found = recover(state.markup.text)
    return [{ held: "", recovered: state.recovered + found.count }, { events: found.events }]
  }
  if (/[｜|]DSML[｜|]/.test(state.held)) return [state, { events: [] }]
  return [state, { events: [], text: state.held === "" ? undefined : state.held }]
}

const recover = (text: string): { events: LLMEvent[]; count: number } => {
  const events: LLMEvent[] = []
  let count = 0
  for (const match of text.matchAll(INVOKE)) {
    const name = match[1]?.trim()
    if (!name) continue
    events.push(...toolEvents(callId(), name, match[2] ?? ""))
    count++
  }
  return { events, count }
}

const toolEvents = (id: string, name: string, body: string): LLMEvent[] => {
  const input = decodeArguments(body)
  if (input === undefined)
    return [LLMEvent.toolInputStart({ id, name }), LLMEvent.toolInputError({ id, name, raw: body })]
  return [
    LLMEvent.toolInputStart({ id, name }),
    LLMEvent.toolInputEnd({ id, name }),
    LLMEvent.toolCall({ id, name, input }),
  ]
}

const decodeArguments = (body: string): Record<string, unknown> | undefined => {
  const parameters = [...body.matchAll(PARAMETER)]
  if (parameters.length > 0) {
    const input: Record<string, unknown> = {}
    for (const parameter of parameters) {
      const key = parameter[1]?.trim()
      if (!key) continue
      input[key] = parameterValue(parameter[3] ?? "", parameter[2])
    }
    return input
  }
  // The direct-JSON dialect puts the whole argument object in the invoke body.
  const bare = Option.getOrUndefined(decode(body.trim()))
  return isRecord(bare) ? bare : undefined
}

const parameterValue = (value: string, flag: string | undefined): unknown => {
  if (flag === "true") return value
  // `string="false"` and an omitted flag carry JSON; keep the raw text when it
  // does not decode, because dropping the parameter would hand the tool call
  // no arguments at all.
  return Option.getOrElse(decode(value), () => value)
}

/** Longest suffix of `text` that could still grow into a DSML tag. */
const holdbackLength = (text: string): number => {
  for (let length = text.length; length > 0; length--) {
    if (isTagPrefix(text.slice(text.length - length))) return length
  }
  return 0
}

const isTagPrefix = (candidate: string): boolean => {
  let index = 1
  if (candidate[0] !== "<") return false
  if (candidate[index] === "/") index++
  if (index >= candidate.length) return true
  if (!isDelimiter(candidate[index])) return false
  index++
  for (const character of "DSML") {
    if (index >= candidate.length) return true
    if (candidate[index++] !== character) return false
  }
  // After the literal only a delimiter keeps a tag possible; everything up to
  // the closing bracket is free-form (attributes, whitespace).
  return index >= candidate.length || isDelimiter(candidate[index])
}

export * as DSML from "./dsml.js"
