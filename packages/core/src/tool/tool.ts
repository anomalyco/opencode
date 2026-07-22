export * as Tool from "./tool"
export * from "@opencode-ai/plugin/v2/effect/tool"

import type { ToolContent } from "@opencode-ai/ai"
import {
  decodeInput,
  encodeOutput,
  type AnyTool,
  type Content,
  type Context,
  type Failure,
  type Metadata,
} from "@opencode-ai/plugin/v2/effect/tool"
import { Effect } from "effect"

/** Non-empty canonical model content. */
export type NonEmptyContent = readonly [ToolContent, ...ToolContent[]]

/**
 * The execution-local result of one tool call: the machine output for
 * Code Mode, canonical model content, and optional UI metadata. The typed
 * domain output never leaves this function.
 */
export type Executed = {
  readonly output: unknown
  readonly content: NonEmptyContent
  readonly metadata?: Metadata
}

export const execute = (
  tool: AnyTool,
  input: unknown,
  context: Context,
): Effect.Effect<Executed, Failure> =>
  Effect.gen(function* () {
    if ("jsonSchema" in tool) {
      const result = yield* tool.execute(input, context)
      return {
        output: result.output,
        content: nonEmpty(result.content.map(toModelContent)) ?? [textContent(stringify(result.output))],
      }
    }
    const decoded = yield* decodeInput(tool.input, input)
    const output = yield* tool.execute(decoded, context)
    const encoded = yield* encodeOutput(tool.output, output)
    const projected = tool.toModelOutput?.({ input: decoded, output })
    const metadata = tool.toMetadata?.({ input: decoded, output })
    return {
      output: encoded,
      content:
        projected === undefined
          ? [textContent(typeof encoded === "string" ? encoded : stringify(encoded))]
          : typeof projected === "string"
            ? [textContent(projected)]
            : (nonEmpty(projected.map(toModelContent)) ?? [textContent(stringify(encoded))]),
      ...(metadata === undefined ? {} : { metadata }),
    }
  })

export const toModelContent = (part: Content): ToolContent =>
  part.type === "text"
    ? { type: "text", text: part.text }
    : { type: "file", uri: `data:${part.mime};base64,${part.data}`, mime: part.mime, name: part.name }

export const nonEmpty = (content: ReadonlyArray<ToolContent>): NonEmptyContent | undefined =>
  content.length > 0 ? (content as NonEmptyContent) : undefined

const textContent = (text: string): ToolContent => ({ type: "text", text })

const stringify = (value: unknown) => {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}
