/**
 * @spec-handoff
 * @interface applyDirectoryEvent({ event: "session.updated", ... }) — archive / unarchive branch
 * @behavior
 *   - sessionTotal is seeded from the server's TOTAL root-session count and drives hasMore /
 *     "load more". It must change by exactly +1 / -1 per genuine root archive-state transition,
 *     never on incidental out-of-window touches.
 *   - UNARCHIVE increment (archived→active): increment store.sessionTotal by 1 ONLY when a ROOT
 *     session.updated with a falsy time.archived genuinely transitions a session OUT of the
 *     archived state. The reducer MUST track the prior archived state (e.g. a set of archived
 *     root ids populated on archive) and increment only when the incoming id was previously
 *     archived. A normal out-of-window root update (title / model / cost / last-message touch on
 *     a session that was already active) hits the same not-found insert path but MUST NOT
 *     increment — otherwise sessionTotal drifts upward and hasMore is stuck true.
 *   - ARCHIVE decrement (active→archived): decrement (clamped at 0) by 1 per genuine root
 *     archive transition. The dedup/index access MUST be guarded by `result.found` BEFORE
 *     reading `store.session[result.index]`. Archiving an out-of-window / not-found root (binary
 *     search returns index === length) MUST NOT throw: never index the store with an
 *     out-of-bounds `result.index`. The window list is left unchanged when the id is not present;
 *     sessionTotal must never increase and never go negative on this path.
 *   - Child sessions (info.parentID set) never change sessionTotal on either path.
 *   - All counting keys off the stable session id, never the nullable time.archived field
 *     (null/undefined collapse into one bucket), so distinct transitions each count once and an
 *     archive→unarchive→archive→unarchive round-trip leaves sessionTotal with zero drift.
 *   - archivedRoots lifecycle (A1, corrected): the archivedRoots map is the authority for the
 *     archive/unarchive count gate. Any terminal event for a tracked id MUST drop its entry so the
 *     map cannot grow unbounded. A `session.deleted` for a root currently tracked in archivedRoots
 *     MUST remove that id from archivedRoots (in addition to its existing window-splice, cache
 *     cleanup, and clamped sessionTotal decrement). Otherwise the entry leaks forever and a later
 *     stray unarchive event for a reused id could spuriously restore the count.
 *   - Stale-tracking cleanup (F2): an in-window root found ACTIVE (falsy archived) on a
 *     session.updated MUST clear any stale archivedRoots[id] entry and MUST NOT increment
 *     sessionTotal — the active state proves no pending unarchive restore is owed.
 *   - Idempotent unarchive (L2): unarchiving (session.updated clearing time.archived) a root that
 *     is NOT tracked in archivedRoots is a no-op for sessionTotal, even if the event is replayed.
 *     The +1 is gated on archivedRoots[id]; an untracked id can never produce a spurious increment.
 * @edge-cases
 *   - BUG 1 (HIGH): event-reducer.ts ~line 156 increments on EVERY not-found root insert, even
 *     a normal out-of-window touch → upward drift. Gate the +1 on a tracked prior-archived id.
 *   - BUG 2 (MEDIUM): event-reducer.ts ~line 130 reads `store.session[result.index]!.time.archived`
 *     before checking `result.found`; when index === store.session.length this is undefined and
 *     throws TypeError. Guard with `result.found` before indexing.
 *   - Round-trip integrity (M1): repeated archive↔unarchive of the same root must net to zero.
 *   - BUG 3 / F1 (MEDIUM): event-reducer.ts ~line 151 decrements sessionTotal on EVERY archive of
 *     an out-of-window root. The dedup guard at ~line 133 only fires when result.found (in-window),
 *     so a duplicate archive of an already-tracked OUT-OF-window id (reconnect replay, a follow-up
 *     session.updated still carrying time.archived, or re-archiving an already-archived session)
 *     decrements sessionTotal a SECOND time → under-count → hasMore wrongly false → "load more"
 *     hides sessions. FIX (Kou): gate the decrement+track on `!archivedRoots[info.id]` so only the
 *     FIRST active→archived transition for an id decrements, exactly mirroring the unarchive +1
 *     gating (~line 177). Duplicate archive events for an already-tracked-archived id must be a
 *     no-op for sessionTotal. Count by the stable session id, never the nullable time.archived.
 *   - A1 (LOW): event-reducer.ts "session.deleted" case (~lines 192-207) never clears
 *     archivedRoots, so a delete of a previously-archived (tracked) root leaks its entry →
 *     unbounded growth. FIX (Kou): delete archivedRoots[info.id] on session.deleted.
 * @see ./event-reducer.ts (applyDirectoryEvent, "session.updated" case ~lines 126-158)
 */
import { describe, expect, test } from "bun:test"
import type { Message, Part, PermissionRequest, Project, QuestionRequest, Session } from "@opencode-ai/sdk/v2/client"
import { createStore } from "solid-js/store"
import type { State } from "./types"
import { applyDirectoryEvent, applyGlobalEvent, cleanupDroppedSessionCaches } from "./event-reducer"

const rootSession = (input: { id: string; parentID?: string; archived?: number }) =>
  ({
    id: input.id,
    parentID: input.parentID,
    time: {
      created: 1,
      updated: 1,
      archived: input.archived,
    },
  }) as Session

const userMessage = (id: string, sessionID: string) =>
  ({
    id,
    sessionID,
    role: "user",
    time: { created: 1 },
    agent: "assistant",
    model: { providerID: "openai", modelID: "gpt" },
  }) as Message

const textPart = (id: string, sessionID: string, messageID: string) =>
  ({
    id,
    sessionID,
    messageID,
    type: "text",
    text: id,
  }) as Part

const permissionRequest = (id: string, sessionID: string, title = id) =>
  ({
    id,
    sessionID,
    permission: title,
    patterns: ["*"],
    metadata: {},
    always: [],
  }) as PermissionRequest

const questionRequest = (id: string, sessionID: string, title = id) =>
  ({
    id,
    sessionID,
    questions: [
      {
        question: title,
        header: title,
        options: [{ label: title, description: title }],
      },
    ],
  }) as QuestionRequest

const baseState = (input: Partial<State> = {}) =>
  ({
    status: "complete",
    agent: [],
    command: [],
    project: "",
    projectMeta: undefined,
    icon: undefined,
    provider: {} as State["provider"],
    config: {} as State["config"],
    path: { directory: "/tmp" } as State["path"],
    session: [],
    sessionTotal: 0,
    session_status: {},
    session_diff: {},
    todo: {},
    permission: {},
    question: {},
    mcp: {},
    lsp: [],
    vcs: undefined,
    limit: 10,
    message: {},
    part: {},
    part_text_accum_delta: {},
    ...input,
  }) as State

describe("applyGlobalEvent", () => {
  test("upserts project.updated in sorted position", () => {
    const project = [{ id: "a" }, { id: "c" }] as Project[]
    let refreshCount = 0
    applyGlobalEvent({
      event: { type: "project.updated", properties: { id: "b" } },
      project,
      refresh: () => {
        refreshCount += 1
      },
      setGlobalProject(next) {
        if (typeof next === "function") next(project)
      },
    })

    expect(project.map((x) => x.id)).toEqual(["a", "b", "c"])
    expect(refreshCount).toBe(0)
  })

  test("handles global.disposed by triggering refresh", () => {
    let refreshCount = 0
    applyGlobalEvent({
      event: { type: "global.disposed" },
      project: [],
      refresh: () => {
        refreshCount += 1
      },
      setGlobalProject() {},
    })

    expect(refreshCount).toBe(1)
  })

  test("handles server.connected by triggering refresh", () => {
    let refreshCount = 0
    applyGlobalEvent({
      event: { type: "server.connected" },
      project: [],
      refresh: () => {
        refreshCount += 1
      },
      setGlobalProject() {},
    })

    expect(refreshCount).toBe(1)
  })
})

describe("applyDirectoryEvent", () => {
  test("preserves a Home-specific retained session limit", () => {
    const [store, setStore] = createStore(
      baseState({
        limit: 1,
        session: [rootSession({ id: "a" }), rootSession({ id: "b" }), rootSession({ id: "c" })],
      }),
    )

    applyDirectoryEvent({
      event: { type: "session.created", properties: { info: rootSession({ id: "d" }) } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
      retainedLimit: 3,
    })

    expect(store.session).toHaveLength(3)
  })

  test("inserts root sessions in sorted order and updates sessionTotal", () => {
    const [store, setStore] = createStore(
      baseState({
        session: [rootSession({ id: "b" })],
        sessionTotal: 1,
      }),
    )

    applyDirectoryEvent({
      event: { type: "session.created", properties: { info: rootSession({ id: "a" }) } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.session.map((x) => x.id)).toEqual(["a", "b"])
    expect(store.sessionTotal).toBe(2)

    applyDirectoryEvent({
      event: { type: "session.created", properties: { info: rootSession({ id: "c", parentID: "a" }) } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.sessionTotal).toBe(2)
  })

  test("cleans session caches when archived", () => {
    const message = userMessage("msg_1", "ses_1")
    const [store, setStore] = createStore(
      baseState({
        session: [rootSession({ id: "ses_1" }), rootSession({ id: "ses_2" })],
        sessionTotal: 2,
        message: { ses_1: [message] },
        part: { [message.id]: [textPart("prt_1", "ses_1", message.id)] },
        session_diff: { ses_1: [] },
        todo: { ses_1: [] },
        permission: { ses_1: [] },
        question: { ses_1: [] },
        session_status: { ses_1: { type: "busy" } },
      }),
    )

    applyDirectoryEvent({
      event: { type: "session.updated", properties: { info: rootSession({ id: "ses_1", archived: 10 }) } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.session.map((x) => x.id)).toEqual(["ses_2"])
    expect(store.sessionTotal).toBe(1)
    expect(store.message.ses_1).toBeUndefined()
    expect(store.part[message.id]).toBeUndefined()
    expect(store.session_diff.ses_1).toBeUndefined()
    expect(store.todo.ses_1).toBeUndefined()
    expect(store.permission.ses_1).toBeUndefined()
    expect(store.question.ses_1).toBeUndefined()
    expect(store.session_status.ses_1).toBeUndefined()
  })

  test("restores a root session and increments sessionTotal when genuinely unarchived", () => {
    // Genuine round-trip: ses_1 is active, gets archived (removed + decremented), then
    // unarchived. Only the genuine archived→active transition restores the count.
    const [store, setStore] = createStore(
      baseState({
        session: [rootSession({ id: "ses_1" }), rootSession({ id: "ses_2" })],
        sessionTotal: 2,
      }),
    )

    applyDirectoryEvent({
      event: { type: "session.updated", properties: { info: rootSession({ id: "ses_1", archived: 10 }) } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.session.map((x) => x.id)).toEqual(["ses_2"])
    expect(store.sessionTotal).toBe(1)

    applyDirectoryEvent({
      event: { type: "session.updated", properties: { info: rootSession({ id: "ses_1", archived: undefined }) } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.session.map((x) => x.id)).toEqual(["ses_1", "ses_2"])
    expect(store.sessionTotal).toBe(2)
  })

  test("keeps sessionTotal stable across an archive→unarchive→archive→unarchive round-trip", () => {
    // M1 integrity: every archive↔unarchive pair must net to zero, no upward or downward drift.
    const [store, setStore] = createStore(
      baseState({
        session: [rootSession({ id: "ses_1" })],
        sessionTotal: 1,
        limit: 10,
      }),
    )

    const archive = (archived: number) =>
      applyDirectoryEvent({
        event: { type: "session.updated", properties: { info: rootSession({ id: "ses_1", archived }) } },
        store,
        setStore,
        push() {},
        directory: "/tmp",
        loadLsp() {},
      })
    const unarchive = () =>
      applyDirectoryEvent({
        event: { type: "session.updated", properties: { info: rootSession({ id: "ses_1", archived: undefined }) } },
        store,
        setStore,
        push() {},
        directory: "/tmp",
        loadLsp() {},
      })

    archive(10)
    expect(store.sessionTotal).toBe(0)
    unarchive()
    expect(store.sessionTotal).toBe(1)
    archive(20)
    expect(store.sessionTotal).toBe(0)
    unarchive()

    expect(store.session.map((x) => x.id)).toEqual(["ses_1"])
    expect(store.sessionTotal).toBe(1)
  })

  test("does not change sessionTotal on a normal out-of-window root update that was never archived", () => {
    // BUG 1 (HIGH): a root session OUTSIDE the loaded window receives a normal touch (title /
    // model / cost / last-message change), NOT an archived→active transition. It hits the
    // not-found insert path and is trimmed back out of the window. sessionTotal is seeded from
    // the server's TOTAL root count, so it MUST NOT move. Current code increments → upward drift
    // that wedges hasMore / "load more" permanently true. This assertion is RED today.
    const [store, setStore] = createStore(
      baseState({
        session: [rootSession({ id: "ses_b" }), rootSession({ id: "ses_c" })],
        sessionTotal: 5,
        limit: 2,
      }),
    )

    applyDirectoryEvent({
      event: { type: "session.updated", properties: { info: rootSession({ id: "ses_z" }) } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    // ses_z is out of window (old timestamp + full window) so it is trimmed back out.
    expect(store.session.map((x) => x.id)).toEqual(["ses_b", "ses_c"])
    expect(store.sessionTotal).toBe(5)
  })

  test("does not change sessionTotal when a child session is unarchived", () => {
    const [store, setStore] = createStore(
      baseState({
        session: [rootSession({ id: "ses_2" })],
        sessionTotal: 1,
      }),
    )

    applyDirectoryEvent({
      event: {
        type: "session.updated",
        properties: { info: rootSession({ id: "ses_1", parentID: "ses_2", archived: undefined }) },
      },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.session.map((x) => x.id)).toEqual(["ses_1", "ses_2"])
    expect(store.sessionTotal).toBe(1)
  })

  test("counts each unarchived root session independently (not bucketed by archived field)", () => {
    // Both unarchive events carry a falsy archived value. A reducer that aggregates by the
    // nullable archived field would collapse them into one bucket and only increment once.
    // Genuine round-trip: archive both, then unarchive both — net zero, each id counted once.
    const [store, setStore] = createStore(
      baseState({
        session: [rootSession({ id: "ses_1" }), rootSession({ id: "ses_2" })],
        sessionTotal: 2,
        limit: 10,
      }),
    )

    applyDirectoryEvent({
      event: { type: "session.updated", properties: { info: rootSession({ id: "ses_1", archived: 10 }) } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    applyDirectoryEvent({
      event: { type: "session.updated", properties: { info: rootSession({ id: "ses_2", archived: 10 }) } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.session.map((x) => x.id)).toEqual([])
    expect(store.sessionTotal).toBe(0)

    applyDirectoryEvent({
      event: { type: "session.updated", properties: { info: rootSession({ id: "ses_1", archived: undefined }) } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.session.map((x) => x.id)).toEqual(["ses_1"])
    expect(store.sessionTotal).toBe(1)

    applyDirectoryEvent({
      event: { type: "session.updated", properties: { info: rootSession({ id: "ses_2", archived: undefined }) } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.session.map((x) => x.id)).toEqual(["ses_1", "ses_2"])
    expect(store.sessionTotal).toBe(2)
  })

  test("does not throw when archiving an out-of-window root that sorts after every loaded session", () => {
    // BUG 2 (MEDIUM): ses_z sorts after every loaded id, so Binary.search returns
    // { found: false, index: store.session.length }. Current code reads
    // `store.session[result.index]!.time.archived` BEFORE checking result.found → store.session
    // [length] is undefined → TypeError. The unarchive feature makes this path reachable.
    // The `.not.toThrow()` assertion is RED today.
    const [store, setStore] = createStore(
      baseState({
        session: [rootSession({ id: "ses_a" }), rootSession({ id: "ses_b" })],
        sessionTotal: 2,
        limit: 10,
      }),
    )

    const run = () =>
      applyDirectoryEvent({
        event: { type: "session.updated", properties: { info: rootSession({ id: "ses_z", archived: 10 }) } },
        store,
        setStore,
        push() {},
        directory: "/tmp",
        loadLsp() {},
      })

    expect(run).not.toThrow()
    // Not in the window → nothing to remove; counting stays sane (no increase, never negative).
    expect(store.session.map((x) => x.id)).toEqual(["ses_a", "ses_b"])
    expect(store.sessionTotal).toBeGreaterThanOrEqual(0)
    expect(store.sessionTotal).toBeLessThanOrEqual(2)
  })

  test("decrements sessionTotal exactly once for duplicate archive events on the same out-of-window root", () => {
    // BUG 3 / F1 (MEDIUM): ses_z is an OUT-OF-WINDOW root (sorts after every loaded id), so
    // Binary.search returns { found: false, index: store.session.length }. The dedup guard only
    // fires when result.found (in-window), so it does NOT cover this id. A SECOND archive event
    // for the same id (reconnect replay, a follow-up session.updated still carrying time.archived,
    // or re-archiving an already-archived session) re-tracks the id and decrements sessionTotal a
    // SECOND time. The decrement MUST be idempotent per stable id: gated on !archivedRoots[id],
    // mirroring the unarchive +1 gating. Current code double-decrements (5 → 4 → 3); this asserts
    // exactly one decrement (5 → 4 → 4). RED today.
    const [store, setStore] = createStore(
      baseState({
        session: [rootSession({ id: "ses_a" }), rootSession({ id: "ses_b" })],
        sessionTotal: 5,
        limit: 2,
      }),
    )

    const archiveOutOfWindow = () =>
      applyDirectoryEvent({
        event: { type: "session.updated", properties: { info: rootSession({ id: "ses_z", archived: 10 }) } },
        store,
        setStore,
        push() {},
        directory: "/tmp",
        loadLsp() {},
      })

    archiveOutOfWindow()
    expect(store.sessionTotal).toBe(4)

    // Duplicate archive of the same already-tracked out-of-window id must be a no-op for the count.
    archiveOutOfWindow()
    expect(store.sessionTotal).toBe(4)

    // The window is untouched on the archive path for a not-found id.
    expect(store.session.map((x) => x.id)).toEqual(["ses_a", "ses_b"])
  })

  test("nets sessionTotal to zero when an out-of-window root is archived twice then unarchived once", () => {
    // F1 symmetry lock: a duplicate out-of-window archive followed by a single genuine unarchive
    // must return sessionTotal to its original value. With the unguarded decrement the count goes
    // 5 → 4 → 3 → 4 (net -1, sessions silently hidden); with the idempotent guard it goes
    // 5 → 4 → 4 → 5 (net zero). RED today.
    const [store, setStore] = createStore(
      baseState({
        session: [rootSession({ id: "ses_a" }), rootSession({ id: "ses_b" })],
        sessionTotal: 5,
        limit: 2,
      }),
    )

    const archive = () =>
      applyDirectoryEvent({
        event: { type: "session.updated", properties: { info: rootSession({ id: "ses_z", archived: 10 }) } },
        store,
        setStore,
        push() {},
        directory: "/tmp",
        loadLsp() {},
      })

    archive()
    archive()
    applyDirectoryEvent({
      event: { type: "session.updated", properties: { info: rootSession({ id: "ses_z", archived: undefined }) } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.sessionTotal).toBe(5)
  })

  test("removes a tracked archivedRoots entry when its root session is deleted", () => {
    // A1 (LOW) — GENUINE RED: a root that was archived is tracked in archivedRoots (already
    // spliced out of the window and decremented, awaiting a possible unarchive restore). If the
    // user DELETES that archived root instead of unarchiving it, session.deleted must drop its
    // archivedRoots entry. Current code (event-reducer.ts ~lines 192-207) never touches
    // archivedRoots on delete, so the entry leaks forever (unbounded map growth) and a later
    // stray unarchive for a reused id could spuriously restore the count. This assertion is RED
    // today: store.archivedRoots.ses_1 is still `true` after the delete.
    const [store, setStore] = createStore(
      baseState({
        session: [rootSession({ id: "ses_2" })],
        sessionTotal: 1,
        archivedRoots: { ses_1: true },
      }),
    )

    applyDirectoryEvent({
      event: { type: "session.deleted", properties: { info: rootSession({ id: "ses_1", archived: 10 }) } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.archivedRoots?.ses_1).toBeUndefined()
  })

  test("clears a stale archivedRoots entry without incrementing on an in-window active root update", () => {
    // F2 (CHARACTERIZATION / GUARD — currently GREEN): an in-window root found ACTIVE (falsy
    // archived) on session.updated must NOT increment sessionTotal and must clear any stale
    // archivedRoots[id] entry so it cannot trigger a later spurious +1. Current code already does
    // both (event-reducer.ts ~lines 159-169); this test locks that behavior against a regression
    // that forgot the stale-tracking cleanup or double-counted the active touch.
    const [store, setStore] = createStore(
      baseState({
        session: [rootSession({ id: "ses_1" }), rootSession({ id: "ses_2" })],
        sessionTotal: 2,
        // Stale: tracked as archived, but the session is actually present and active in the window.
        archivedRoots: { ses_1: true },
      }),
    )

    applyDirectoryEvent({
      event: { type: "session.updated", properties: { info: rootSession({ id: "ses_1" }) } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.sessionTotal).toBe(2)
    expect(store.archivedRoots?.ses_1).toBeUndefined()
  })

  test("keeps sessionTotal idempotent across repeated unarchive events for an untracked root", () => {
    // L2 (CHARACTERIZATION / GUARD — currently GREEN): unarchiving (session.updated clearing
    // time.archived) a root that is NOT tracked in archivedRoots must never add to the count, even
    // if the event is delivered twice (reconnect replay / a follow-up update). The +1 is gated on
    // archivedRoots[id] (event-reducer.ts ~line 182), so an untracked id is a no-op. This guards
    // that gate against a regression that increments on every not-found insert (the original BUG 1).
    const [store, setStore] = createStore(
      baseState({
        session: [rootSession({ id: "ses_a" }), rootSession({ id: "ses_b" })],
        sessionTotal: 5,
        limit: 2,
      }),
    )

    const unarchiveUntracked = () =>
      applyDirectoryEvent({
        event: { type: "session.updated", properties: { info: rootSession({ id: "ses_z", archived: undefined }) } },
        store,
        setStore,
        push() {},
        directory: "/tmp",
        loadLsp() {},
      })

    unarchiveUntracked()
    expect(store.sessionTotal).toBe(5)
    // A replay of the same untracked unarchive must remain a no-op for the count.
    unarchiveUntracked()
    expect(store.sessionTotal).toBe(5)
  })

  test("cleans session caches when deleted and decrements only root totals", () => {
    const cases = [
      { info: rootSession({ id: "ses_1" }), expectedTotal: 1 },
      { info: rootSession({ id: "ses_2", parentID: "ses_1" }), expectedTotal: 2 },
    ]

    for (const item of cases) {
      const message = userMessage("msg_1", item.info.id)
      const [store, setStore] = createStore(
        baseState({
          session: [
            rootSession({ id: "ses_1" }),
            rootSession({ id: "ses_2", parentID: "ses_1" }),
            rootSession({ id: "ses_3" }),
          ],
          sessionTotal: 2,
          message: { [item.info.id]: [message] },
          part: { [message.id]: [textPart("prt_1", item.info.id, message.id)] },
          session_diff: { [item.info.id]: [] },
          todo: { [item.info.id]: [] },
          permission: { [item.info.id]: [] },
          question: { [item.info.id]: [] },
          session_status: { [item.info.id]: { type: "busy" } },
        }),
      )

      applyDirectoryEvent({
        event: { type: "session.deleted", properties: { info: item.info } },
        store,
        setStore,
        push() {},
        directory: "/tmp",
        loadLsp() {},
      })

      expect(store.session.find((x) => x.id === item.info.id)).toBeUndefined()
      expect(store.sessionTotal).toBe(item.expectedTotal)
      expect(store.message[item.info.id]).toBeUndefined()
      expect(store.part[message.id]).toBeUndefined()
      expect(store.session_diff[item.info.id]).toBeUndefined()
      expect(store.todo[item.info.id]).toBeUndefined()
      expect(store.permission[item.info.id]).toBeUndefined()
      expect(store.question[item.info.id]).toBeUndefined()
      expect(store.session_status[item.info.id]).toBeUndefined()
    }
  })

  test("cleans caches for trimmed sessions on session.created", () => {
    const dropped = rootSession({ id: "ses_b" })
    const kept = rootSession({ id: "ses_a" })
    const message = userMessage("msg_1", dropped.id)
    const todos: string[] = []
    const [store, setStore] = createStore(
      baseState({
        limit: 1,
        session: [dropped],
        message: { [dropped.id]: [message] },
        part: { [message.id]: [textPart("prt_1", dropped.id, message.id)] },
        session_diff: { [dropped.id]: [] },
        todo: { [dropped.id]: [] },
        permission: { [dropped.id]: [] },
        question: { [dropped.id]: [] },
        session_status: { [dropped.id]: { type: "busy" } },
      }),
    )

    applyDirectoryEvent({
      event: { type: "session.created", properties: { info: kept } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
      setSessionTodo(sessionID, value) {
        if (value !== undefined) return
        todos.push(sessionID)
      },
    })

    expect(store.session.map((x) => x.id)).toEqual([kept.id])
    expect(store.message[dropped.id]).toBeUndefined()
    expect(store.part[message.id]).toBeUndefined()
    expect(store.session_diff[dropped.id]).toBeUndefined()
    expect(store.todo[dropped.id]).toBeUndefined()
    expect(store.permission[dropped.id]).toBeUndefined()
    expect(store.question[dropped.id]).toBeUndefined()
    expect(store.session_status[dropped.id]).toBeUndefined()
    expect(todos).toEqual([dropped.id])
  })

  test("cleanupDroppedSessionCaches clears part-only orphan state", () => {
    const [store, setStore] = createStore(
      baseState({
        session: [rootSession({ id: "ses_keep" })],
        part: { msg_1: [textPart("prt_1", "ses_drop", "msg_1")] },
      }),
    )

    cleanupDroppedSessionCaches(store, setStore, store.session)

    expect(store.part.msg_1).toBeUndefined()
  })

  test("upserts and removes messages while clearing orphaned parts", () => {
    const sessionID = "ses_1"
    const [store, setStore] = createStore(
      baseState({
        message: { [sessionID]: [userMessage("msg_1", sessionID), userMessage("msg_3", sessionID)] },
        part: { msg_2: [textPart("prt_1", sessionID, "msg_2")] },
      }),
    )

    applyDirectoryEvent({
      event: { type: "message.updated", properties: { info: userMessage("msg_2", sessionID) } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.message[sessionID]?.map((x) => x.id)).toEqual(["msg_1", "msg_2", "msg_3"])

    applyDirectoryEvent({
      event: {
        type: "message.updated",
        properties: {
          info: {
            ...userMessage("msg_2", sessionID),
            role: "assistant",
          } as Message,
        },
      },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.message[sessionID]?.find((x) => x.id === "msg_2")?.role).toBe("assistant")

    applyDirectoryEvent({
      event: { type: "message.removed", properties: { sessionID, messageID: "msg_2" } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.message[sessionID]?.map((x) => x.id)).toEqual(["msg_1", "msg_3"])
    expect(store.part.msg_2).toBeUndefined()
  })

  test("upserts and prunes message parts", () => {
    const sessionID = "ses_1"
    const messageID = "msg_1"
    const [store, setStore] = createStore(
      baseState({
        part: { [messageID]: [textPart("prt_1", sessionID, messageID), textPart("prt_3", sessionID, messageID)] },
      }),
    )

    applyDirectoryEvent({
      event: { type: "message.part.updated", properties: { part: textPart("prt_2", sessionID, messageID) } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    expect(store.part[messageID]?.map((x) => x.id)).toEqual(["prt_1", "prt_2", "prt_3"])

    applyDirectoryEvent({
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            ...textPart("prt_2", sessionID, messageID),
            text: "changed",
          } as Part,
        },
      },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    const updated = store.part[messageID]?.find((x) => x.id === "prt_2")
    expect(updated?.type).toBe("text")
    if (updated?.type === "text") expect(updated.text).toBe("changed")

    applyDirectoryEvent({
      event: { type: "message.part.removed", properties: { messageID, partID: "prt_1" } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    applyDirectoryEvent({
      event: { type: "message.part.removed", properties: { messageID, partID: "prt_2" } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    applyDirectoryEvent({
      event: { type: "message.part.removed", properties: { messageID, partID: "prt_3" } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.part[messageID]).toBeUndefined()
  })

  test("tracks permission and question request lifecycles", () => {
    const sessionID = "ses_1"
    const [store, setStore] = createStore(
      baseState({
        permission: { [sessionID]: [permissionRequest("perm_1", sessionID), permissionRequest("perm_3", sessionID)] },
        question: { [sessionID]: [questionRequest("q_1", sessionID), questionRequest("q_3", sessionID)] },
      }),
    )

    applyDirectoryEvent({
      event: { type: "permission.asked", properties: permissionRequest("perm_2", sessionID) },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    expect(store.permission[sessionID]?.map((x) => x.id)).toEqual(["perm_1", "perm_2", "perm_3"])

    applyDirectoryEvent({
      event: { type: "permission.asked", properties: permissionRequest("perm_2", sessionID, "updated") },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    expect(store.permission[sessionID]?.find((x) => x.id === "perm_2")?.permission).toBe("updated")

    applyDirectoryEvent({
      event: { type: "permission.replied", properties: { sessionID, requestID: "perm_2" } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    expect(store.permission[sessionID]?.map((x) => x.id)).toEqual(["perm_1", "perm_3"])

    applyDirectoryEvent({
      event: { type: "question.asked", properties: questionRequest("q_2", sessionID) },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    expect(store.question[sessionID]?.map((x) => x.id)).toEqual(["q_1", "q_2", "q_3"])

    applyDirectoryEvent({
      event: { type: "question.asked", properties: questionRequest("q_2", sessionID, "updated") },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    expect(store.question[sessionID]?.find((x) => x.id === "q_2")?.questions[0]?.header).toBe("updated")

    applyDirectoryEvent({
      event: { type: "question.rejected", properties: { sessionID, requestID: "q_2" } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    expect(store.question[sessionID]?.map((x) => x.id)).toEqual(["q_1", "q_3"])
  })

  test("updates vcs branch in store and cache", () => {
    const [store, setStore] = createStore(baseState({ vcs: { branch: "main", default_branch: "main" } }))
    const [cacheStore, setCacheStore] = createStore({
      value: { branch: "main", default_branch: "main" } as State["vcs"],
    })

    applyDirectoryEvent({
      event: { type: "vcs.branch.updated", properties: { branch: "feature/test" } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
      vcsCache: {
        store: cacheStore,
        setStore: setCacheStore,
        ready: () => true,
      },
    })

    expect(store.vcs).toEqual({ branch: "feature/test", default_branch: "main" })
    expect(cacheStore.value).toEqual({ branch: "feature/test", default_branch: "main" })
  })

  test("routes disposal and lsp events to side-effect handlers", () => {
    const [store, setStore] = createStore(baseState())
    const pushes: string[] = []
    let lspLoads = 0

    applyDirectoryEvent({
      event: { type: "server.instance.disposed" },
      store,
      setStore,
      push(directory) {
        pushes.push(directory)
      },
      directory: "/tmp",
      loadLsp() {
        lspLoads += 1
      },
    })

    applyDirectoryEvent({
      event: { type: "lsp.updated" },
      store,
      setStore,
      push(directory) {
        pushes.push(directory)
      },
      directory: "/tmp",
      loadLsp() {
        lspLoads += 1
      },
    })

    expect(pushes).toEqual(["/tmp"])
    expect(lspLoads).toBe(1)
  })
})
