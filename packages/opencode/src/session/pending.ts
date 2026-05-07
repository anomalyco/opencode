import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { InstanceState } from "@/effect/instance-state"
import { ModelID, ProviderID } from "@/provider/schema"
import { NamedError } from "@opencode-ai/util/error"
import { MessageV2 } from "./message-v2"
import { SessionRunState } from "./run-state"
import { MessageID, SessionID } from "./schema"
import { Context, Effect, Layer, Option, Semaphore } from "effect"
import z from "zod"
import { ulid } from "ulid"

export namespace SessionPending {
  export const SteerUnavailableError = NamedError.create(
    "SessionSteerUnavailableError",
    z.object({
      sessionID: SessionID.zod,
      message: z.string(),
    }),
  )

  export const ConflictError = NamedError.create(
    "SessionPendingConflictError",
    z.object({
      sessionID: SessionID.zod,
      message: z.string(),
    }),
  )

  export const Lane = z.enum(["steer", "queue"]).meta({ ref: "SessionPendingLane" })
  export type Lane = z.infer<typeof Lane>

  const Selection = z
    .object({
      startLine: z.number(),
      startChar: z.number(),
      endLine: z.number(),
      endChar: z.number(),
    })
    .meta({ ref: "SessionPendingSelection" })

  const ComposerPromptPart = z.discriminatedUnion("type", [
    z.object({
      type: z.literal("text"),
      content: z.string(),
      start: z.number(),
      end: z.number(),
    }),
    z.object({
      type: z.literal("file"),
      content: z.string(),
      start: z.number(),
      end: z.number(),
      path: z.string(),
      selection: Selection.optional(),
    }),
    z.object({
      type: z.literal("agent"),
      content: z.string(),
      start: z.number(),
      end: z.number(),
      name: z.string(),
    }),
    z.object({
      type: z.literal("image"),
      id: z.string(),
      filename: z.string(),
      mime: z.string(),
      dataUrl: z.string(),
    }),
  ])

  const ComposerContextItem = z.object({
    key: z.string(),
    type: z.literal("file"),
    path: z.string(),
    selection: Selection.optional(),
    comment: z.string().optional(),
    commentID: z.string().optional(),
    commentOrigin: z.enum(["review", "file"]).optional(),
    preview: z.string().optional(),
  })

  export const Composer = z
    .object({
      prompt: z.array(ComposerPromptPart),
      context: z.array(ComposerContextItem),
    })
    .meta({ ref: "SessionPendingComposer" })
  export type Composer = z.infer<typeof Composer>

  const ModelRef = z.object({
    providerID: ProviderID.zod,
    modelID: ModelID.zod,
  })

  const PromptRequestPart = z.discriminatedUnion("type", [
    MessageV2.TextPart.omit({
      messageID: true,
      sessionID: true,
    })
      .partial({
        id: true,
      })
      .meta({
        ref: "SessionPendingTextPartInput",
      }),
    MessageV2.FilePart.omit({
      messageID: true,
      sessionID: true,
    })
      .partial({
        id: true,
      })
      .meta({
        ref: "SessionPendingFilePartInput",
      }),
    MessageV2.AgentPart.omit({
      messageID: true,
      sessionID: true,
    })
      .partial({
        id: true,
      })
      .meta({
        ref: "SessionPendingAgentPartInput",
      }),
    MessageV2.SubtaskPart.omit({
      messageID: true,
      sessionID: true,
    })
      .partial({
        id: true,
      })
      .meta({
        ref: "SessionPendingSubtaskPartInput",
      }),
  ])

  const CommandRequestPart = z.discriminatedUnion("type", [
    MessageV2.FilePart.omit({
      messageID: true,
      sessionID: true,
    })
      .partial({
        id: true,
      })
      .meta({
        ref: "SessionPendingCommandFilePartInput",
      }),
  ])

  export const Draft = z
    .discriminatedUnion("kind", [
      z.object({
        kind: z.literal("prompt"),
        preview: z.string(),
        composer: Composer,
        request: z.object({
          messageID: MessageID.zod.optional(),
          model: ModelRef.optional(),
          agent: z.string().optional(),
          tools: z.record(z.string(), z.boolean()).optional(),
          format: MessageV2.Format.optional(),
          system: z.string().optional(),
          variant: z.string().optional(),
          parts: z.array(PromptRequestPart),
        }),
      }),
      z.object({
        kind: z.literal("command"),
        preview: z.string(),
        composer: Composer,
        request: z.object({
          agent: z.string().optional(),
          model: z.string().optional(),
          arguments: z.string(),
          command: z.string(),
          variant: z.string().optional(),
          parts: z.array(CommandRequestPart).optional(),
          resolved: z
            .object({
              model: ModelRef.optional(),
              agent: z.string().optional(),
              variant: z.string().optional(),
              parts: z.array(PromptRequestPart),
            })
            .optional(),
        }),
      }),
    ])
    .meta({ ref: "SessionPendingDraft" })
  export type Draft = z.infer<typeof Draft>

  export const Item = z
    .object({
      id: z.string(),
      lane: Lane,
      draft: Draft,
      time: z.object({
        created: z.number(),
        updated: z.number(),
      }),
    })
    .meta({ ref: "SessionPendingItem" })
  export type Item = z.infer<typeof Item>

  export const Info = z
    .object({
      paused: z.boolean(),
      stopRequested: z.boolean().optional(),
      steer: z.array(Item),
      queue: z.array(Item),
    })
    .meta({ ref: "SessionPending" })
  export type Info = z.infer<typeof Info>

  export const AddInput = z.object({
    sessionID: SessionID.zod,
    lane: Lane,
    draft: Draft,
  })
  type AddItemInput = z.infer<typeof AddInput> & { id?: string }
  type PreparedInput = AddItemInput

  export const ItemInput = z.object({
    sessionID: SessionID.zod,
    itemID: z.string(),
  })

  export const RemoveInput = ItemInput

  export const CommitEditInput = ItemInput.extend({
    draft: Draft,
  })

  export const MoveLaneInput = ItemInput.extend({
    lane: Lane,
  })

  export const Event = {
    Updated: BusEvent.define(
      "session.pending.updated",
      z.object({
        sessionID: SessionID.zod,
        pending: Info,
      }),
    ),
  }

  type Entry = {
    info: Info
    stopRequested: boolean
  }

  type State = {
    items: Map<SessionID, Entry>
    locks: Map<SessionID, Semaphore.Semaphore>
  }

  function cloneItem(item: Item): Item {
    return {
      ...item,
      draft: structuredClone(item.draft),
      time: { ...item.time },
    }
  }

  function cloneInfo(info: Info): Info {
    return {
      paused: info.paused,
      stopRequested: info.stopRequested,
      steer: info.steer.map(cloneItem),
      queue: info.queue.map(cloneItem),
    }
  }

  function cloneEntry(entry: Entry): Entry {
    const info = cloneInfo(entry.info)
    return {
      stopRequested: entry.stopRequested,
      info,
    }
  }

  function empty(): Info {
    return {
      paused: false,
      steer: [],
      queue: [],
    }
  }

  function laneList(info: Info, lane: Lane) {
    return lane === "steer" ? info.steer : info.queue
  }

  function removeItem(info: Info, itemID: string) {
    for (const lane of [info.steer, info.queue]) {
      const index = lane.findIndex((item) => item.id === itemID)
      if (index === -1) continue
      const [removed] = lane.splice(index, 1)
      return removed
    }
    return
  }

  function hasItem(info: Info, itemID: string) {
    return info.steer.some((item) => item.id === itemID) || info.queue.some((item) => item.id === itemID)
  }

  function conflict(sessionID: SessionID, message: string) {
    return new ConflictError({ sessionID, message })
  }

  function steerAllowed(entry: Entry, promptRunning: boolean, stopRequested = entry.stopRequested) {
    return promptRunning && !stopRequested && !entry.info.paused
  }

  function normalizeInfo(info: Info, stopRequested: boolean) {
    info.stopRequested = stopRequested
    if (!stopRequested && info.steer.length === 0 && info.queue.length === 0) {
      info.paused = false
    }
  }

  function promoteSteersToQueue(entry: Entry) {
    if (entry.info.steer.length === 0) return
    const now = Date.now()
    const promoted = entry.info.steer.splice(0)
    for (const item of promoted) {
      item.lane = "queue"
      item.time.updated = now
    }
    entry.info.queue.unshift(...promoted)
  }

  function restoreClaimed(entry: Entry, item: Item, promptRunning: boolean, stopRequested: boolean) {
    if (hasItem(entry.info, item.id)) return
    const restored = cloneItem(item)
    if (item.lane === "steer" && !steerAllowed(entry, promptRunning, stopRequested)) {
      entry.info.paused = true
      promoteSteersToQueue(entry)
      restored.lane = "queue"
      restored.time.updated = Date.now()
      entry.info.queue.unshift(restored)
      return
    }
    laneList(entry.info, item.lane).unshift(restored)
  }

  export interface Interface {
    readonly withLock: <T, E, R>(sessionID: SessionID, effect: Effect.Effect<T, E, R>) => Effect.Effect<T, E, R>
    readonly get: (sessionID: SessionID) => Effect.Effect<Info>
    readonly refresh: (sessionID: SessionID) => Effect.Effect<Info>
    readonly add: (input: z.infer<typeof AddInput>) => Effect.Effect<Info>
    readonly addPrepared: (input: PreparedInput) => Effect.Effect<Info>
    readonly addPreparedWithinLock: (input: PreparedInput) => Effect.Effect<
      Info,
      InstanceType<typeof SteerUnavailableError>
    >
    readonly addResolved: <E, R>(input: {
      sessionID: SessionID
      lane: Lane
      resolveDraft: Effect.Effect<Draft, E, R>
    }) => Effect.Effect<Info, E | InstanceType<typeof SteerUnavailableError>, R>
    readonly addItem: (input: AddItemInput) => Effect.Effect<{ info: Info; item: Item }>
    readonly remove: (input: z.infer<typeof RemoveInput>) => Effect.Effect<Info>
    readonly moveUp: (input: z.infer<typeof ItemInput>) => Effect.Effect<Info>
    readonly moveDown: (input: z.infer<typeof ItemInput>) => Effect.Effect<Info>
    readonly moveLane: (input: z.infer<typeof MoveLaneInput>) => Effect.Effect<Info>
    readonly commitEdit: (input: z.infer<typeof CommitEditInput>) => Effect.Effect<Info>
    readonly commitEditResolved: <E, R>(input: {
      sessionID: SessionID
      itemID: string
      resolveDraft: Effect.Effect<Draft, E, R>
    }) => Effect.Effect<Info, E | InstanceType<typeof ConflictError>, R>
    readonly pause: (sessionID: SessionID, options?: { promoteSteers?: boolean }) => Effect.Effect<Info>
    readonly beginStop: (sessionID: SessionID) => Effect.Effect<Info>
    readonly finishStop: (sessionID: SessionID) => Effect.Effect<Info>
    readonly resume: (sessionID: SessionID) => Effect.Effect<Info>
    readonly takeSteer: (sessionID: SessionID) => Effect.Effect<Item | undefined>
    readonly takeQueueClaimed: (sessionID: SessionID) => Effect.Effect<Item | undefined>
    readonly dispatchClaimed: <T, E, R>(
      sessionID: SessionID,
      item: Item,
      effect: Effect.Effect<T, E, R>,
    ) => Effect.Effect<Option.Option<T>, E, R>
    readonly beginDispatch: (sessionID: SessionID, item: Item) => Effect.Effect<boolean>
    readonly restore: (sessionID: SessionID, item: Item) => Effect.Effect<Info>
    readonly promoteSteersToQueue: (sessionID: SessionID) => Effect.Effect<Info>
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/SessionPending") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const runState = yield* SessionRunState.Service
      const state = yield* InstanceState.make<State>(
        Effect.fn("SessionPending.state")(() =>
          Effect.succeed({
            items: new Map<SessionID, Entry>(),
            locks: new Map<SessionID, Semaphore.Semaphore>(),
          }),
        ),
      )

      const getLock = Effect.fn("SessionPending.lock")(function* (sessionID: SessionID) {
        const locks = (yield* InstanceState.get(state)).locks
        const existing = locks.get(sessionID)
        if (existing) return existing
        const next = Semaphore.makeUnsafe(1)
        locks.set(sessionID, next)
        return next
      })

      const withLock = Effect.fn("SessionPending.withLock")(function* <T, E, R>(
        sessionID: SessionID,
        effect: Effect.Effect<T, E, R>,
      ) {
        return yield* effect.pipe((yield* getLock(sessionID)).withPermits(1))
      })

      const currentEntry = Effect.fn("SessionPending.currentEntry")(function* (sessionID: SessionID) {
        const data = yield* InstanceState.get(state)
        const existing = data.items.get(sessionID)
        if (existing) return cloneEntry(existing)
        return {
          info: empty(),
          stopRequested: false,
        } satisfies Entry
      })

      const current = Effect.fn("SessionPending.current")(function* (sessionID: SessionID) {
        const entry = yield* currentEntry(sessionID)
        const info = cloneInfo(entry.info)
        const stopRequested = entry.stopRequested || (yield* runState.isStopRequested(sessionID))
        info.stopRequested = stopRequested
        return info
      })

      const persist = Effect.fn("SessionPending.persist")(function* (
        sessionID: SessionID,
        next: Entry,
        options?: { requireSteerAvailable?: boolean },
      ) {
        const data = yield* InstanceState.get(state)
        const promptRunning = yield* runState.isPromptRunning(sessionID)
        const stopRequested = next.stopRequested || (yield* runState.isStopRequested(sessionID))
        if (options?.requireSteerAvailable && !steerAllowed(next, promptRunning, stopRequested)) {
          throw new SteerUnavailableError({
            sessionID,
            message: "Cannot use steer unless the current run can still accept steer messages",
          })
        }
        normalizeInfo(next.info, stopRequested)
        const snapshot = cloneEntry(next)
        if (
          !stopRequested &&
          !snapshot.info.paused &&
          snapshot.info.steer.length === 0 &&
          snapshot.info.queue.length === 0
        ) {
          data.items.delete(sessionID)
        } else {
          data.items.set(sessionID, snapshot)
        }
        yield* bus.publish(Event.Updated, { sessionID, pending: snapshot.info })
        return cloneInfo(snapshot.info)
      })

      const mutate = Effect.fn("SessionPending.mutate")(function* (
        sessionID: SessionID,
        fn: (draft: Entry) => void,
        options?: { requireSteerAvailable?: boolean },
      ) {
        return yield* withLock(
          sessionID,
          Effect.gen(function* () {
            const next = yield* currentEntry(sessionID)
            const before = JSON.stringify(next)
            fn(next)
            const stopRequested = next.stopRequested || (yield* runState.isStopRequested(sessionID))
            next.info.stopRequested = stopRequested
            if (before === JSON.stringify(next)) return cloneInfo(next.info)
            return yield* persist(sessionID, next, options)
          }),
        )
      })

      const addItem = Effect.fn("SessionPending.addItem")(function* (input: AddItemInput) {
        let item: Item | undefined
        const info = yield* mutate(
          input.sessionID,
          (draft) => {
            item = {
              id: input.id ?? ulid(),
              lane: input.lane,
              draft: structuredClone(input.draft),
              time: {
                created: Date.now(),
                updated: Date.now(),
              },
            }
            laneList(draft.info, input.lane).push(item!)
          },
          { requireSteerAvailable: input.lane === "steer" },
        )
        if (!item) throw new Error("Failed to create pending item")
        return { info, item: cloneItem(item) }
      })

      const add = Effect.fn("SessionPending.add")(function* (input: z.infer<typeof AddInput>) {
        return (yield* addItem(input)).info
      })

      const ensureSteerAcceptable = Effect.fn("SessionPending.ensureSteerAcceptable")(function* (
        sessionID: SessionID,
        lane: Lane,
      ) {
        if (lane !== "steer") return
        yield* withLock(
          sessionID,
          Effect.gen(function* () {
            const next = yield* currentEntry(sessionID)
            const promptRunning = yield* runState.isPromptRunning(sessionID)
            const stopRequested = next.stopRequested || (yield* runState.isStopRequested(sessionID))
            if (steerAllowed(next, promptRunning, stopRequested)) return
            throw new SteerUnavailableError({
              sessionID,
              message: "Cannot use steer unless the current run can still accept steer messages",
            })
          }),
        )
      })

      const addPreparedWithinLock = Effect.fn("SessionPending.addPreparedWithinLock")(function* (input: PreparedInput) {
        const next = yield* currentEntry(input.sessionID)
        const promptRunningAfter = yield* runState.isPromptRunning(input.sessionID)
        const stopRequestedAfter = next.stopRequested || (yield* runState.isStopRequested(input.sessionID))
        if (stopRequestedAfter) {
          next.info.paused = true
        }
        const steerUnavailable = input.lane === "steer" && !steerAllowed(next, promptRunningAfter, stopRequestedAfter)
        if (steerUnavailable) {
          next.info.paused = true
        }
        const lane = steerUnavailable ? "queue" : input.lane
        const now = Date.now()
        const item = {
          id: input.id ?? ulid(),
          lane,
          draft: structuredClone(input.draft),
          time: {
            created: now,
            updated: now,
          },
        }
        if (steerUnavailable) laneList(next.info, lane).unshift(item)
        else laneList(next.info, lane).push(item)
        return yield* persist(input.sessionID, next)
      })

      const addPrepared = Effect.fn("SessionPending.addPrepared")(function* (input: PreparedInput) {
        return yield* withLock(input.sessionID, addPreparedWithinLock(input))
      })

      const addResolved = Effect.fn("SessionPending.addResolved")(function* <E, R>(input: {
        sessionID: SessionID
        lane: Lane
        resolveDraft: Effect.Effect<Draft, E, R>
      }) {
        yield* ensureSteerAcceptable(input.sessionID, input.lane)
        const resolvedDraft = yield* input.resolveDraft
        return yield* addPrepared({
          sessionID: input.sessionID,
          lane: input.lane,
          draft: resolvedDraft,
        })
      })

      const refresh = Effect.fn("SessionPending.refresh")(function* (sessionID: SessionID) {
        return yield* withLock(
          sessionID,
          Effect.gen(function* () {
            const next = yield* currentEntry(sessionID)
            return yield* persist(sessionID, next)
          }),
        )
      })

      const remove = Effect.fn("SessionPending.remove")(function* (input: z.infer<typeof RemoveInput>) {
        return yield* mutate(input.sessionID, (draft) => {
          const removed = removeItem(draft.info, input.itemID)
          if (!removed) throw conflict(input.sessionID, "Pending item not found")
        })
      })

      const moveUp = Effect.fn("SessionPending.moveUp")(function* (input: z.infer<typeof ItemInput>) {
        return yield* mutate(input.sessionID, (draft) => {
          const list = [draft.info.steer, draft.info.queue].find((lane) => lane.some((item) => item.id === input.itemID))
          if (!list) throw conflict(input.sessionID, "Pending item not found")
          const index = list.findIndex((item) => item.id === input.itemID)
          if (index <= 0) return
          ;[list[index - 1], list[index]] = [list[index], list[index - 1]]
          list[index - 1].time.updated = Date.now()
          list[index].time.updated = Date.now()
        })
      })

      const moveDown = Effect.fn("SessionPending.moveDown")(function* (input: z.infer<typeof ItemInput>) {
        return yield* mutate(input.sessionID, (draft) => {
          const list = [draft.info.steer, draft.info.queue].find((lane) => lane.some((item) => item.id === input.itemID))
          if (!list) throw conflict(input.sessionID, "Pending item not found")
          const index = list.findIndex((item) => item.id === input.itemID)
          if (index < 0 || index >= list.length - 1) return
          ;[list[index], list[index + 1]] = [list[index + 1], list[index]]
          list[index].time.updated = Date.now()
          list[index + 1].time.updated = Date.now()
        })
      })

      const moveLane = Effect.fn("SessionPending.moveLane")(function* (input: z.infer<typeof MoveLaneInput>) {
        return yield* mutate(input.sessionID, (draft) => {
          const existing = [...draft.info.steer, ...draft.info.queue].find((entry) => entry.id === input.itemID)
          if (existing?.lane === input.lane) return
          const item = removeItem(draft.info, input.itemID)
          if (!item) throw conflict(input.sessionID, "Pending item not found")
          item.lane = input.lane
          item.time.updated = Date.now()
          const target = laneList(draft.info, input.lane)
          if (input.lane === "queue") target.unshift(item)
          else target.push(item)
        }, { requireSteerAvailable: input.lane === "steer" })
      })

      const commitEdit = Effect.fn("SessionPending.commitEdit")(function* (input: z.infer<typeof CommitEditInput>) {
        return yield* mutate(input.sessionID, (draft) => {
          const item = [...draft.info.steer, ...draft.info.queue].find((entry) => entry.id === input.itemID)
          if (!item) throw conflict(input.sessionID, "Pending item not found")
          item.draft = structuredClone(input.draft)
          item.time.updated = Date.now()
        })
      })

      const commitEditResolved = Effect.fn("SessionPending.commitEditResolved")(function* <E, R>(input: {
        sessionID: SessionID
        itemID: string
        resolveDraft: Effect.Effect<Draft, E, R>
      }) {
        return yield* withLock(
          input.sessionID,
          Effect.gen(function* () {
            const next = yield* currentEntry(input.sessionID)
            const item = [...next.info.steer, ...next.info.queue].find((entry) => entry.id === input.itemID)
            if (!item) throw conflict(input.sessionID, "Pending item not found")
            item.draft = structuredClone(yield* input.resolveDraft)
            item.time.updated = Date.now()
            return yield* persist(input.sessionID, next)
          }),
        )
      })

      const pause = Effect.fn("SessionPending.pause")(function* (
        sessionID: SessionID,
        options?: { promoteSteers?: boolean },
      ) {
        return yield* mutate(sessionID, (draft) => {
          draft.info.paused = true
          if (options?.promoteSteers) promoteSteersToQueue(draft)
        })
      })

      const beginStop = Effect.fn("SessionPending.beginStop")(function* (sessionID: SessionID) {
        return yield* mutate(sessionID, (draft) => {
          draft.stopRequested = true
          draft.info.paused = true
          promoteSteersToQueue(draft)
        })
      })

      const finishStop = Effect.fn("SessionPending.finishStop")(function* (sessionID: SessionID) {
        return yield* mutate(sessionID, (draft) => {
          draft.stopRequested = false
          if (draft.info.steer.length === 0 && draft.info.queue.length === 0) {
            draft.info.paused = false
          }
        })
      })

      const resume = Effect.fn("SessionPending.resume")(function* (sessionID: SessionID) {
        return yield* withLock(
          sessionID,
          Effect.gen(function* () {
            const next = yield* currentEntry(sessionID)
            if (next.stopRequested || (yield* runState.isStopRequested(sessionID))) {
              throw conflict(sessionID, "Stop is still in progress")
            }
            const promptRunning = yield* runState.isPromptRunning(sessionID)
            if (next.info.steer.length > 0 && !promptRunning) {
              promoteSteersToQueue(next)
            }
            next.info.paused = false
            return yield* persist(sessionID, next)
          }),
        )
      })

      const takeSteer = Effect.fn("SessionPending.takeSteer")(function* (sessionID: SessionID) {
        let item: Item | undefined
        yield* mutate(sessionID, (draft) => {
          if (draft.info.paused || draft.info.steer.length === 0) return
          item = draft.info.steer.shift()
        })
        return item ? cloneItem(item) : undefined
      })

      const takeQueueClaimed = Effect.fn("SessionPending.takeQueueClaimed")(function* (sessionID: SessionID) {
        let item: Item | undefined
        yield* mutate(sessionID, (draft) => {
          if (draft.info.paused || draft.info.queue.length === 0) return
          if (draft.info.steer.length > 0) return
          item = draft.info.queue.shift()
        })
        return item ? cloneItem(item) : undefined
      })

      const beginDispatch = Effect.fn("SessionPending.beginDispatch")(function* (sessionID: SessionID, item: Item) {
        let allowed = true
        yield* withLock(
          sessionID,
          Effect.gen(function* () {
            const next = yield* currentEntry(sessionID)
            const queueBlocked = item.lane === "queue" && next.info.steer.length > 0
            const promptRunning = yield* runState.isPromptRunning(sessionID)
            const stopRequested = next.stopRequested || (yield* runState.isStopRequested(sessionID))
            const steerBlocked = item.lane === "steer" && !steerAllowed(next, promptRunning, stopRequested)
            if (!stopRequested && !next.info.paused && !queueBlocked && !steerBlocked) return
            allowed = false
            restoreClaimed(next, item, promptRunning, stopRequested)
            yield* persist(sessionID, next)
          }),
        )
        return allowed
      })

      const dispatchClaimed = Effect.fn("SessionPending.dispatchClaimed")(function* <T, E, R>(
        sessionID: SessionID,
        item: Item,
        effect: Effect.Effect<T, E, R>,
      ) {
        const allowed = yield* beginDispatch(sessionID, item)
        if (!allowed) return Option.none<T>()
        return Option.some(yield* effect)
      })

      const restore = Effect.fn("SessionPending.restore")(function* (sessionID: SessionID, item: Item) {
        return yield* withLock(
          sessionID,
          Effect.gen(function* () {
            const next = yield* currentEntry(sessionID)
            const promptRunning = yield* runState.isPromptRunning(sessionID)
            const stopRequested = next.stopRequested || (yield* runState.isStopRequested(sessionID))
            restoreClaimed(next, item, promptRunning, stopRequested)
            return yield* persist(sessionID, next)
          }),
        )
      })

      const promotePendingSteersToQueue = Effect.fn("SessionPending.promoteSteersToQueue")(function* (
        sessionID: SessionID,
      ) {
        return yield* mutate(sessionID, (draft) => {
          if (draft.info.steer.length === 0) return
          draft.info.paused = true
          promoteSteersToQueue(draft)
        })
      })

      return Service.of({
        withLock,
        get: current,
        refresh,
        add,
        addPrepared,
        addPreparedWithinLock,
        addResolved,
        addItem,
        remove,
        moveUp,
        moveDown,
        moveLane,
        commitEdit,
        commitEditResolved,
        pause,
        beginStop,
        finishStop,
        resume,
        takeSteer,
        takeQueueClaimed,
        dispatchClaimed,
        beginDispatch,
        restore,
        promoteSteersToQueue: promotePendingSteersToQueue,
      })
    }),
  )

  export const defaultLayer = layer.pipe(
    Layer.provideMerge(SessionRunState.defaultLayer),
    Layer.provide(Bus.layer),
  )
}
