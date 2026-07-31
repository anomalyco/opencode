import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import type {
  Event,
  EventMessagePartDelta,
  EventMessagePartUpdated,
  OpencodeClient,
  Part,
  SessionMessageResponse,
  ToolPart,
} from "@opencode-ai/sdk/v2"
import { Effect } from "effect"
import { GlobalBus } from "@/bus/global"
import { ACPSession } from "./session"
import { ACPPermission } from "./permission"
import { partsToContentChunks, type ReplayPart } from "./content"
import {
  duplicateRunningToolUpdate,
  errorToolUpdate,
  pendingToolCall,
  runningToolUpdate,
  shellOutputSnapshot,
  completedToolUpdate,
} from "./tool"

type Connection = Pick<AgentSideConnection, "sessionUpdate"> &
  Partial<Pick<AgentSideConnection, "requestPermission" | "writeTextFile">>
type SessionUpdateParams = Parameters<Connection["sessionUpdate"]>[0]
type Listener = (event: Event) => Promise<void>
type EventSubscriber = (listener: (event: Event) => void) => () => void
type BufferedReplayEvent = {
  readonly revision: number
  readonly event: Event
}
type PendingLiveEvent = {
  readonly event: Event
  claimedByReplay: boolean
}
type UnattachedReplayJournal = {
  readonly events: EventMessagePartDelta[]
  readonly overflowedParts: Set<string>
  bufferedBytes: number
  overflowedUnknown: boolean
}
type ReplayGate = {
  readonly token: symbol
  revision: number
  readonly events: BufferedReplayEvent[]
  readonly deliveredRevisions: Set<number>
  readonly previousToolState: ToolReplayState
  readonly snapshotNotifications: string[]
  draining: boolean
  drainTail: Promise<void>
  readonly overflowedParts: Set<string>
  overflowed: boolean
  invalidated: boolean
  snapshotCursor: number
  bufferedBytes: number
}
type ToolReplayState = {
  readonly starts: Set<string>
  readonly shellSnapshots: Map<string, string>
}
type ReplayReconciliation = {
  readonly coveredDeltas: Set<number>
  readonly coveredUpdates: Set<number>
  readonly contentUpdates: Set<number>
  readonly snapshotParts: Map<string, Part>
}
type ReplayBarrier = {
  readonly window: ReplayWindow
  readonly reached: PromiseWithResolvers<number>
}

export type ReplayWindow = {
  readonly sessionID: string
  readonly token: symbol
}

const maximumBufferedReplayEvents = 10_000
const maximumBufferedReplayBytes = 2 * 1024 * 1024
const maximumUnattachedReplaySessions = 10_000
const maximumDelayedSnapshotParts = 256
const maximumSnapshotCheckpointUpdates = 10_000
const textEncoder = new TextEncoder()
const replayBarrierTimeoutMilliseconds = 5_000

export class ReplayBoundaryError extends Error {}

export function start(input: {
  sdk: OpencodeClient
  connection: Connection
  session: ACPSession.Interface
  publishBarrier?: (event: Event) => void
  subscribeEvents?: EventSubscriber
}) {
  const subscription = new Subscription(input)
  subscription.start()
  return subscription
}

export class Subscription {
  private readonly abort = new AbortController()
  private readonly shellSnapshots = new Map<string, string>()
  private readonly toolStarts = new Set<string>()
  private readonly permission: ACPPermission.Handler
  private readonly listeners = new Set<Listener>()
  private readonly replayGates = new Map<string, ReplayGate>()
  private readonly pendingLiveEvents = new Map<string, Set<PendingLiveEvent>>()
  private readonly unattachedReplayJournals = new Map<string, UnattachedReplayJournal>()
  private readonly delayedSnapshotParts = new Map<string, Map<string, Part>>()
  private readonly replayBarriers = new Map<string, ReplayBarrier>()
  private readonly failedSnapshotPrefixes = new Map<string, readonly string[]>()
  private readonly connectionWaiters = new Set<PromiseWithResolvers<void>>()
  private removeEventSubscription: (() => void) | undefined
  private eventTail = Promise.resolve()
  private unattachedReplayEvents = 0
  private unattachedReplayBytes = 0
  private unattachedReplayOverflowParts = 0
  private unattachedReplayCapacityExceeded = false
  private connected = false
  private started = false

  constructor(
    private readonly input: {
      sdk: OpencodeClient
      connection: Connection
      session: ACPSession.Interface
      publishBarrier?: (event: Event) => void
      subscribeEvents?: EventSubscriber
    },
  ) {
    this.permission = new ACPPermission.Handler(input)
  }

  start() {
    if (this.started) return
    this.started = true
    const receive = (event: Event) => {
      this.receive(event)
    }
    if (this.input.subscribeEvents) {
      this.removeEventSubscription = this.input.subscribeEvents(receive)
    } else {
      const listener = (event: { payload?: Event }) => {
        if (event.payload) receive(event.payload)
      }
      GlobalBus.on("event", listener)
      this.removeEventSubscription = () => GlobalBus.off("event", listener)
    }
    this.connected = true
    for (const waiter of this.connectionWaiters) waiter.resolve()
    this.connectionWaiters.clear()
  }

  stop() {
    this.close()
  }

  close() {
    this.abort.abort()
    this.connected = false
    this.removeEventSubscription?.()
    this.removeEventSubscription = undefined
    const error = new ReplayBoundaryError("event subscription closed")
    for (const waiter of this.connectionWaiters) waiter.reject(error)
    this.connectionWaiters.clear()
    for (const barrier of this.replayBarriers.values()) barrier.reached.reject(error)
    this.replayBarriers.clear()
    this.unattachedReplayJournals.clear()
    this.unattachedReplayEvents = 0
    this.unattachedReplayBytes = 0
    this.unattachedReplayOverflowParts = 0
    this.unattachedReplayCapacityExceeded = false
    this.failedSnapshotPrefixes.clear()
    this.delayedSnapshotParts.clear()
  }

  addListener(listener: Listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  beginReplay(sessionID: string): ReplayWindow {
    if (this.replayGates.has(sessionID)) {
      throw new Error(`replay already active for ${sessionID}`)
    }
    const token = Symbol(sessionID)
    const gate: ReplayGate = {
      token,
      revision: 0,
      events: [],
      deliveredRevisions: new Set(),
      previousToolState: this.captureToolState(sessionID),
      snapshotNotifications: [...(this.failedSnapshotPrefixes.get(sessionID) ?? [])],
      draining: false,
      drainTail: Promise.resolve(),
      overflowedParts: new Set(),
      overflowed: false,
      invalidated: false,
      snapshotCursor: 0,
      bufferedBytes: 0,
    }
    this.replayGates.set(sessionID, gate)
    const journal = this.unattachedReplayJournals.get(sessionID)
    if (journal) {
      this.unattachedReplayJournals.delete(sessionID)
      this.unattachedReplayEvents -= journal.events.length
      this.unattachedReplayBytes -= journal.bufferedBytes
      this.unattachedReplayOverflowParts -= journal.overflowedParts.size
      gate.overflowed = journal.overflowedUnknown
      for (const key of journal.overflowedParts) gate.overflowedParts.add(key)
      for (const event of journal.events) this.bufferReplayEvent(gate, event)
    }
    if (this.unattachedReplayCapacityExceeded) gate.overflowed = true
    for (const pending of this.pendingLiveEvents.get(sessionID) ?? []) {
      if (pending.claimedByReplay) continue
      pending.claimedByReplay = true
      this.reconcileUnattachedJournal(pending.event)
      this.bufferReplayEvent(gate, pending.event)
    }
    return { sessionID, token }
  }

  async replayBoundary(window: ReplayWindow) {
    const gate = this.requireReplayGate(window)
    await this.waitForConnection()
    const id = `evt_acp_replay_${crypto.randomUUID()}`
    const reached = Promise.withResolvers<number>()
    this.replayBarriers.set(id, { window, reached })
    const timeout = setTimeout(() => {
      const barrier = this.replayBarriers.get(id)
      if (!barrier || !this.replayBarriers.delete(id)) return
      barrier.reached.reject(new ReplayBoundaryError("event replay barrier timed out"))
    }, replayBarrierTimeoutMilliseconds)
    try {
      const marker = {
        id,
        type: "server.heartbeat",
        properties: {},
      } as unknown as Event
      if (this.input.publishBarrier) this.input.publishBarrier(marker)
      else GlobalBus.emit("event", { directory: "global", payload: marker })
      const boundaryRevision = await reached.promise
      this.assertReplayCapacity(gate)
      return boundaryRevision
    } finally {
      clearTimeout(timeout)
      this.replayBarriers.delete(id)
    }
  }

  replayRevision(window: ReplayWindow) {
    return this.requireReplayGate(window).revision
  }

  async finishReplay(window: ReplayWindow, boundaryRevision: number, snapshot: readonly SessionMessageResponse[] = []) {
    const gate = this.requireReplayGate(window)
    this.assertReplayCapacity(gate)
    if (gate.snapshotCursor !== gate.snapshotNotifications.length) {
      throw new ReplayBoundaryError("session replay snapshot changed after a partial delivery")
    }
    const drainRevision = this.connected ? await this.replayBoundary(window) : gate.revision
    this.assertReplayCapacity(gate)
    const fenced = gate.events.filter((buffered) => buffered.revision <= drainRevision)
    const reconciliation = reconcileReplay(fenced, boundaryRevision, snapshot)
    for (const buffered of fenced) {
      if (reconciliation.coveredDeltas.has(buffered.revision)) {
        continue
      }
      if (buffered.event.type === "message.part.updated") {
        const key = replayPartKey(buffered.event.properties.part)
        const snapshotPart = reconciliation.snapshotParts.get(key)
        if (
          reconciliation.coveredUpdates.has(buffered.revision) ||
          (snapshotPart && snapshotCoversPart(snapshotPart, buffered.event.properties.part))
        ) {
          if (snapshotPart && equivalentPart(snapshotPart, buffered.event.properties.part)) {
            reconciliation.snapshotParts.delete(key)
          }
          continue
        }
      } else if (buffered.revision <= boundaryRevision && buffered.event.type !== "message.part.delta") {
        continue
      }
      await this.handleUnbuffered(buffered.event)
      this.assertReplayCapacity(gate)
      if (buffered.event.type === "message.part.updated" && reconciliation.contentUpdates.has(buffered.revision)) {
        await this.replayUncoveredContent(buffered.event)
        this.assertReplayCapacity(gate)
      }
      if (buffered.event.type === "message.part.updated") {
        reconciliation.snapshotParts.delete(replayPartKey(buffered.event.properties.part))
      }
      gate.deliveredRevisions.add(buffered.revision)
    }
    this.assertReplayCapacity(gate)
    if (reconciliation.snapshotParts.size) {
      while (reconciliation.snapshotParts.size > maximumDelayedSnapshotParts) {
        const oldest = reconciliation.snapshotParts.keys().next().value
        if (oldest === undefined) break
        reconciliation.snapshotParts.delete(oldest)
      }
      this.delayedSnapshotParts.set(window.sessionID, reconciliation.snapshotParts)
    } else {
      this.delayedSnapshotParts.delete(window.sessionID)
    }
    gate.draining = true
    const live = gate.events.filter((buffered) => buffered.revision > drainRevision)
    this.queueReplayDrain(
      gate,
      live.map((buffered) => buffered.event),
    )
    await this.releaseReplayGate(window, gate)
    this.failedSnapshotPrefixes.delete(window.sessionID)
  }

  async abortReplay(window: ReplayWindow, options?: { reapplyDeliveredToolState?: boolean }) {
    const gate = this.replayGates.get(window.sessionID)
    if (!gate || gate.token !== window.token) return
    if (gate.snapshotNotifications.length) {
      this.failedSnapshotPrefixes.set(window.sessionID, [...gate.snapshotNotifications])
    }
    // Snapshot replay mutates the tool caches before the replay transaction commits.
    // Restore their prior state and, when the attachment survived rollback, reapply
    // only live updates already projected.
    this.restoreToolState(window.sessionID, gate.previousToolState)
    if (options?.reapplyDeliveredToolState !== false) {
      for (const buffered of gate.events) {
        if (!gate.deliveredRevisions.has(buffered.revision) || buffered.event.type !== "message.part.updated") continue
        const part = buffered.event.properties.part
        if (part.type === "tool") this.applyToolState(window.sessionID, part)
      }
    }
    if (gate.invalidated) {
      this.replayGates.delete(window.sessionID)
      this.failedSnapshotPrefixes.delete(window.sessionID)
      return
    }
    const attached = await Effect.runPromise(this.input.session.tryGet(window.sessionID))
    if (!attached) {
      this.replayGates.delete(window.sessionID)
      for (const buffered of gate.events) {
        if (gate.deliveredRevisions.has(buffered.revision) || buffered.event.type !== "message.part.delta") continue
        this.retainUnattachedDelta(buffered.event)
      }
      for (const key of gate.overflowedParts) this.markUnattachedOverflowPart(window.sessionID, key)
      if (gate.overflowed) this.markUnattachedOverflowUnknown(window.sessionID)
      return
    }
    gate.draining = true
    const events = gate.events.filter((buffered) => !gate.deliveredRevisions.has(buffered.revision))
    this.queueReplayDrain(
      gate,
      events.map((buffered) => buffered.event),
    )
    await this.releaseReplayGate(window, gate)
  }

  private assertReplayCapacity(gate: ReplayGate) {
    if (gate.invalidated) {
      throw new ReplayBoundaryError("session was deleted during replay")
    }
    if (gate.overflowed || gate.overflowedParts.size) {
      throw new ReplayBoundaryError("event replay buffer exceeded its limit")
    }
  }

  async handle(event: Event) {
    this.reconcileUnattachedJournal(event)
    if (event.type === "permission.asked") return this.handleUnbuffered(event)
    const sessionID = handledSessionID(event)
    const replay = sessionID ? this.replayGates.get(sessionID) : undefined
    if (replay) {
      if (replay.draining) {
        this.queueReplayDrain(replay, [event])
        return
      }
      this.bufferReplayEvent(replay, event)
      return
    }
    return this.handleLive(event)
  }

  private async handleLive(event: Event) {
    this.reconcileUnattachedJournal(event)
    if (event.type === "message.part.updated" && this.consumeDelayedSnapshot(event)) return
    return this.handleUnbuffered(event)
  }

  private bufferReplayEvent(gate: ReplayGate, event: Event) {
    gate.revision++
    const eventBytes = replayEventBytes(event)
    if (
      gate.events.length >= maximumBufferedReplayEvents ||
      gate.bufferedBytes + eventBytes > maximumBufferedReplayBytes
    ) {
      this.markReplayGateOverflow(gate, event)
      return
    }
    gate.bufferedBytes += eventBytes
    gate.events.push({ revision: gate.revision, event })
  }

  private retainUnattachedDelta(event: EventMessagePartDelta) {
    const sessionID = event.properties.sessionID
    const gate = this.replayGates.get(sessionID)
    if (gate) {
      if (gate.draining) {
        this.markReplayGateOverflow(gate, event)
        return
      }
      this.bufferReplayEvent(gate, event)
      return
    }

    const journal = this.unattachedReplayJournal(sessionID)
    if (!journal) return
    const eventBytes = replayEventBytes(event)
    if (
      this.unattachedReplayEvents >= maximumBufferedReplayEvents ||
      this.unattachedReplayBytes + eventBytes > maximumBufferedReplayBytes
    ) {
      this.markUnattachedOverflowPart(sessionID, overflowPartKey(event.properties.messageID, event.properties.partID))
      return
    }
    journal.events.push(event)
    journal.bufferedBytes += eventBytes
    this.unattachedReplayEvents++
    this.unattachedReplayBytes += eventBytes
  }

  private unattachedReplayJournal(sessionID: string) {
    const existing = this.unattachedReplayJournals.get(sessionID)
    if (existing) return existing
    if (this.unattachedReplayJournals.size >= maximumUnattachedReplaySessions) {
      this.unattachedReplayCapacityExceeded = true
      return
    }
    const journal: UnattachedReplayJournal = {
      events: [],
      overflowedParts: new Set(),
      bufferedBytes: 0,
      overflowedUnknown: false,
    }
    this.unattachedReplayJournals.set(sessionID, journal)
    return journal
  }

  private markUnattachedOverflowPart(sessionID: string, key: string) {
    const journal = this.unattachedReplayJournal(sessionID)
    if (!journal || journal.overflowedParts.has(key)) return
    if (this.unattachedReplayOverflowParts >= maximumBufferedReplayEvents) {
      journal.overflowedUnknown = true
      return
    }
    journal.overflowedParts.add(key)
    this.unattachedReplayOverflowParts++
  }

  private markUnattachedOverflowUnknown(sessionID: string) {
    const journal = this.unattachedReplayJournal(sessionID)
    if (journal) journal.overflowedUnknown = true
  }

  private markReplayGateOverflow(gate: ReplayGate, event: Event) {
    if (event.type !== "message.part.delta") {
      gate.overflowed = true
      return
    }
    if (gate.overflowedParts.size >= maximumBufferedReplayEvents) {
      gate.overflowed = true
      return
    }
    gate.overflowedParts.add(overflowPartKey(event.properties.messageID, event.properties.partID))
  }

  private clearUnattachedJournal(sessionID: string, keep?: (event: EventMessagePartDelta) => boolean) {
    const journal = this.unattachedReplayJournals.get(sessionID)
    if (!journal) return
    const removed = keep ? journal.events.filter((event) => !keep(event)) : journal.events
    if (!removed.length && keep) return
    const removedBytes = removed.reduce((total, event) => total + replayEventBytes(event), 0)
    journal.events.splice(0, journal.events.length, ...(keep ? journal.events.filter(keep) : []))
    journal.bufferedBytes -= removedBytes
    this.unattachedReplayEvents -= removed.length
    this.unattachedReplayBytes -= removedBytes
    if (!keep || (!journal.events.length && !journal.overflowedParts.size && !journal.overflowedUnknown)) {
      this.unattachedReplayOverflowParts -= journal.overflowedParts.size
      this.unattachedReplayJournals.delete(sessionID)
    }
  }

  private clearUnattachedOverflowParts(sessionID: string, keep: (key: string) => boolean) {
    const journal = this.unattachedReplayJournals.get(sessionID)
    if (!journal) return
    for (const key of journal.overflowedParts) {
      if (keep(key)) continue
      journal.overflowedParts.delete(key)
      this.unattachedReplayOverflowParts--
    }
    if (!journal.events.length && !journal.overflowedParts.size && !journal.overflowedUnknown) {
      this.unattachedReplayJournals.delete(sessionID)
    }
  }

  private clearReplayGateOverflowParts(sessionID: string, keep: (key: string) => boolean) {
    const gate = this.replayGates.get(sessionID)
    if (!gate) return
    for (const key of gate.overflowedParts) {
      if (!keep(key)) gate.overflowedParts.delete(key)
    }
  }

  private clearReplayGateEvents(sessionID: string, keep: (event: Event) => boolean) {
    const gate = this.replayGates.get(sessionID)
    if (!gate) return
    const removed = gate.events.filter((buffered) => !keep(buffered.event))
    if (!removed.length) return
    gate.events.splice(0, gate.events.length, ...gate.events.filter((buffered) => keep(buffered.event)))
    gate.bufferedBytes -= removed.reduce((total, buffered) => total + replayEventBytes(buffered.event), 0)
  }

  private reconcileUnattachedJournal(event: Event) {
    switch (event.type) {
      case "message.part.updated": {
        const part = event.properties.part
        if ((part.type !== "text" && part.type !== "reasoning") || !partIsFinalized(part)) return
        this.clearUnattachedJournal(event.properties.sessionID, (delta) => {
          return delta.properties.messageID !== part.messageID || delta.properties.partID !== part.id
        })
        const key = overflowPartKey(part.messageID, part.id)
        this.clearUnattachedOverflowParts(event.properties.sessionID, (candidate) => candidate !== key)
        this.clearReplayGateOverflowParts(event.properties.sessionID, (candidate) => candidate !== key)
        return
      }
      case "message.part.removed": {
        this.clearUnattachedJournal(event.properties.sessionID, (delta) => {
          return (
            delta.properties.messageID !== event.properties.messageID ||
            delta.properties.partID !== event.properties.partID
          )
        })
        this.clearReplayGateEvents(event.properties.sessionID, (buffered) => {
          return (
            buffered.type !== "message.part.delta" ||
            buffered.properties.messageID !== event.properties.messageID ||
            buffered.properties.partID !== event.properties.partID
          )
        })
        const key = overflowPartKey(event.properties.messageID, event.properties.partID)
        this.clearUnattachedOverflowParts(event.properties.sessionID, (candidate) => candidate !== key)
        this.clearReplayGateOverflowParts(event.properties.sessionID, (candidate) => candidate !== key)
        return
      }
      case "message.removed": {
        this.clearUnattachedJournal(
          event.properties.sessionID,
          (delta) => delta.properties.messageID !== event.properties.messageID,
        )
        this.clearReplayGateEvents(event.properties.sessionID, (buffered) => {
          return buffered.type !== "message.part.delta" || buffered.properties.messageID !== event.properties.messageID
        })
        const prefix = overflowMessagePrefix(event.properties.messageID)
        this.clearUnattachedOverflowParts(event.properties.sessionID, (candidate) => !candidate.startsWith(prefix))
        this.clearReplayGateOverflowParts(event.properties.sessionID, (candidate) => !candidate.startsWith(prefix))
        return
      }
      case "session.deleted": {
        this.clearUnattachedJournal(event.properties.sessionID)
        const gate = this.replayGates.get(event.properties.sessionID)
        if (gate) gate.invalidated = true
        return
      }
    }
  }

  private queueReplayDrain(gate: ReplayGate, events: readonly Event[]) {
    const drain = this.eventTail
      .then(async () => {
        for (const event of events) {
          await this.handleLive(event).catch(() => {})
        }
      })
      .catch(() => {})
    this.eventTail = drain
    gate.drainTail = drain
    return drain
  }

  private async releaseReplayGate(window: ReplayWindow, gate: ReplayGate) {
    while (true) {
      const drain = gate.drainTail
      await drain
      if (drain !== gate.drainTail) continue
      if (this.replayGates.get(window.sessionID) === gate) this.replayGates.delete(window.sessionID)
      return
    }
  }

  private async handleUnbuffered(event: Event) {
    switch (event.type) {
      case "permission.asked":
        this.permission.handle(event)
        return
      case "message.part.updated":
        return this.handlePartUpdated(event)
      case "message.part.delta":
        return this.handlePartDelta(event)
    }
  }

  private consumeDelayedSnapshot(event: EventMessagePartUpdated) {
    const sessionID = event.properties.part.sessionID || event.properties.sessionID
    const parts = this.delayedSnapshotParts.get(sessionID)
    if (!parts) return false
    const key = replayPartKey(event.properties.part)
    const snapshot = parts.get(key)
    if (!snapshot) return false
    if (!snapshotCoversPart(snapshot, event.properties.part)) {
      parts.delete(key)
      if (!parts.size) this.delayedSnapshotParts.delete(sessionID)
      return false
    }
    if (equivalentPart(snapshot, event.properties.part)) {
      parts.delete(key)
      if (!parts.size) this.delayedSnapshotParts.delete(sessionID)
    }
    return true
  }

  private requireReplayGate(window: ReplayWindow) {
    const gate = this.replayGates.get(window.sessionID)
    if (!gate || gate.token !== window.token) {
      throw new Error(`stale replay window for ${window.sessionID}`)
    }
    return gate
  }

  private async waitForConnection() {
    if (this.connected) return
    if (this.abort.signal.aborted) throw new ReplayBoundaryError("event subscription closed")
    const waiter = Promise.withResolvers<void>()
    this.connectionWaiters.add(waiter)
    try {
      await waiter.promise
    } finally {
      this.connectionWaiters.delete(waiter)
    }
  }

  async replayMessage(message: SessionMessageResponse, window?: ReplayWindow) {
    if (message.info.role !== "assistant" && message.info.role !== "user") return

    const cwd = message.info.role === "assistant" ? message.info.path?.cwd : undefined
    for (const part of message.parts) {
      await this.recordFetchedPart(message.info.sessionID, message, part)
      if (part.type === "tool") {
        await this.handleToolPart(message.info.sessionID, part, cwd ?? process.cwd(), window)
        continue
      }
      await this.replayContentPart(message, part, window)
    }
  }

  private async replayContentPart(message: SessionMessageResponse, part: Part, window?: ReplayWindow) {
    if (part.type !== "text" && part.type !== "file" && part.type !== "reasoning") return

    const sessionUpdate =
      part.type === "reasoning"
        ? "agent_thought_chunk"
        : message.info.role === "user"
          ? "user_message_chunk"
          : "agent_message_chunk"

    for (const chunk of partsToContentChunks([part as ReplayPart])) {
      await this.sendSessionUpdate(
        {
          sessionId: message.info.sessionID,
          update: {
            sessionUpdate,
            messageId: message.info.id,
            ...chunk,
          },
        },
        window,
      )
    }
  }

  private async sendSessionUpdate(params: SessionUpdateParams, window?: ReplayWindow) {
    if (!window) {
      await this.input.connection.sessionUpdate(params)
      return
    }
    const gate = this.requireReplayGate(window)
    if (params.sessionId !== window.sessionID) {
      throw new ReplayBoundaryError("session replay update targeted the wrong session")
    }
    const fingerprint = await replayNotificationFingerprint(params)
    const expected = gate.snapshotNotifications[gate.snapshotCursor]
    if (expected !== undefined) {
      if (expected !== fingerprint) {
        throw new ReplayBoundaryError("session replay snapshot changed after a partial delivery")
      }
      gate.snapshotCursor++
      return
    }
    if (gate.snapshotNotifications.length >= maximumSnapshotCheckpointUpdates) {
      throw new ReplayBoundaryError("session replay snapshot exceeded its checkpoint limit")
    }
    await this.input.connection.sessionUpdate(params)
    gate.snapshotNotifications.push(fingerprint)
    gate.snapshotCursor++
  }

  private receive(event: Event) {
    if (this.abort.signal.aborted) return
    const barrier = this.replayBarriers.get(event.id)
    if (barrier) {
      this.replayBarriers.delete(event.id)
      const gate = this.replayGates.get(barrier.window.sessionID)
      if (!gate || gate.token !== barrier.window.token) {
        barrier.reached.reject(new ReplayBoundaryError("stale event replay barrier"))
      } else {
        barrier.reached.resolve(gate.revision)
      }
      return
    }
    const sessionID = handledSessionID(event)
    if (event.type === "permission.asked" || (sessionID && this.replayGates.has(sessionID))) {
      void this.dispatch(event)
      return
    }
    const pending: PendingLiveEvent = { event, claimedByReplay: false }
    if (sessionID) {
      const events = this.pendingLiveEvents.get(sessionID) ?? new Set<PendingLiveEvent>()
      events.add(pending)
      this.pendingLiveEvents.set(sessionID, events)
    }
    this.eventTail = this.eventTail
      .then(async () => {
        if (sessionID) {
          const events = this.pendingLiveEvents.get(sessionID)
          events?.delete(pending)
          if (events?.size === 0) this.pendingLiveEvents.delete(sessionID)
        }
        if (pending.claimedByReplay) {
          await this.notifyListeners(event)
          return
        }
        await this.dispatch(event, true)
      })
      .catch(() => {})
  }

  private async dispatch(event: Event, liveAtIngress = false) {
    await (liveAtIngress ? this.handleLive(event) : this.handle(event)).catch(() => {})
    await this.notifyListeners(event)
  }

  private async notifyListeners(event: Event) {
    for (const listener of [...this.listeners]) {
      await listener(event).catch(() => {})
    }
  }

  private async handlePartUpdated(event: EventMessagePartUpdated) {
    const part = event.properties.part
    const sessionId = part.sessionID || event.properties.sessionID
    const session = await Effect.runPromise(this.input.session.tryGet(sessionId))
    if (!session) return
    const existing = await Effect.runPromise(
      this.input.session.tryGetPartMetadata({
        sessionId: session.id,
        messageId: part.messageID,
        partId: part.id,
      }),
    )

    await Effect.runPromise(
      this.input.session.recordPartMetadata({
        sessionId: session.id,
        messageId: part.messageID,
        partId: part.id,
        partType: part.type,
        role: part.type === "reasoning" ? "assistant" : existing?.role,
        ignored: part.type === "text" ? part.ignored : undefined,
        toolCallId: part.type === "tool" ? part.callID : undefined,
        metadata: "metadata" in part ? part.metadata : undefined,
      }),
    )
    if (part.type === "tool") {
      await this.handleToolPart(session.id, part, session.cwd)
    }
  }

  private async handlePartDelta(event: EventMessagePartDelta) {
    const props = event.properties
    const session = await Effect.runPromise(this.input.session.tryGet(props.sessionID))
    if (!session) {
      this.retainUnattachedDelta(event)
      return
    }

    const known = await Effect.runPromise(
      this.input.session.tryGetPartMetadata({
        sessionId: session.id,
        messageId: props.messageID,
        partId: props.partID,
      }),
    )
    const metadata =
      known?.role && known.partType
        ? known
        : await this.fetchPartMetadata(session.id, session.cwd, props.messageID, props.partID)
    if (metadata?.role !== "assistant") return
    if (metadata.partType === "text" && props.field === "text" && metadata.ignored !== true) {
      await this.input.connection.sessionUpdate({
        sessionId: session.id,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: props.messageID,
          content: {
            type: "text",
            text: props.delta,
          },
        },
      })
      return
    }

    if (metadata.partType === "reasoning" && props.field === "text") {
      await this.input.connection.sessionUpdate({
        sessionId: session.id,
        update: {
          sessionUpdate: "agent_thought_chunk",
          messageId: props.messageID,
          content: {
            type: "text",
            text: props.delta,
          },
        },
      })
    }
  }

  private async replayUncoveredContent(event: EventMessagePartUpdated) {
    const part = event.properties.part
    if ((part.type !== "text" && part.type !== "reasoning") || !part.text) return
    const sessionID = part.sessionID || event.properties.sessionID
    const session = await Effect.runPromise(this.input.session.tryGet(sessionID))
    if (!session) return
    const known = await Effect.runPromise(
      this.input.session.tryGetPartMetadata({
        sessionId: session.id,
        messageId: part.messageID,
        partId: part.id,
      }),
    )
    const metadata =
      known?.role !== undefined ? known : await this.fetchPartMetadata(session.id, session.cwd, part.messageID, part.id)
    if (metadata?.role !== "assistant") return
    await this.input.connection.sessionUpdate({
      sessionId: session.id,
      update: {
        sessionUpdate: part.type === "reasoning" ? "agent_thought_chunk" : "agent_message_chunk",
        messageId: part.messageID,
        content: {
          type: "text",
          text: part.text,
        },
      },
    })
  }

  private async fetchPartMetadata(sessionId: string, cwd: string, messageId: string, partId: string) {
    const message = await this.input.sdk.session
      .message(
        {
          sessionID: sessionId,
          messageID: messageId,
          directory: cwd,
        },
        { throwOnError: true },
      )
      .then((response) => response.data)
      .catch(() => undefined)
    if (!message) return

    const part = message.parts.find((item) => item.id === partId)
    if (!part) return
    return await this.recordFetchedPart(sessionId, message, part)
  }

  private async recordFetchedPart(sessionId: string, message: SessionMessageResponse, part: Part) {
    return await Effect.runPromise(
      this.input.session.recordPartMetadata({
        sessionId,
        messageId: part.messageID,
        partId: part.id,
        partType: part.type,
        role: message.info.role,
        ignored: part.type === "text" ? part.ignored : undefined,
        toolCallId: part.type === "tool" ? part.callID : undefined,
        metadata: "metadata" in part ? part.metadata : undefined,
      }),
    )
  }

  private async handleToolPart(sessionId: string, part: ToolPart, cwd: string, window?: ReplayWindow) {
    await this.toolStart(sessionId, part, cwd, window)
    const key = toolCacheKey(sessionId, part.callID)

    switch (part.state.status) {
      case "pending":
        this.shellSnapshots.delete(key)
        return

      case "running":
        await this.runningTool(sessionId, part, cwd, window)
        return

      case "completed":
        this.clearTool(sessionId, part.callID)
        await this.sendSessionUpdate(
          {
            sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              ...completedToolUpdate({
                toolCallId: part.callID,
                toolName: part.tool,
                state: part.state,
                cwd,
              }),
            },
          },
          window,
        )
        return

      case "error":
        this.clearTool(sessionId, part.callID)
        await this.sendSessionUpdate(
          {
            sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              ...errorToolUpdate({
                toolCallId: part.callID,
                toolName: part.tool,
                state: part.state,
                cwd,
              }),
            },
          },
          window,
        )
        return
    }
  }

  private async runningTool(sessionId: string, part: ToolPart, cwd: string, window?: ReplayWindow) {
    if (part.state.status !== "running") return

    const key = toolCacheKey(sessionId, part.callID)
    const output = part.tool === "bash" ? shellOutputSnapshot(part.state) : undefined
    if (output !== undefined) {
      if (this.shellSnapshots.get(key) === output) {
        await this.sendSessionUpdate(
          {
            sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              ...duplicateRunningToolUpdate({
                toolCallId: part.callID,
                toolName: part.tool,
                state: part.state,
                cwd,
              }),
            },
          },
          window,
        )
        return
      }
      this.shellSnapshots.set(key, output)
    }

    await this.sendSessionUpdate(
      {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          ...runningToolUpdate({
            toolCallId: part.callID,
            toolName: part.tool,
            state: part.state,
            output,
            cwd,
          }),
        },
      },
      window,
    )
  }

  private async toolStart(sessionId: string, part: ToolPart, cwd: string, window?: ReplayWindow) {
    const key = toolCacheKey(sessionId, part.callID)
    if (this.toolStarts.has(key)) return
    this.toolStarts.add(key)
    await this.sendSessionUpdate(
      {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          ...pendingToolCall({
            toolCallId: part.callID,
            toolName: part.tool,
            state: part.state,
            cwd,
          }),
        },
      },
      window,
    )
  }

  private clearTool(sessionId: string, toolCallId: string) {
    const key = toolCacheKey(sessionId, toolCallId)
    this.toolStarts.delete(key)
    this.shellSnapshots.delete(key)
  }

  private captureToolState(sessionId: string): ToolReplayState {
    const prefix = toolCachePrefix(sessionId)
    return {
      starts: new Set(
        [...this.toolStarts].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)),
      ),
      shellSnapshots: new Map(
        [...this.shellSnapshots]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, output]) => [key.slice(prefix.length), output]),
      ),
    }
  }

  private restoreToolState(sessionId: string, state: ToolReplayState) {
    const prefix = toolCachePrefix(sessionId)
    for (const key of this.toolStarts) {
      if (key.startsWith(prefix)) this.toolStarts.delete(key)
    }
    for (const key of this.shellSnapshots.keys()) {
      if (key.startsWith(prefix)) this.shellSnapshots.delete(key)
    }
    for (const callID of state.starts) this.toolStarts.add(toolCacheKey(sessionId, callID))
    for (const [callID, output] of state.shellSnapshots) {
      this.shellSnapshots.set(toolCacheKey(sessionId, callID), output)
    }
  }

  private applyToolState(sessionId: string, part: ToolPart) {
    const key = toolCacheKey(sessionId, part.callID)
    if (part.state.status === "completed" || part.state.status === "error") {
      this.toolStarts.delete(key)
      this.shellSnapshots.delete(key)
      return
    }
    this.toolStarts.add(key)
    if (part.state.status === "pending") {
      this.shellSnapshots.delete(key)
      return
    }
    const output = part.tool === "bash" ? shellOutputSnapshot(part.state) : undefined
    if (output !== undefined) this.shellSnapshots.set(key, output)
  }
}

function handledSessionID(event: Event) {
  switch (event.type) {
    case "permission.asked":
      return event.properties.sessionID
    case "message.part.updated":
      return event.properties.part.sessionID || event.properties.sessionID
    case "message.part.delta":
      return event.properties.sessionID
    case "message.part.removed":
    case "message.removed":
    case "session.deleted":
      return event.properties.sessionID
    default:
      return
  }
}

function reconcileReplay(
  events: readonly BufferedReplayEvent[],
  boundaryRevision: number,
  snapshot: readonly SessionMessageResponse[],
): ReplayReconciliation {
  const snapshotParts = new Map<string, Part>()
  const snapshotFields = new Map<string, { value: string; finalized: boolean }>()
  for (const message of snapshot) {
    for (const part of message.parts) {
      snapshotParts.set(replayPartKey(part), part)
      if (part.type !== "text" && part.type !== "reasoning") continue
      snapshotFields.set(replayDeltaKey(message.info.sessionID, message.info.id, part.id, "text"), {
        value: part.text,
        finalized: partIsFinalized(part),
      })
    }
  }

  const coveredUpdates = new Set<number>()
  const snapshotMatchedThrough = new Map<string, number>()
  for (const buffered of events) {
    if (buffered.event.type !== "message.part.updated") continue
    const part = buffered.event.properties.part
    const baseline = snapshotParts.get(replayPartKey(part))
    if (!baseline || !equivalentPart(baseline, part)) continue
    snapshotMatchedThrough.set(replayPartKey(part), buffered.revision)
  }
  const latestUncoveredContentUpdate = new Map<string, number>()
  for (const buffered of events) {
    if (buffered.event.type !== "message.part.updated") continue
    const part = buffered.event.properties.part
    const key = replayPartKey(part)
    const matchedThrough = snapshotMatchedThrough.get(key)
    if (matchedThrough !== undefined && buffered.revision <= matchedThrough) {
      coveredUpdates.add(buffered.revision)
      continue
    }
    if (buffered.revision > boundaryRevision) continue
    const baseline = snapshotParts.get(key)
    if (baseline && snapshotCoversPart(baseline, part)) {
      coveredUpdates.add(buffered.revision)
      continue
    }
    if (part.type !== "text" && part.type !== "reasoning") continue
    snapshotFields.set(replayDeltaKey(part.sessionID, part.messageID, part.id, "text"), {
      value: part.text,
      finalized: partIsFinalized(part),
    })
    if (part.text) latestUncoveredContentUpdate.set(key, buffered.revision)
  }

  const groups = new Map<string, BufferedReplayEvent[]>()
  for (const buffered of events) {
    if (buffered.event.type !== "message.part.delta") continue
    if (buffered.revision > boundaryRevision) continue
    const properties = buffered.event.properties
    if (properties.field !== "text") continue
    const key = replayDeltaKey(properties.sessionID, properties.messageID, properties.partID, properties.field)
    const group = groups.get(key)
    if (group) group.push(buffered)
    else groups.set(key, [buffered])
  }

  const covered = new Set<number>()
  for (const [key, deltas] of groups) {
    const field = snapshotFields.get(key)
    if (!field) continue
    if (field.finalized) {
      deltas.forEach((buffered) => covered.add(buffered.revision))
      continue
    }

    const joined = deltas
      .map((buffered) => (buffered.event.type === "message.part.delta" ? buffered.event.properties.delta : ""))
      .join("")
    const coveredCodeUnits = longestPatternPrefixAtTextEnd(joined, field.value)
    let consumedCodeUnits = 0
    for (const buffered of deltas) {
      if (buffered.event.type !== "message.part.delta") continue
      consumedCodeUnits += buffered.event.properties.delta.length
      if (consumedCodeUnits > coveredCodeUnits) break
      covered.add(buffered.revision)
    }
  }
  return {
    coveredDeltas: covered,
    coveredUpdates,
    contentUpdates: new Set(latestUncoveredContentUpdate.values()),
    snapshotParts,
  }
}

function replayDeltaKey(sessionID: string, messageID: string, partID: string, field: string) {
  return `${sessionID}\u0000${messageID}\u0000${partID}\u0000${field}`
}

async function replayNotificationFingerprint(params: SessionUpdateParams) {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(JSON.stringify(params)))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

function overflowMessagePrefix(messageID: string) {
  return `${messageID}\u0000`
}

function overflowPartKey(messageID: string, partID: string) {
  return `${overflowMessagePrefix(messageID)}${partID}`
}

function replayPartKey(part: Part) {
  return `${part.sessionID}\u0000${part.messageID}\u0000${part.id}`
}

function toolCachePrefix(sessionID: string) {
  return `${sessionID}\u0000`
}

function toolCacheKey(sessionID: string, callID: string) {
  return `${toolCachePrefix(sessionID)}${callID}`
}

function partIsFinalized(part: Extract<Part, { type: "text" | "reasoning" }>) {
  return "time" in part && part.time !== undefined && part.time.end !== undefined
}

function equivalentPart(left: Part, right: Part) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function snapshotCoversPart(snapshot: Part, event: Part) {
  if (replayPartKey(snapshot) !== replayPartKey(event) || snapshot.type !== event.type) return false
  if (
    (snapshot.type === "text" || snapshot.type === "reasoning") &&
    (event.type === "text" || event.type === "reasoning")
  ) {
    if (partIsFinalized(snapshot)) return true
    return snapshot.text === event.text || snapshot.text.startsWith(event.text)
  }
  if (snapshot.type === "tool" && event.type === "tool") {
    const rank = (status: string) => {
      if (status === "pending") return 0
      if (status === "running") return 1
      return 2
    }
    const snapshotRank = rank(snapshot.state.status)
    const eventRank = rank(event.state.status)
    if (snapshotRank > eventRank) return true
    if (snapshotRank === 2 && eventRank === 2) return true
  }
  return equivalentPart(snapshot, event)
}

function longestPatternPrefixAtTextEnd(pattern: string, text: string) {
  if (!pattern || !text) return 0
  const prefix = new Uint32Array(pattern.length)
  for (let index = 1; index < pattern.length; index++) {
    let cursor = prefix[index - 1] ?? 0
    while (cursor > 0 && pattern.charCodeAt(index) !== pattern.charCodeAt(cursor)) {
      cursor = prefix[cursor - 1] ?? 0
    }
    if (pattern.charCodeAt(index) === pattern.charCodeAt(cursor)) cursor++
    prefix[index] = cursor
  }
  let cursor = 0
  for (let index = 0; index < text.length; index++) {
    while (cursor > 0 && text.charCodeAt(index) !== pattern.charCodeAt(cursor)) {
      cursor = prefix[cursor - 1] ?? 0
    }
    if (text.charCodeAt(index) === pattern.charCodeAt(cursor)) cursor++
    if (cursor === pattern.length && index + 1 < text.length) {
      cursor = prefix[cursor - 1] ?? 0
    }
  }
  return cursor
}

function replayEventBytes(event: Event) {
  try {
    return textEncoder.encode(JSON.stringify(event)).byteLength
  } catch {
    return maximumBufferedReplayBytes + 1
  }
}

export * as ACPEvent from "./event"
