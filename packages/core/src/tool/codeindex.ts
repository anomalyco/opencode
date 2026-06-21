export * as CodeIndexTool from "./codeindex"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { Service as CodeIndexService } from "../memory/index-service"
import { Location } from "../location"
import path from "path"

export const indexName = "zero_index_project"
export const searchName = "zero_semantic_search_code"

export const IndexInput = Schema.Struct({
  directory: Schema.optional(Schema.String).annotate({
    description: "The project directory to index recursively. Defaults to the active Location.",
  }),
})

export const IndexOutput = Schema.Struct({
  success: Schema.Boolean,
  filesIndexed: Schema.Number,
  chunksCreated: Schema.Number,
})

export const SearchInput = Schema.Struct({
  query: Schema.String.annotate({ description: "The search query to match against the codebase semantically" }),
  limit: Schema.optional(Schema.Number).annotate({ description: "Max number of code blocks to retrieve (default: 5)" }),
})

export const SearchOutput = Schema.Struct({
  results: Schema.Array(
    Schema.Struct({
      filepath: Schema.String,
      startLine: Schema.Number,
      endLine: Schema.Number,
      content: Schema.String,
    })
  ),
})

export const indexLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const indexService = yield* CodeIndexService
    const permission = yield* PermissionV2.Service
    const location = yield* Location.Service

    yield* tools
      .register({
        [indexName]: Tool.make({
          description: "Index the project codebase files recursively for semantic search.",
          input: IndexInput,
          output: IndexOutput,
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text: `Index finished: files=${output.filesIndexed}, chunks=${output.chunksCreated}`,
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: indexName,
                resources: ["*"],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })

              const targetDir = input.directory
                ? path.isAbsolute(input.directory)
                  ? input.directory
                  : path.resolve(location.directory, input.directory)
                : location.directory

              const result = yield* indexService.indexProject(targetDir)
              return {
                success: true,
                filesIndexed: result.filesIndexed,
                chunksCreated: result.chunksCreated,
              }
            }).pipe(
              Effect.mapError((err) => (err instanceof ToolFailure ? err : new ToolFailure({ message: "Unable to index codebase" })))
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const searchLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const indexService = yield* CodeIndexService
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [searchName]: Tool.make({
          description: "Perform a semantic vector search across the indexed codebase to find relevant code snippets.",
          input: SearchInput,
          output: SearchOutput,
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text: JSON.stringify(output.results, null, 2),
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: searchName,
                resources: ["*"],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })

              const entries = yield* indexService.searchCode(input.query, input.limit ?? 5)
              const results = entries.map((e) => ({
                filepath: e.filepath,
                startLine: e.metadata.startLine,
                endLine: e.metadata.endLine,
                content: e.content,
              }))

              return { results }
            }).pipe(
              Effect.mapError((err) => (err instanceof ToolFailure ? err : new ToolFailure({ message: "Unable to search codebase" })))
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const layer = Layer.merge(indexLayer, searchLayer)
