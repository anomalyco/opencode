import { describe, expect, test } from "bun:test"
import { ServerKey } from "@/runtime/server/persistence"
import { createMemoryComposerState } from "@/composer/state"
import { createNewSessionStartState, viewNewSessionStart } from "@/new-session/machine"
import { tabKey, type DraftTab, type PendingSession, type SessionTab } from "./tabs"
import {
  INITIAL_TAB_PROMOTION_STATE,
  pendingPromotion,
  transitionTabPromotion,
  type ComposerTarget,
  type TabPromotionEvent,
  type TabPromotionState,
} from "./promotion-machine"

const server = ServerKey.make("server")

const other = ServerKey.make("other")

const draft: DraftTab = { type: "draft", draftID: "draft", server, directory: "/project", branch: "main" }

const session: SessionTab = { type: "session", server, sessionId: "ses_pending" }

const key = tabKey(session)

const target: ComposerTarget = createMemoryComposerState().capture()

const pending: PendingSession = {
  draft,
  message: { id: "msg_pending", type: "user", text: "Hello", time: { created: 1 } },
  selection: { agent: "build", model: { providerID: "provider", modelID: "model" } },
  composer: createMemoryComposerState(),
  view: () => viewNewSessionStart(createNewSessionStartState()),
}

function replay(events: TabPromotionEvent[], state: TabPromotionState = INITIAL_TAB_PROMOTION_STATE) {
  return events.reduce<{ state: TabPromotionState; effects: string[][] }>(
    (acc, event) => {
      const result = transitionTabPromotion(acc.state, event)

      return { state: result.state, effects: [...acc.effects, result.effects.map((effect) => effect.type)] }
    },
    { state, effects: [] },
  )
}

const prepare: TabPromotionEvent = { type: "prepare", key, session, pending }

describe("tab promotion", () => {
  test("a rollback while the completion awaits the session prompt cannot restore a draft the completion disposes", () => {
    const result = replay([
      prepare,
      { type: "complete.start", key, attempt: 1, target },
      { type: "rollback.start", key, attempt: 1 },
      { type: "rollback.settled", key, attempt: 1, open: true },
      { type: "complete.settled", key, attempt: 1 },
    ])

    expect(result.effects).toEqual([[], [], [], [], ["composer.transfer", "draft.dispose"]])
    expect(pendingPromotion(result.state, key)).toBeUndefined()
  })

  test("a rollback keeps the restored draft's prompt and ignores a late completion", () => {
    const result = transitionTabPromotion(
      replay([
        prepare,
        { type: "rollback.start", key, attempt: 1, worktree: "/worktree" },
        { type: "complete.start", key, attempt: 1, target },
        { type: "complete.settled", key, attempt: 1 },
      ]).state,
      { type: "rollback.settled", key, attempt: 1, open: true },
    )

    expect(result.effects).toEqual([
      { type: "composer.recover", draft, composer: pending.composer },
      { type: "tab.restore", key, session, draft: { ...draft, worktree: "/worktree", branch: undefined } },
      { type: "session.cleanup", key, session },
    ])
  })

  test("a second rollback cannot recover the follow-up prompt twice", () => {
    const result = replay([
      prepare,
      { type: "rollback.start", key, attempt: 1 },
      { type: "rollback.start", key, attempt: 1 },
      { type: "rollback.settled", key, attempt: 1, open: true },
      { type: "rollback.settled", key, attempt: 1, open: true },
    ])

    expect(result.effects).toEqual([[], [], [], ["composer.recover", "tab.restore", "session.cleanup"], []])
  })

  test("a rollback of a pending tab the user closed disposes its draft instead of restoring it", () => {
    const result = replay([
      prepare,
      { type: "rollback.start", key, attempt: 1 },
      { type: "rollback.settled", key, attempt: 1, open: false },
    ])

    expect(result.effects.at(-1)).toEqual(["session.cleanup", "draft.dispose"])
    expect(pendingPromotion(result.state, key)).toBeUndefined()
  })

  test("the pending session stays readable until its promotion settles", () => {
    const completing = replay([prepare, { type: "complete.start", key, attempt: 1, target }]).state
    const rolling = replay([prepare, { type: "rollback.start", key, attempt: 1 }]).state

    expect(pendingPromotion(replay([prepare]).state, key)).toBe(pending)
    expect(pendingPromotion(completing, key)).toBe(pending)
    expect(pendingPromotion(rolling, key)).toBe(pending)
  })

  test("a result for an earlier attempt is ignored", () => {
    const state = replay([prepare, prepare]).state

    expect(transitionTabPromotion(state, { type: "complete.start", key, attempt: 1, target }).state).toBe(state)
    expect(transitionTabPromotion(state, { type: "rollback.start", key, attempt: 1 }).state).toBe(state)
    expect(transitionTabPromotion(state, { type: "complete.start", key, attempt: 2, target }).state).not.toBe(state)
  })

  const removals: { name: string; event: TabPromotionEvent }[] = [
    { name: "its session is removed", event: { type: "abandon", keys: [key] } },
    { name: "its server is removed", event: { type: "abandon.server", server } },
    { name: "its server is no longer known", event: { type: "keep.servers", servers: new Set([other]) } },
  ]

  const phases: { phase: string; events: TabPromotionEvent[] }[] = [
    { phase: "preparing", events: [prepare] },
    { phase: "completing", events: [prepare, { type: "complete.start", key, attempt: 1, target }] },
    { phase: "rolling back", events: [prepare, { type: "rollback.start", key, attempt: 1 }] },
  ]

  test.each(removals.flatMap((removal) => phases.map((phase) => ({ ...removal, ...phase }))))(
    "a $phase promotion is cleaned up when $name and ignores its late result",
    ({ event, events }) => {
      const result = replay([
        ...events,
        event,
        { type: "complete.settled", key, attempt: 1 },
        { type: "rollback.settled", key, attempt: 1, open: true },
      ])

      expect(result.effects.slice(events.length)).toEqual([["session.cleanup", "draft.dispose"], [], []])
      expect(pendingPromotion(result.state, key)).toBeUndefined()
    },
  )

  test("removing nothing that is pending keeps the state", () => {
    const state = replay([prepare]).state

    expect(transitionTabPromotion(state, { type: "abandon", keys: ["other"] }).state).toBe(state)
    expect(transitionTabPromotion(state, { type: "abandon.server", server: other }).state).toBe(state)
    expect(transitionTabPromotion(state, { type: "keep.servers", servers: new Set([server]) }).state).toBe(state)
  })

  test("a disposed provider ignores every later event", () => {
    const disposed = replay([prepare, { type: "dispose" }]).state

    expect(disposed).toEqual({ status: "disposed" })
    expect(pendingPromotion(disposed, key)).toBeUndefined()
    expect(replay([prepare, { type: "complete.settled", key, attempt: 1 }], disposed)).toEqual({
      state: disposed,
      effects: [[], []],
    })
  })
})
