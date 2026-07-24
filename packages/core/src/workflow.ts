export * as Workflow from "./workflow"

import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import { Config } from "./config"
import { ConfigWorkflows } from "./config/workflows"
import { makeGlobalNode } from "./effect/app-node"
import { LocationServiceMap } from "./location-service-map"
import { SessionV2 } from "./session"
import { ApplicationTools } from "./tool/application-tools"
import { Tool } from "./tool/tool"
import { CouncilWorkflow } from "./workflow/council"
import { HeavyWorkflow } from "./workflow/heavy"
import { WorkflowRuntime } from "./workflow/runtime"
import { WorkflowSchema } from "./workflow/schema"

export interface Interface {
  readonly heavy: (
    input: { readonly task: string },
    context: Tool.Context,
  ) => Effect.Effect<WorkflowSchema.HeavyOutput, Tool.Failure>
  readonly council: (
    input: { readonly question: string },
    context: Tool.Context,
  ) => Effect.Effect<WorkflowSchema.CouncilOutput, Tool.Failure>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Workflow") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const applications = yield* ApplicationTools.Service
    const locations = yield* LocationServiceMap.Service
    const runtime = yield* WorkflowRuntime.Service
    const sessions = yield* SessionV2.Service
    const workflowLeases = new Map<string, ReturnType<typeof Semaphore.makeUnsafe>>()
    const workflowLease = (session: SessionV2.Info) => {
      const key = `${session.location.directory}\0${session.location.workspaceID ?? ""}`
      const current = workflowLeases.get(key)
      if (current) return current
      const created = Semaphore.makeUnsafe(1)
      workflowLeases.set(key, created)
      return created
    }

    const configuration = Effect.fn("Workflow.configuration")(function* (sessionID) {
      const session = yield* sessions.get(sessionID)
      const documents = yield* Config.Service.pipe(
        Effect.flatMap((config) => config.entries()),
        Effect.provide(locations.get(session.location)),
      )
      return {
        session,
        workflows: ConfigWorkflows.merge(
          documents.flatMap((document) => (document.type === "document" ? [document.info.workflows] : [])),
        ),
      }
    })

    const heavy = Effect.fn("Workflow.heavy")(function* (
      input: { readonly task: string },
      context: Tool.Context,
    ) {
      const configured = yield* configuration(context.sessionID).pipe(Effect.mapError(workflowFailure))
      const settings = heavySettings(configured.workflows?.heavy)
      if (!settings)
        return yield* Effect.fail(new Tool.Failure({ message: "Heavy is disabled by workflows.heavy configuration" }))
      return yield* workflowLease(configured.session).withPermit(
        HeavyWorkflow.run(input.task, configured.session, context, settings, runtime),
      ).pipe(Effect.mapError(workflowFailure))
    })

    const council = Effect.fn("Workflow.council")(function* (
      input: { readonly question: string },
      context: Tool.Context,
    ) {
      const configured = yield* configuration(context.sessionID).pipe(Effect.mapError(workflowFailure))
      const settings = councilSettings(configured.workflows?.council)
      if (!settings)
        return yield* Effect.fail(
          new Tool.Failure({ message: "Council is disabled by workflows.council configuration" }),
        )
      return yield* workflowLease(configured.session).withPermit(
        CouncilWorkflow.run(input.question, configured.session, context, settings, runtime),
      ).pipe(Effect.mapError(workflowFailure))
    })

    yield* applications.register({
      heavy_run: Tool.make({
        description:
          "Execute a recursive Heavy workflow. It may inspect, edit, run commands, and test through bounded child sessions.",
        input: Schema.Struct({ task: Schema.String }),
        output: WorkflowSchema.HeavyOutput,
        execute: heavy,
      }),
      council_run: Tool.make({
        description:
          "Convene a Council of independent perspectives, run structured debate, and synthesize consensus and disagreement.",
        input: Schema.Struct({ question: Schema.String }),
        output: WorkflowSchema.CouncilOutput,
        execute: council,
      }),
    })

    return Service.of({ heavy, council })
  }),
)

function workflowFailure(error: unknown) {
  return error instanceof Tool.Failure ? error : new Tool.Failure({ message: String(error) })
}

function heavySettings(input: boolean | ConfigWorkflows.Heavy | undefined): HeavyWorkflow.Settings | undefined {
  if (input === false || (typeof input === "object" && input.enabled === false)) return undefined
  const config = typeof input === "object" ? input : undefined
  const maxDepth = Math.min(config?.max_depth ?? 2, 5)
  return {
    maxDepth,
    tasksPerNode: Math.min(config?.tasks_per_node ?? 4, 8),
    maxNodes: Math.max(maxDepth + 1, Math.min(config?.max_nodes ?? 24, 64)),
    concurrency: Math.min(config?.concurrency ?? 4, 8),
    onFailure: config?.on_failure ?? "keep",
    models: config?.models ?? {},
  }
}

function councilSettings(input: boolean | ConfigWorkflows.Council | undefined): CouncilWorkflow.Settings | undefined {
  if (input === false || (typeof input === "object" && input.enabled === false)) return undefined
  const config = typeof input === "object" ? input : undefined
  return {
    perspectives: Math.max(2, Math.min(config?.perspectives ?? 3, 8)),
    concurrency: Math.min(config?.concurrency ?? 4, 8),
    debate: {
      mode: config?.debate?.mode ?? "auto",
      topics: Math.min(config?.debate?.topics ?? 1, 4),
      participants: Math.max(2, Math.min(config?.debate?.participants ?? 3, 6)),
      rounds: Math.min(config?.debate?.rounds ?? 2, 4),
    },
    models: config?.models ?? {},
  }
}

export const node = makeGlobalNode({
  service: Service,
  layer: layer.pipe(Layer.orDie),
  deps: [ApplicationTools.node, LocationServiceMap.node, SessionV2.node, WorkflowRuntime.node],
})
