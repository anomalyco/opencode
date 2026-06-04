import { Effect } from "effect"
import { SessionLegacy } from "@opencode-ai/core/session/legacy"
import { MessageV2 } from "./message-v2"
import { PartID, type SessionID } from "./schema"
import type { Interface as SessionInterface } from "./session"

type ReplayTarget = {
  assistantMessage: SessionLegacy.Assistant
  sessionID: SessionID
  snapshot: string | undefined
  needsCompaction: boolean
}

type ReplayState = {
  finish: MessageV2.Assistant["finish"]
  cost: MessageV2.Assistant["cost"]
  tokens: MessageV2.Assistant["tokens"]
  snapshot: string | undefined
  needsCompaction: boolean
}

type RecoveryState = {
  attemptHasToolActivity: boolean
  requestHasCommittedToolBoundary: boolean
  attemptCommitted: boolean
  hasAttemptParts: boolean
}

type Options = {
  target: ReplayTarget
  resetOpenParts: () => void
}

export namespace SessionAttempt {
  export function create(options: Options) {
    return new AttemptState(options)
  }
}

class AttemptState {
  private requestHasCommittedToolBoundary = false
  private attemptHasToolActivity = false
  private attemptCommitted = false
  private attemptNeedsReset = false
  private attemptPartIDs: PartID[] = []
  private replayState: ReplayState

  constructor(private readonly options: Options) {
    this.replayState = this.captureReplayState()
  }

  rememberPart(partID: PartID) {
    if (this.attemptPartIDs.includes(partID)) return
    this.attemptPartIDs.push(partID)
  }

  markToolActivity() {
    this.attemptHasToolActivity = true
  }

  markCommitted() {
    this.attemptCommitted = true
  }

  commitToolBoundary() {
    this.requestHasCommittedToolBoundary = true
    this.resetReplayGuardState()
    this.attemptNeedsReset = false
  }

  reset() {
    this.resetReplayGuardState()
    this.attemptNeedsReset = false
    this.options.resetOpenParts()
  }

  resetIfNeeded() {
    if (!this.attemptNeedsReset) return
    this.resetReplayGuardState()
    this.attemptNeedsReset = false
  }

  deferReset() {
    this.attemptNeedsReset = true
  }

  recoveryState(): RecoveryState {
    return {
      attemptHasToolActivity: this.attemptHasToolActivity,
      requestHasCommittedToolBoundary: this.requestHasCommittedToolBoundary,
      attemptCommitted: this.attemptCommitted,
      hasAttemptParts: this.attemptPartIDs.length > 0,
    }
  }

  hasCommittedToolBoundary() {
    return this.requestHasCommittedToolBoundary
  }

  rollbackCurrent(session: SessionInterface) {
    const self = this
    return Effect.gen(function* () {
      if (self.attemptPartIDs.length > 0) {
        yield* Effect.forEach(
          [...self.attemptPartIDs].reverse(),
          (partID) =>
            session.removePart({
              sessionID: self.options.target.sessionID,
              messageID: self.options.target.assistantMessage.id,
              partID,
            }),
          { discard: true },
        )
      }

      self.restoreReplayState()
      yield* session.updateMessage(self.options.target.assistantMessage)
      self.reset()
    }).pipe(Effect.withSpan("SessionAttempt.rollbackCurrent"))
  }

  private captureReplayState(): ReplayState {
    return {
      finish: this.options.target.assistantMessage.finish,
      cost: this.options.target.assistantMessage.cost,
      tokens: cloneTokens(this.options.target.assistantMessage.tokens),
      snapshot: this.options.target.snapshot,
      needsCompaction: this.options.target.needsCompaction,
    }
  }

  private restoreReplayState() {
    this.options.target.assistantMessage.finish = this.replayState.finish
    this.options.target.assistantMessage.cost = this.replayState.cost
    this.options.target.assistantMessage.tokens = cloneTokens(this.replayState.tokens)
    this.options.target.snapshot = this.replayState.snapshot
    this.options.target.needsCompaction = this.replayState.needsCompaction
  }

  private resetReplayGuardState() {
    this.attemptHasToolActivity = false
    this.attemptCommitted = false
    this.attemptPartIDs = []
    this.replayState = this.captureReplayState()
  }
}

function cloneTokens(tokens: MessageV2.Assistant["tokens"]): MessageV2.Assistant["tokens"] {
  return {
    ...tokens,
    cache: { ...tokens.cache },
  }
}
