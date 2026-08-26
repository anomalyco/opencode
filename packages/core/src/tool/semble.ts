export * as SembleTool from "./semble"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import path from "path"
import { makeLocationNode } from "../effect/app-node"
import { Location } from "../location"
import { PermissionV2 } from "../permission"
import { PositiveInt, RelativePath } from "../schema"
import { Semble, SembleChunk } from "../semble"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "semble_search"

export const description = `Search codebase semantics and AST chunks using Semble (hybrid BM25 + Model2Vec static embeddings).

Returns precise, syntax-aware code chunks (functions, classes, methods) rather than reading entire files, significantly reducing context token consumption. Supports optional limit, maxTokens, or maxCharacters budgets to dynamically fit model context.`

export const Input = Schema.Struct({
  query: Schema.String.annotate({
    description: "Natural language query or code symbol to search for across the codebase",
  }),
  path: RelativePath.pipe(Schema.optional).annotate({
    description: "Relative directory or file path to narrow the search scope. Defaults to the active Location.",
  }),
  limit: Schema.optional(PositiveInt).annotate({
    description: "Maximum number of code chunks to return. If omitted, returns all relevant chunks within context budget.",
  }),
  maxTokens: Schema.optional(PositiveInt).annotate({
    description: "Maximum token budget for returned code chunks. Chunks are accumulated until this budget is reached.",
  }),
  maxCharacters: Schema.optional(PositiveInt).annotate({
    description: "Maximum character budget for returned code chunks. Chunks are accumulated until this budget is reached.",
  }),
})

export const Output = Schema.Array(SembleChunk)
type ModelOutput = typeof Output.Encoded

/** Format raw Semble code chunks into concise, token-efficient model context blocks. */
export const toModelOutput = (output: ModelOutput) => {
  if (output.length === 0) {
    return "No matching code chunks found."
  }

  const lines = [`Found ${output.length} relevant code chunk${output.length === 1 ? "" : "s"}:\n`]
  for (const chunk of output) {
    const typeLabel = chunk.type ? ` [${chunk.type}]` : ""
    lines.push(`--- ${chunk.file}:${chunk.startLine}-${chunk.endLine}${typeLabel} (relevance: ${chunk.score.toFixed(2)}) ---`)
    lines.push("```")
    lines.push(chunk.content.trim())
    lines.push("```\n")
  }
  return lines.join("\n")
}

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const semble = yield* Semble.Service
    const location = yield* Location.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description,
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text: toModelOutput(
                output.map((chunk) => ({
                  ...chunk,
                  file: path.relative(location.directory, path.resolve(location.directory, chunk.file)),
                })),
              ),
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: name,
                resources: [input.query],
                save: ["*"],
                metadata: {
                  root: ".",
                  path: input.path,
                  limit: input.limit,
                  maxTokens: input.maxTokens,
                  maxCharacters: input.maxCharacters,
                },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })

              const chunks = yield* semble.search({
                cwd: location.directory,
                query: input.query,
                limit: input.limit,
                maxTokens: input.maxTokens,
                maxCharacters: input.maxCharacters,
                path: input.path,
              })

              return chunks
            }).pipe(
              Effect.mapError(() => new ToolFailure({ message: `Unable to perform Semble search for '${input.query}'` })),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/semble",
  layer,
  deps: [ToolRegistry.node, Semble.node, Location.node, PermissionV2.node],
})
