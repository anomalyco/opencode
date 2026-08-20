import { EventV2 } from "@opencode-ai/core/event"
import { EventExact } from "@opencode-ai/core/event-exact"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Context, Effect, Exit, Layer } from "effect"
import { isDeepStrictEqual } from "node:util"
import { MessageID, PartID, SessionID } from "../schema"
import type { SessionClosureModel as Model } from "./model"
import type { SessionClosurePorts as Ports } from "./ports"
import { CLOSURE_RECORD_METADATA_KEY } from "@opencode-ai/core/session/closure-record"

export interface Interface extends Ports.RecordCapability {}

/** Publishes a frozen pair through the projector while the opaque EventExact token stays in core. */
export class Service extends Context.Service<Service, Interface>()("@opencode/SessionClosureRecord") {}

const target = (fact: Model.FactView) => {
  if (fact.type === "self") return fact.subject
  if (fact.type === "edge") return fact.owner
  return fact.root
}

const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0)

/** Independent ordering implementation so release verification does not trust the freeze sorter. */
const requiredOrder = (values: readonly Model.FactView[]) => {
  const output: Model.FactView[] = []
  const seen = new Set<Model.FactID>()
  const active = new Set<Model.SessionID>()
  const edges = values
    .filter((item): item is Extract<Model.FactView, { readonly type: "edge" }> => item.type === "edge")
    .toSorted((left, right) => {
      const child = compare(String(left.child), String(right.child))
      if (child !== 0) return child
      return compare(String(left.taskPart ?? left.edge ?? left.key), String(right.taskPart ?? right.edge ?? right.key))
    })
  const append = (item: Model.FactView) => {
    if (seen.has(item.id)) return
    seen.add(item.id)
    output.push(item)
  }
  const walk = (subject: Model.SessionID) => {
    if (active.has(subject)) return
    active.add(subject)
    edges
      .filter((item) => item.owner === subject)
      .forEach((item) => {
        walk(item.child)
        append(item)
      })
    values
      .filter(
        (item): item is Extract<Model.FactView, { readonly type: "self" }> =>
          item.type === "self" && item.subject === subject,
      )
      .toSorted((left, right) => compare(left.key, right.key))
      .forEach(append)
    active.delete(subject)
  }
  const roots = values
    .filter((item): item is Extract<Model.FactView, { readonly type: "root" }> => item.type === "root")
    .toSorted((left, right) => compare(String(left.root), String(right.root)))
  roots.forEach((item) => {
    walk(item.root)
    append(item)
  })
  const children = new Set(edges.map((item) => item.child))
  edges
    .map((item) => item.owner)
    .filter((item, index, owners) => !children.has(item) && owners.indexOf(item) === index)
    .forEach(walk)
  values.toSorted((left, right) => compare(left.key, right.key)).forEach(append)
  return output
}

const frozen = (command: Extract<Ports.ExternalCommand, { readonly type: "pair.write" }>, pair: Model.FrozenPair) =>
  command.candidate.freezeOwner === pair.freezeOwner &&
  command.candidate.generation === pair.generation &&
  command.candidate.fact === pair.fact.id &&
  pair.messageBytes ===
    JSON.stringify({
      id: pair.message,
      event: pair.messageEvent,
      time: pair.messageTime,
      synthetic: true,
      identity: pair.identity,
    }) &&
  pair.partBytes ===
    JSON.stringify({
      id: pair.part,
      event: pair.partEvent,
      time: pair.partTime,
      synthetic: true,
      text: pair.text,
      metadata: pair.metadata,
    })

const message = (pair: Model.FrozenPair): SessionV1.User => ({
  id: MessageID.make(String(pair.message)),
  sessionID: SessionID.make(String(target(pair.fact))),
  role: "user",
  time: { created: pair.messageTime },
  agent: pair.identity.agent,
  model: {
    providerID: ProviderV2.ID.make(pair.identity.model.providerID),
    modelID: ModelV2.ID.make(pair.identity.model.modelID),
    ...(pair.identity.model.variant.present ? { variant: pair.identity.model.variant.value } : {}),
  },
})

const part = (pair: Model.FrozenPair, info: SessionV1.User): SessionV1.TextPart => ({
  id: PartID.make(String(pair.part)),
  sessionID: info.sessionID,
  messageID: info.id,
  type: "text",
  text: pair.text,
  synthetic: true,
  metadata: { [CLOSURE_RECORD_METADATA_KEY]: pair.metadata },
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const projector = yield* SessionProjector.ClosureRecordService

    return Service.of({
      write: (input) => {
        const command = input.command
        const pair = input.record
        if (!frozen(command, pair)) return Effect.succeed({ message: "failed", part: "absent" } as const)

        const info = message(pair)
        const projectedPart = part(pair, info)
        const authority = (kind: "message" | "part"): EventExact.Authority => ({
          instance: String(command.instance),
          operation: String(command.candidate.operation),
          repair: String(command.candidate.repair),
          operationRevision: command.candidate.revision,
          freezeOwner: String(command.candidate.freezeOwner),
          generation: command.candidate.generation,
          fact: String(command.candidate.fact),
          pair: String(command.permit),
          kind,
        })

        return Effect.gen(function* () {
          const message = yield* projector
            .message({
              authority: authority("message"),
              eventID: EventV2.ID.make(String(pair.messageEvent)),
              info,
            })
            .pipe(Effect.exit)
          if (Exit.isFailure(message)) return { message: "failed", part: "absent" } as const

          const projected = yield* projector
            .part({
              authority: authority("part"),
              eventID: EventV2.ID.make(String(pair.partEvent)),
              part: projectedPart,
              time: pair.partTime,
            })
            .pipe(Effect.exit)
          if (Exit.isFailure(projected)) return { message: "verified", part: "failed" } as const
          return { message: "verified", part: "verified" } as const
        })
      },
      verify: (input) => {
        const command = input.command
        const operation = input.operation
        const generations = operation.generations.toSorted((left, right) => {
          if (left.freezeSequence !== right.freezeSequence) return left.freezeSequence < right.freezeSequence ? -1 : 1
          const owner = compare(String(left.freezeOwner), String(right.freezeOwner))
          return owner === 0 ? left.generation - right.generation : owner
        })
        const checkGenerations = operation.generations
          .map((item) => ({ freezeOwner: item.freezeOwner, generation: item.generation }))
          .toSorted((left, right) => {
            const generation = left.generation - right.generation
            return generation === 0 ? compare(String(left.freezeOwner), String(right.freezeOwner)) : generation
          })
        const orderedFacts = requiredOrder(operation.facts)
        const records = generations.flatMap((item) => item.records)
        const represented = records.map((item) => item.fact.id)
        /**
         * A no-work operation has no facts, generation, or rows. Emptiness remains an exact
         * correspondence: no facts requires no generations, rather than exempting either side.
         */
        const empty = orderedFacts.length === 0
        const exact =
          command.operation === operation.id &&
          command.repair === operation.repair &&
          command.revision === operation.revision &&
          isDeepStrictEqual(command.claims, [...new Set(operation.claims)]) &&
          isDeepStrictEqual(command.aliases, [...new Set(operation.aliases)]) &&
          isDeepStrictEqual(command.generations, checkGenerations) &&
          isDeepStrictEqual(
            command.facts,
            orderedFacts.map((item) => item.id),
          ) &&
          isDeepStrictEqual(command.views, operation.views.map((item) => item.id).toSorted(compare)) &&
          operation.successors.length === 0 &&
          (empty ? generations.length === 0 : generations.length > 0) &&
          generations.every(
            (item) =>
              !item.failure &&
              item.inFlight.length === 0 &&
              item.committedPrefix === item.facts.length &&
              isDeepStrictEqual(item.verified, item.facts) &&
              isDeepStrictEqual(
                item.records.map((record) => record.fact.id),
                item.facts,
              ) &&
              isDeepStrictEqual(
                requiredOrder(item.records.map((record) => record.fact)).map((fact) => fact.id),
                item.facts,
              ) &&
              item.records.every((record, index) => {
                const previous = item.records[index - 1]
                return !previous || record.messageTime > previous.partTime
              }) &&
              item.records.every(
                (record) => record.freezeOwner === item.freezeOwner && record.generation === item.generation,
              ),
          ) &&
          new Set(represented).size === represented.length &&
          isDeepStrictEqual(
            [...represented].toSorted(compare),
            operation.facts.map((item) => item.id).toSorted(compare),
          ) &&
          operation.views.every((view) => {
            if (view.facts.length === 0) return true
            const root = operation.facts.find((fact) => fact.type === "root" && fact.root === view.root)
            return (
              root !== undefined &&
              view.facts.includes(root.id) &&
              view.facts.every((fact) => represented.includes(fact))
            )
          })
        if (!exact) return Effect.succeed("failed" as const)

        const physical = records.map((record) => {
          const info = message(record)
          return {
            messageEvent: EventV2.ID.make(String(record.messageEvent)),
            partEvent: EventV2.ID.make(String(record.partEvent)),
            info,
            part: part(record, info),
            partTime: record.partTime,
          }
        })
        // A no-work operation has no physical rows to read back.
        if (empty) return Effect.succeed("verified" as const)
        return records.length === 0
          ? Effect.succeed("failed" as const)
          : projector.verify({ records: physical }).pipe(
              Effect.exit,
              Effect.map((result) => (Exit.isSuccess(result) ? "verified" : "failed")),
            )
      },
    })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [SessionProjector.node] })

export * as SessionClosureRecord from "./record"
