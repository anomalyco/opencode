import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap, locationServiceMapLayer } from "@opencode-ai/core/location-services"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { InteractiveTool } from "@opencode-ai/core/tool/interactive"
import { InteractiveJob } from "@opencode-ai/core/tool/interactive/job"
import { InteractiveJobs } from "@opencode-ai/core/tool/interactive/store"
import path from "path"
import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { assertExternalDirectoryEffect } from "./external-directory"
import * as Tool from "./tool"

/**
 * V1 bridge for the interactive tool family (specs/tool-interactive.md): thin
 * V1 `Tool.Def` wrappers over the V2 Location-scoped `InteractiveJobs` store —
 * the same store, spool, PTY runtime, ledger, and governor the V2 session path
 * uses. Nothing about job execution is duplicated here: each tool decodes with
 * the shared core input schema, asks permission (start only, spec R26/R27),
 * calls one store method, and encodes the result with the shared R4 formatter.
 *
 * Auto-feed (spec R15) needs no bridge logic: every settled interactive result
 * is an ordinary V1 tool result, and the V1 loop (src/session/prompt.ts) always
 * starts the next provider turn after a tool-call turn, so the model consumes
 * each result without any continuation flag.
 *
 * The store is Location-scoped; tools reach it through the LocationServiceMap
 * bound to the instance directory (same pattern as Agent/SystemPrompt).
 */
const defineInteractive = <Input extends Schema.Decoder<unknown>>(
  id: (typeof InteractiveTool.names)[number],
  definition: {
    parameters: Input
    title: (input: Schema.Schema.Type<Input>) => string
    run: (
      input: Schema.Schema.Type<Input>,
      ctx: Tool.Context,
    ) => Effect.Effect<InteractiveJob.Result, InteractiveJobs.StoreError, InteractiveJobs.Service>
  },
) =>
  Tool.define(
    id,
    Effect.gen(function* () {
      const locations = yield* LocationServiceMap.Service
      return {
        description: InteractiveTool.description(id),
        parameters: definition.parameters,
        execute: (input: Schema.Schema.Type<Input>, ctx: Tool.Context) =>
          Effect.gen(function* () {
            const instance = yield* InstanceState.context
            const ref = Location.Ref.make({ directory: AbsolutePath.make(instance.directory) })
            const result = yield* definition.run(input, ctx).pipe(
              Effect.provide(locations.get(ref)),
              // store errors are model-facing prose (spec R8/R12); surface them
              // as ordinary tool errors like the other V1 tools do
              Effect.mapError((error) => new Error(error.message)),
              Effect.orDie,
            )
            return {
              title: definition.title(input),
              // self-bounded result (spec R25/I5): always declare truncated +
              // outputPath so the registry's generic truncation no-ops
              metadata: {
                jobID: result.jobID,
                status: result.status,
                exchanges: result.exchanges,
                exchangesRemaining: result.exchangesRemaining,
                truncated: result.truncated,
                outputPath: result.outputPath,
                ...(result.exit !== undefined ? { exit: result.exit } : {}),
                ...(result.reason !== undefined ? { reason: result.reason } : {}),
              },
              output: InteractiveTool.toModelOutput({ output: result })
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("\n"),
            }
          }),
      }
    }),
  )

export const InteractiveStartTool = defineInteractive(InteractiveTool.START, {
  parameters: InteractiveTool.StartInput,
  title: (input) => input.command,
  run: (input, ctx) =>
    Effect.gen(function* () {
      const instance = yield* InstanceState.context
      const workdir = input.workdir ? path.resolve(instance.directory, input.workdir) : undefined
      // only start passes permission asserts (spec R26/R27/I7): the external
      // workdir boundary first, then the full command text
      if (workdir) yield* assertExternalDirectoryEffect(ctx, workdir, { kind: "directory" })
      yield* ctx.ask({
        permission: InteractiveTool.PERMISSION_KEY,
        patterns: [input.command],
        always: [input.command],
        metadata: { command: input.command },
      })
      const jobs = yield* InteractiveJobs.Service
      return yield* jobs.start({
        sessionID: ctx.sessionID,
        command: input.command,
        workdir,
        timeout: input.timeout,
      })
    }),
})

export const InteractiveWriteTool = defineInteractive(InteractiveTool.WRITE, {
  parameters: InteractiveTool.WriteInput,
  title: (input) => input.input,
  run: (input, ctx) =>
    Effect.gen(function* () {
      const jobs = yield* InteractiveJobs.Service
      return yield* jobs.write({
        sessionID: ctx.sessionID,
        jobID: input.jobID,
        input: input.input,
        eof: input.eof,
      })
    }),
})

export const InteractiveWaitTool = defineInteractive(InteractiveTool.WAIT, {
  parameters: InteractiveTool.WaitInput,
  title: (input) => input.jobID,
  run: (input, ctx) =>
    Effect.gen(function* () {
      const jobs = yield* InteractiveJobs.Service
      return yield* jobs.wait({
        sessionID: ctx.sessionID,
        jobID: input.jobID,
        timeout: input.timeout,
      })
    }),
})

export const InteractiveCancelTool = defineInteractive(InteractiveTool.CANCEL, {
  parameters: InteractiveTool.CancelInput,
  title: (input) => input.jobID,
  run: (input, ctx) =>
    Effect.gen(function* () {
      const jobs = yield* InteractiveJobs.Service
      return yield* jobs.cancel({
        sessionID: ctx.sessionID,
        jobID: input.jobID,
      })
    }),
})

export const locationServiceMapNode = LayerNode.make({
  service: LocationServiceMap.Service,
  layer: locationServiceMapLayer,
  deps: [],
})
