export * as ExecuteTool from "./execute"

import {
  CodeMode,
  ExecuteInputSchema,
  ExecuteResultSchema,
  Tool,
  toolError,
  type ToolDefinition,
} from "@opencode-ai/codemode"
import { ToolOutput } from "@opencode-ai/llm"
import { Effect, Ref, Schema } from "effect"
import { definition, make, settle, type AnyTool } from "./tool"

const ExecuteFile = Schema.Struct({
  data: Schema.String,
  mime: Schema.String,
  name: Schema.optionalKey(Schema.String),
})

const ExecuteOutput = Schema.Struct({
  result: ExecuteResultSchema,
  files: Schema.Array(ExecuteFile),
})

type CollectedFiles = {
  readonly index: number
  readonly files: Array<typeof ExecuteFile.Type>
}

export interface Registration {
  readonly identity: object
  readonly tool: AnyTool
  readonly name: string
  readonly group?: string
}

export const create = (options: {
  readonly registrations: ReadonlyMap<string, Registration>
  readonly current: (name: string) => Registration | undefined
}) => {
  const runtime = (
    invoke: (name: string, registration: Registration, input: unknown) => Effect.Effect<unknown, unknown>,
  ) => {
    const tools: Record<string, ToolDefinition<never> | Record<string, ToolDefinition<never>>> = {}
    for (const [name, registration] of options.registrations) {
      const child = definition(name, registration.tool)
      const value = Tool.make({
        description: child.description,
        input: child.inputSchema,
        output: child.outputSchema,
        run: (input) => invoke(name, registration, input),
      })
      if (registration.group === undefined) {
        const path = registration.name
        if (Object.hasOwn(tools, path)) throw new TypeError(`Deferred tool namespace conflict: ${path}`)
        tools[path] = value
        continue
      }
      const path = registration.name
      const namespace = registration.group
      const group = tools[namespace]
      if (group && Tool.isDefinition(group)) throw new TypeError(`Deferred tool namespace conflict: ${namespace}`)
      if (group) {
        if (Object.hasOwn(group, path)) throw new TypeError(`Deferred tool namespace conflict: ${namespace}.${path}`)
        group[path] = value
        continue
      }
      const entries: Record<string, ToolDefinition<never>> = {}
      entries[path] = value
      tools[namespace] = entries
    }
    return CodeMode.make<typeof tools>({ tools })
  }
  const discovery = runtime(() => Effect.fail(toolError("Execute context is unavailable")))
  return make({
    description: discovery.instructions(),
    input: ExecuteInputSchema,
    output: ExecuteOutput,
    structured: ExecuteResultSchema,
    toStructuredOutput: ({ output }) => output.result,
    toModelOutput: ({ output }) => [
      { type: "text" as const, text: JSON.stringify(output.result) },
      ...output.files.map((file) => ({
        type: "file" as const,
        data: file.data,
        mime: file.mime,
        ...(file.name === undefined ? {} : { name: file.name }),
      })),
    ],
    execute: ({ code }, context) =>
      Effect.gen(function* () {
        const callIndex = yield* Ref.make(0)
        const files = yield* Ref.make<Array<CollectedFiles>>([])
        const result = yield* runtime((name, registration, input) =>
          Effect.gen(function* () {
            const index = yield* Ref.getAndUpdate(callIndex, (index) => index + 1)
            const current = options.current(name)
            if (!current || current.identity !== registration.identity)
              return yield* Effect.fail(toolError(`Stale tool call: ${name}`))
            const output = yield* settle(
              current.tool,
              { type: "tool-call", id: context.toolCallID, name, input },
              {
                sessionID: context.sessionID,
                agent: context.agent,
                assistantMessageID: context.assistantMessageID,
                toolCallID: context.toolCallID,
              },
            ).pipe(Effect.mapError((failure) => toolError(failure.message, failure)))
            const outputFileParts = outputFiles(output)
            if (outputFileParts.length > 0)
              yield* Ref.update(files, (items) => [...items, { index, files: outputFileParts }])
            return output.structured
          }),
        ).execute(code)
        return {
          result,
          files: (yield* Ref.get(files))
            .toSorted((left, right) => left.index - right.index)
            .flatMap((item) => item.files),
        }
      }),
  })
}

function outputFiles(output: ToolOutput): Array<typeof ExecuteFile.Type> {
  return output.content.flatMap((part) => {
    if (part.type !== "file") return []
    const prefix = `data:${part.mime};base64,`
    if (!part.uri.startsWith(prefix)) return []
    return [
      {
        data: part.uri.slice(prefix.length),
        mime: part.mime,
        ...(part.name === undefined ? {} : { name: part.name }),
      },
    ]
  })
}
