export * as Tool from "./tool"
export * from "@opencode-ai/plugin/v2/effect/tool"

import type { ToolContent } from "@opencode-ai/ai"
import {
  decodeInput,
  encodeOutput,
  type Any,
  type Content,
  type Context,
  Failure,
  type Metadata,
} from "@opencode-ai/plugin/v2/effect/tool"
import { Effect, Schema } from "effect"

/** Non-empty canonical model content. */
export type NonEmptyContent = readonly [ToolContent, ...ToolContent[]]

/**
 * The execution-local result of one tool call: the machine output for
 * Code Mode, canonical model content, and optional UI metadata. The typed
 * domain output never leaves this function.
 */
export type Execution = {
  readonly output?: unknown
  readonly content: NonEmptyContent
  readonly metadata?: Metadata
}

export const execute = (tool: Any, input: unknown, context: Context): Effect.Effect<Execution, Failure> =>
  Effect.gen(function* () {
    const decoded = yield* decodeInput(tool.input, input)
    const result = yield* tool.execute(decoded, context)
    if (tool.output === undefined) {
      if ("output" in result) return yield* Effect.die("Tool result declared output without an output schema")
      return {
        content: contentFrom(result.content),
        ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
      }
    }
    if (!("output" in result))
      return yield* Effect.fail(new Failure({ message: "Tool did not return its declared output" }))
    const encoded = yield* encodeOutput(tool.output, result.output)
    return {
      output: encoded,
      content: contentFrom(result.content, encoded),
      ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
    }
  })

/** Model content from the tool's projection, falling back to the stringified encoded output. */
const contentFrom = (projected: string | ReadonlyArray<Content> | undefined, encoded?: unknown): NonEmptyContent => {
  if (typeof projected === "string") return [textContent(projected)]
  if (projected !== undefined) {
    const mapped = nonEmpty(projected.map(toModelContent))
    if (mapped !== undefined) return mapped
  }
  return [textContent(stringify(encoded))]
}

export const toModelContent = (part: Content): ToolContent =>
  part.type === "text"
    ? { type: "text", text: part.text }
    : { type: "file", uri: `data:${part.mime};base64,${part.data}`, mime: part.mime, name: part.name }

export const nonEmpty = (content: ReadonlyArray<ToolContent>): NonEmptyContent | undefined =>
  content.length > 0 ? (content as NonEmptyContent) : undefined

const textContent = (text: string): ToolContent => ({ type: "text", text })

/** Human-readable text for an arbitrary value; strings pass through unchanged. */
export const stringify = (value: unknown) => {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

const MetadataSchema = Schema.Record(Schema.String, Schema.Json)

/** Defensive boundary: non-JSON or oversized metadata is dropped, never failing the producing call. */
export const jsonMetadata = (value: unknown, maxBytes?: number): Metadata | undefined => {
  if (value === undefined) return undefined
  const decoded = Schema.decodeUnknownOption(MetadataSchema)(value)
  if (decoded._tag === "None") return undefined
  if (maxBytes !== undefined && Buffer.byteLength(JSON.stringify(decoded.value), "utf-8") > maxBytes) return undefined
  return decoded.value
}
