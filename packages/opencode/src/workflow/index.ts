import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer, Context, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { Config } from "@/config/config"
import type { ConfigWorkflowV1 } from "@opencode-ai/core/v1/config/workflow"

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  steps: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      prompt: Schema.String,
      depends_on: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
      when: Schema.optional(Schema.String),
      agent: Schema.optional(Schema.String),
      model: Schema.optional(Schema.String),
      outputs: Schema.optional(
        Schema.Array(
          Schema.Struct({
            name: Schema.String,
            description: Schema.optional(Schema.String),
          }),
        ),
      ),
    }),
  ),
})
export type Info = Schema.Schema.Type<typeof Info>

export interface Interface {
  readonly get: (name: string) => Effect.Effect<Info | undefined>
  readonly list: () => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Workflow") {}

function toInfo(name: string, config: ConfigWorkflowV1.Info): Info {
  return {
    name: config.name ?? name,
    description: config.description,
    agent: config.agent,
    model: config.model,
    steps: config.steps,
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service

    const init = Effect.fn("Workflow.state")(function* () {
      const cfg = yield* config.get()
      const workflows: Record<string, Info> = {}
      for (const [name, workflow] of Object.entries(cfg.workflow ?? {})) {
        workflows[name] = toInfo(name, workflow)
      }
      return { workflows }
    })

    const state = yield* InstanceState.make(() => init())

    const get = Effect.fn("Workflow.get")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      return s.workflows[name]
    })

    const list = Effect.fn("Workflow.list")(function* () {
      const s = yield* InstanceState.get(state)
      return Object.values(s.workflows)
    })

    return Service.of({ get, list })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [Config.node] })

export * as Workflow from "."
