export * as SubagentGuidance from "./guidance"

import { Context, Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { Instructions } from "../instructions/index"
import { PermissionV2 } from "../permission"
import { AgentV2 } from "../agent"

const Summary = Schema.Struct({
  id: AgentV2.ID,
  description: Schema.String.pipe(Schema.optional),
})
type Summary = typeof Summary.Type

const entries = (agents: ReadonlyArray<Summary>) =>
  agents.flatMap((agent) => [
    "  <subagent>",
    `    <id>${agent.id}</id>`,
    ...(agent.description === undefined ? [] : [`    <description>${agent.description}</description>`]),
    "  </subagent>",
  ])

const render = (agents: ReadonlyArray<Summary>) =>
  [
    "Use the subagent tool to delegate work only to the agents listed below.",
    "<available_subagents>",
    ...entries(agents),
    "</available_subagents>",
  ].join("\n")

const update = (previous: ReadonlyArray<Summary>, current: ReadonlyArray<Summary>) => {
  const diff = Instructions.diffByKey(
    previous,
    current,
    (agent) => agent.id,
    (before, after) => before.description !== after.description,
  )
  if (diff.changed.length > 0 || (diff.added.length === 0 && diff.removed.length === 0))
    return [
      "The available subagents have changed. This list supersedes the previous available subagent list.",
      render(current),
    ].join("\n")
  return [
    ...(diff.added.length === 0
      ? []
      : ["New subagents are available in addition to those previously listed:", ...entries(diff.added)]),
    ...(diff.removed.length === 0
      ? []
      : [
          `The following subagent IDs are no longer available and must not be used: ${diff.removed.map((agent) => agent.id).join(", ")}.`,
        ]),
  ].join("\n")
}

export interface Interface {
  readonly load: (agent: AgentV2.Selection) => Effect.Effect<Instructions.Instructions>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SubagentGuidance") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const agents = yield* AgentV2.Service

    return Service.of({
      load: Effect.fn("SubagentGuidance.load")(function* (selection) {
        const selected = selection.info
        if (!selected) return Instructions.empty
        const available = (yield* agents.list())
          .filter(
            (agent) =>
              agent.mode !== "primary" &&
              !agent.hidden &&
              PermissionV2.evaluate("subagent", agent.id, selected.permissions).effect !== "deny",
          )
          .map((agent) => ({ id: agent.id, description: agent.description }))
          .toSorted((a, b) => a.id.localeCompare(b.id))
        return Instructions.make<ReadonlyArray<Summary>>({
          key: Instructions.Key.make("core/subagent-guidance"),
          codec: Schema.toCodecJson(Schema.Array(Summary)),
          read: Effect.succeed(available.length === 0 ? Instructions.removed : available),
          render: {
            initial: render,
            changed: update,
            removed: () => "Subagent guidance is no longer available. Do not use any previously listed subagent.",
          },
        })
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [AgentV2.node] })
