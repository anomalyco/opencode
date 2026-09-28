// Streaming <think> splitter (ARCHITECTURE §11), applied by LlmGateway.stream when think_tags && reasoning_field "none".
// Only a partial-tag tail (< 8 chars) is buffered. A turn that ends inside <think> leaves `state.inside` true and closes
// its reasoning block with providerMetadata.oclite.unterminated = true, so the loop can retry with thinking off.
import { Stream } from "effect"
import { LLMEvent } from "@opencode-ai/llm"

export type ThinkState = { inside: boolean }
type Acc = { inside: boolean; tail: string; open?: "text" | "reasoning"; n: number; strip: boolean }
const [OPEN, CLOSE] = ["<think>", "</think>"]

export function splitThink<E, R>(stream: Stream.Stream<LLMEvent, E, R>, state: ThinkState = { inside: false }) {
  return stream.pipe(
    Stream.mapAccum(
      (): Acc => ({ inside: (state.inside = false), tail: "", n: 0, strip: false }),
      (acc, event): readonly [Acc, LLMEvent[]] => {
        if (event.type === "text-start") return [acc, []]
        if (event.type === "text-delta") {
          const result = scan(acc, acc.tail + event.text)
          state.inside = result[0].inside
          return result
        }
        if (event.type !== "text-end" && event.type !== "step-finish" && event.type !== "finish") return [acc, [event]]
        const [next, out] = flush(acc)
        return [next, event.type === "text-end" ? out : [...out, event]]
      },
      { onHalt: (acc) => flush(acc)[1] },
    ),
  )
}

function scan(acc: Acc, buf: string): readonly [Acc, LLMEvent[]] {
  const tag = acc.inside ? CLOSE : OPEN
  const at = buf.indexOf(tag)
  if (at === -1) {
    const sizes = Array.from({ length: Math.min(tag.length - 1, buf.length) }, (_, i) => i + 1)
    const keep = sizes.findLast((k) => buf.endsWith(tag.slice(0, k))) ?? 0
    const [next, out] = emit(acc, buf.slice(0, buf.length - keep))
    return [{ ...next, tail: buf.slice(buf.length - keep) }, out]
  }
  const [before, out] = emit(acc, buf.slice(0, at))
  const [closed, ended] = close(before)
  const [after, rest] = scan({ ...closed, inside: !acc.inside, tail: "", strip: acc.inside }, buf.slice(at + tag.length))
  return [after, [...out, ...ended, ...rest]]
}

function emit(acc: Acc, raw: string): readonly [Acc, LLMEvent[]] {
  const text = acc.strip && !acc.inside ? raw.trimStart() : raw
  if (text === "") return [acc, []]
  const kind = acc.inside ? "reasoning" : "text"
  const id = `${kind}-think-${acc.n}`
  const delta = kind === "text" ? LLMEvent.textDelta({ id, text }) : LLMEvent.reasoningDelta({ id, text })
  if (acc.open === kind) return [{ ...acc, strip: false }, [delta]]
  const [closed, ended] = close(acc)
  const start = kind === "text" ? LLMEvent.textStart({ id }) : LLMEvent.reasoningStart({ id })
  return [{ ...closed, open: kind, strip: false }, [...ended, start, delta]]
}

function close(acc: Acc, unterminated = false): readonly [Acc, LLMEvent[]] {
  if (!acc.open) return [acc, []]
  const id = `${acc.open}-think-${acc.n}`
  const meta = unterminated ? { providerMetadata: { oclite: { unterminated: true } } } : {}
  const end = acc.open === "text" ? LLMEvent.textEnd({ id }) : LLMEvent.reasoningEnd({ id, ...meta })
  return [{ ...acc, open: undefined, n: acc.n + 1 }, [end]]
}

function flush(acc: Acc): readonly [Acc, LLMEvent[]] {
  const [next, out] = emit(acc, acc.tail)
  const [closed, ended] = close({ ...next, tail: "" }, next.inside)
  return [closed, [...out, ...ended]]
}
