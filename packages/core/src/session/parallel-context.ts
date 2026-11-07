export * as SessionParallelContext from "./parallel-context.js"

import { Context, Effect, Layer } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { SessionCompaction } from "./compaction.js"
import { SessionContext } from "./context.js"
import { Config } from "../config.js"
import { Model } from "../model.js"
import { Session } from "@opencode/schema/session"
import { SessionStore } from "./store.js"

export type ChildAgent = {
  readonly sessionID: Session.ID
  readonly agent: string
  readonly description: string
}

export interface ContextBudget {
  readonly total: number
  readonly limit: number
  readonly exceeded: boolean
  readonly nearLimit: boolean
  readonly parentTokens: number
  readonly childrenTokens: number
  readonly children: ReadonlyArray<ChildAgent>
}

export interface Interface {
  readonly getBudget: (parentID: Session.ID) => Effect.Effect<ContextBudget>
  readonly canSpawn: (parentID: Session.ID, estimatedChildTokens: number) => Effect.Effect<boolean>
  readonly registerChild: (agent: ChildAgent) => Effect.Effect<void>
  readonly unregisterChild: (sessionID: Session.ID) => Effect.Effect<void>
  readonly shouldCompact: Effect.Effect<boolean>
  readonly updateChildTokens: (sessionID: Session.ID, tokenCount: number) => Effect.Effect<void>
  readonly invalidateChildren: (parentID: Session.ID) => Effect.Effect<void>
  /** Reserve a queued spawn slot. Returns true if queued, false if queue is full. */
  readonly reserveSpawn: (sessionID: Session.ID, parentID: Session.ID) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionParallelContext") {}

const NEAR_LIMIT_SHARE = 0.8
const DEFAULT_CONTEXT_SHARE = 0.8
const CHILD_DEFAULT_TOKENS = 8_000
const DEFAULT_MAX_CONCURRENT_DEFAULT = 5
const DEFAULT_MAX_QUEUE_DEFAULT = 10

type LatticeEntry = {
  ownTokens: number
  cachedChildrenTokens: number
  running: Map<Session.ID, { agent: ChildAgent; tokens: number }>
  pending: number
}

const lattice = new Map<Session.ID, LatticeEntry>()

const findEntry = (parentID: Session.ID): LatticeEntry => {
  let entry = lattice.get(parentID)
  if (!entry) {
    entry = { ownTokens: 0, cachedChildrenTokens: 0, running: new Map(), pending: 0 }
    lattice.set(parentID, entry)
  }
  return entry
}

const setOwnTokens = (parentID: Session.ID, tokens: number): void => {
  findEntry(parentID).ownTokens = tokens
}

const recalcCachedChildrenTokens = (parentID: Session.ID): number => {
  const entry = lattice.get(parentID)
  if (!entry) return 0
  const total = [...entry.running.values()].reduce((sum, child) => sum + child.tokens, 0)
  entry.cachedChildrenTokens = total
  return total
}

const doUnregisterChild = (sessionID: Session.ID): void => {
  const toDelete: Session.ID[] = []
  for (const [key, entry] of lattice) {
    if (entry.running.has(sessionID)) {
      entry.running.delete(sessionID)
      if (entry.pending > 0) {
        entry.pending--
        const nextPending = [...entry.running.keys()].at(0)
        if (nextPending) {
          const child = entry.running.get(nextPending)
          if (child) {
            child.tokens = CHILD_DEFAULT_TOKENS
          }
        }
      }
    }
    if (entry.running.size === 0 && entry.pending === 0) {
      toDelete.push(key)
    }
  }
  for (const key of toDelete) {
    lattice.delete(key)
  }
}

const doUpdateChildTokens = (sessionID: Session.ID, tokenCount: number): void => {
  for (const [parentID, entry] of lattice) {
    const child = entry.running.get(sessionID)
    if (child) {
      child.tokens = tokenCount
      recalcCachedChildrenTokens(parentID)
      return
    }
  }
}

const doInvalidateChildren = (parentID: Session.ID): void => {
  const entry = lattice.get(parentID)
  if (entry) {
    entry.cachedChildrenTokens = 0
  }
}

const doReserveSpawn = (sessionID: Session.ID, parentID: Session.ID): boolean => {
  const entry = findEntry(parentID)
  entry.pending++
  return true
}

const emptyBudget: ContextBudget = {
  total: 0,
  limit: 0,
  exceeded: false,
  nearLimit: false,
  parentTokens: 0,
  childrenTokens: 0,
  children: [],
}

const makeBudget = (
  parentTokens: number,
  childrenTokens: number,
  ceiling: number,
  agentList: ChildAgent[],
): ContextBudget => {
  const total = parentTokens + childrenTokens
  const exceeded = ceiling > 0 && total > ceiling
  const nearLimit = ceiling > 0 && total >= ceiling * NEAR_LIMIT_SHARE
  return { total, limit: ceiling, exceeded, nearLimit, parentTokens, childrenTokens, children: agentList }
}

export const make: Effect.Effect<
  Interface,
  never,
  SessionStore.Service | SessionContext.Service | Model.Service | Config.Service
> = Effect.gen(function* () {
  const store = yield* SessionStore.Service
  const context = yield* SessionContext.Service
  const config = yield* Config.Service
  const entries = yield* config.entries()

  const getMaxConcurrent = () => {
    const value = Config.latest(entries, "experimental")?.max_concurrent_agents
    return typeof value === "number" && value > 0 ? value : DEFAULT_MAX_CONCURRENT_DEFAULT
  }

  const getMaxQueue = () => {
    const value = Config.latest(entries, "experimental")?.subagent_queue_size
    return typeof value === "number" && value >= 0 ? value : DEFAULT_MAX_QUEUE_DEFAULT
  }

  const estimateSessionTokens = (sessionID: Session.ID): Effect.Effect<number, never> =>
    Effect.gen(function* () {
      const session = yield* store.get(sessionID)
      if (!session) return CHILD_DEFAULT_TOKENS
      const selection = yield* context.select(sessionID)
      const loaded = yield* context.load(selection)
      return SessionCompaction.estimateContext(loaded)
    }).pipe(Effect.catch(() => Effect.succeed(CHILD_DEFAULT_TOKENS)))

  const getBudget = (parentID: Session.ID): Effect.Effect<ContextBudget, never> =>
    Effect.gen(function* () {
      const entry = lattice.get(parentID)
      if (!entry || (entry.running.size === 0 && entry.pending === 0)) return emptyBudget

      const parentSession = yield* store.get(parentID)
      if (!parentSession) return emptyBudget

      const model = yield* context.resolveModel(parentSession)
      const ceiling = Math.floor(model.limit.context * DEFAULT_CONTEXT_SHARE)

      let parentTokens = entry.ownTokens
      if (parentTokens === 0) {
        parentTokens = yield* estimateSessionTokens(parentID)
        setOwnTokens(parentID, parentTokens)
      }

      const agentList: ChildAgent[] = []
      const childrenTokens = entry.cachedChildrenTokens

      for (const [_sessionID, child] of entry.running) {
        agentList.push(child.agent)
      }

      return makeBudget(parentTokens, childrenTokens, ceiling, agentList)
    }).pipe(Effect.catch(() => Effect.succeed(emptyBudget)))

  const canSpawn = (parentID: Session.ID, estimatedChildTokens: number): Effect.Effect<boolean, never> =>
    Effect.gen(function* () {
      const entry = lattice.get(parentID)
      if (!entry) return true

      const maxConcurrent = getMaxConcurrent()
      const maxQueue = getMaxQueue()
      if (entry.running.size + entry.pending >= maxConcurrent + maxQueue) return false

      const budget = yield* getBudget(parentID)
      if (budget.limit <= 0) return true
      return budget.total + estimatedChildTokens <= budget.limit
    }).pipe(Effect.catch(() => Effect.succeed(true)))

  const shouldCompact: Effect.Effect<boolean, never> = Effect.gen(function* () {
    for (const [parentID, entry] of lattice) {
      if (entry.running.size > 0 || entry.pending > 0) {
        const budget = yield* getBudget(parentID)
        return budget.nearLimit || budget.exceeded
      }
    }
    return false
  }).pipe(Effect.catch(() => Effect.succeed(false)))

  return Service.of({
    getBudget: (parentID: Session.ID) => getBudget(parentID),
    canSpawn: (parentID: Session.ID, estimatedChildTokens: number) => canSpawn(parentID, estimatedChildTokens),
    registerChild: (agent: ChildAgent) =>
      Effect.gen(function* () {
        const session = yield* store.get(agent.sessionID)
        const parentID = session?.parentID
        if (parentID) {
          const entry = findEntry(parentID)
          entry.running.set(agent.sessionID, { agent, tokens: CHILD_DEFAULT_TOKENS })
          recalcCachedChildrenTokens(parentID)

          if (entry.pending > 0) {
            entry.pending--
          }
        }
      }),
    unregisterChild: (sessionID: Session.ID) =>
      Effect.sync(() => {
        doUnregisterChild(sessionID)
      }),
    shouldCompact,
    updateChildTokens: (sessionID: Session.ID, tokenCount: number) =>
      Effect.sync(() => {
        doUpdateChildTokens(sessionID, tokenCount)
      }),
    invalidateChildren: (parentID: Session.ID) =>
      Effect.sync(() => {
        doInvalidateChildren(parentID)
      }),
    reserveSpawn: (_sessionID: Session.ID, parentID: Session.ID) =>
      Effect.sync(() => {
        const entry = findEntry(parentID)
        const maxQueue = getMaxQueue()
        if (entry.pending >= maxQueue) return false
        doReserveSpawn(_sessionID, parentID)
        return true
      }).pipe(Effect.catch(() => Effect.succeed(false))),
  })
})

const layer = Layer.effect(Service, make)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [SessionStore.node, SessionContext.node, Model.node, Config.node],
})
