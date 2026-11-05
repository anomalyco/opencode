import { describe, expect, test } from "bun:test"
import {
  createDraftRetentionState,
  isCurrentSave,
  selectBlobStoreId,
  selectDocumentRevision,
  selectLatestMutation,
  selectRetainedBlob,
  transitionDraftRetention,
  type DraftRetentionEffect,
  type DraftRetentionEvent,
  type DraftRetentionState,
} from "./drafts-machine"

const graceMs = 30
const blob = new Blob(["image"])
const doc = { storeId: 1, key: "draft" }

function run(events: readonly DraftRetentionEvent[], from = createDraftRetentionState()) {
  return events.reduce<{ state: DraftRetentionState; effects: DraftRetentionEffect[] }>(
    (acc, event) => {
      const next = transitionDraftRetention(acc.state, event)

      return { state: next.state, effects: [...acc.effects, ...next.effects] }
    },
    { state: from, effects: [] },
  )
}

const materialize = (id: string, grace: number | undefined = graceMs): DraftRetentionEvent => ({
  type: "blob.materialized",
  id,
  blob,
  url: `blob:${id}`,
  graceMs: grace,
})

const status = (state: DraftRetentionState, id: string) => state.blobs.get(id)?.status

describe("transitionDraftRetention", () => {
  test("a save that outlasts the grace keeps the pasted image it is writing", () => {
    const pasted = run([{ type: "store.registered" }, materialize("img")])
    expect(pasted.effects).toEqual([{ type: "timer.arm", id: "img", attempt: 1, delayMs: graceMs }])

    const saving = run([{ type: "save.started", ...doc, ids: new Set(["img"]), graceMs }], pasted.state)
    expect(saving.effects).toEqual([{ type: "timer.cancel", id: "img" }])
    expect(status(saving.state, "img")).toBe("pinned")

    // The timer callback already queued before the cancel lands late and must not revoke.
    const late = transitionDraftRetention(saving.state, { type: "grace.expired", id: "img", attempt: 1 })
    expect(late.state).toBe(saving.state)
    expect(late.effects).toEqual([])

    const attempt = selectLatestMutation(saving.state, 1, "draft")
    const saved = run([{ type: "save.committed", ...doc, attempt, ids: new Set(["img"]), graceMs }], saving.state)
    expect(saved.effects).toEqual([])
    expect(status(saved.state, "img")).toBe("pinned")
  })

  test("a load that read the document before a save replaced it does not unpin the new image", () => {
    const start = run([{ type: "store.registered" }, materialize("new")]).state
    const revision = selectDocumentRevision(start, 1, "draft")
    const saved = run(
      [
        { type: "save.started", ...doc, ids: new Set(["new"]), graceMs },
        { type: "save.committed", ...doc, attempt: 2, ids: new Set(["new"]), graceMs },
      ],
      start,
    )

    const late = transitionDraftRetention(saved.state, {
      type: "load.succeeded",
      ...doc,
      revision,
      ids: new Set(["old"]),
      graceMs,
    })
    expect(late.state).toBe(saved.state)
    expect(status(late.state, "new")).toBe("pinned")
  })

  test("a load that starts while a save is writing is fenced by the save's commit", () => {
    const saving = run([
      { type: "store.registered" },
      materialize("new"),
      { type: "save.started", ...doc, ids: new Set(["new"]), graceMs },
    ]).state
    const revision = selectDocumentRevision(saving, 1, "draft")
    const attempt = selectLatestMutation(saving, 1, "draft")
    const saved = run([{ type: "save.committed", ...doc, attempt, ids: new Set(["new"]), graceMs }], saving).state

    expect(
      transitionDraftRetention(saved, { type: "load.succeeded", ...doc, revision, ids: new Set(), graceMs }).state,
    ).toBe(saved)
  })

  test("a remove that a later save overtook does not unpin the save's image", () => {
    const removing = run([
      { type: "store.registered" },
      materialize("img"),
      { type: "remove.started", ...doc },
    ]).state
    const removal = selectLatestMutation(removing, 1, "draft")
    const saved = run(
      [{ type: "save.started", ...doc, ids: new Set(["img"]), graceMs }],
      removing,
    )
    const attempt = selectLatestMutation(saved.state, 1, "draft")
    const committed = run([{ type: "save.committed", ...doc, attempt, ids: new Set(["img"]), graceMs }], saved.state)

    const late = transitionDraftRetention(committed.state, { type: "remove.committed", ...doc, attempt: removal, graceMs })
    expect(late.state).toBe(committed.state)
    expect(status(late.state, "img")).toBe("pinned")
  })

  test("a superseded save neither writes nor replaces the committed document", () => {
    const first = run([
      { type: "store.registered" },
      materialize("a"),
      materialize("b"),
      { type: "save.started", ...doc, ids: new Set(["a"]), graceMs },
    ]).state
    const stale = selectLatestMutation(first, 1, "draft")
    const second = run([{ type: "save.started", ...doc, ids: new Set(["b"]), graceMs }], first).state
    expect(isCurrentSave(second, 1, "draft", stale)).toBe(false)

    const current = selectLatestMutation(second, 1, "draft")
    const done = run(
      [
        { type: "save.committed", ...doc, attempt: current, ids: new Set(["b"]), graceMs },
        { type: "save.committed", ...doc, attempt: stale, ids: new Set(["a"]), graceMs },
      ],
      second,
    )
    expect(status(done.state, "a")).toBe("grace")
    expect(status(done.state, "b")).toBe("pinned")
  })

  test("a failed save releases images only the save held", () => {
    const first = run([
      { type: "store.registered" },
      materialize("kept"),
      materialize("new"),
      { type: "save.started", ...doc, ids: new Set(["kept"]), graceMs },
    ]).state
    const committed = run(
      [
        { type: "save.committed", ...doc, attempt: selectLatestMutation(first, 1, "draft"), ids: new Set(["kept"]), graceMs },
        { type: "save.started", ...doc, ids: new Set(["kept", "new"]), graceMs },
      ],
      first,
    ).state
    const attempt = selectLatestMutation(committed, 1, "draft")
    const failed = transitionDraftRetention(committed, { type: "save.aborted", ...doc, attempt, graceMs })
    expect(failed.effects).toEqual([{ type: "timer.arm", id: "new", attempt: expect.any(Number), delayMs: graceMs }])
    expect(status(failed.state, "kept")).toBe("pinned")
    expect(status(failed.state, "new")).toBe("grace")
  })

  test("pasting the same image again during its grace restarts the release, and a page reference keeps it", () => {
    const pasted = run([materialize("img")]).state
    const again = transitionDraftRetention(pasted, { type: "blob.touched", id: "img", graceMs })
    expect(again.effects).toEqual([{ type: "timer.arm", id: "img", attempt: 2, delayMs: graceMs }])
    expect(transitionDraftRetention(again.state, { type: "grace.expired", id: "img", attempt: 1 }).state).toBe(
      again.state,
    )

    const permanent = transitionDraftRetention(again.state, { type: "blob.touched", id: "img", graceMs: undefined })
    expect(permanent.effects).toEqual([{ type: "timer.cancel", id: "img" }])
    expect(status(permanent.state, "img")).toBe("permanent")
    expect(transitionDraftRetention(permanent.state, { type: "grace.expired", id: "img", attempt: 2 }).state).toBe(
      permanent.state,
    )
  })

  test("a released image revokes its URL and drops the aliases that pointed at it", () => {
    const aliased = run([materialize("stored"), { type: "alias.recorded", from: "live", to: "stored" }]).state
    expect(selectRetainedBlob(aliased, "live")?.url).toBe("blob:stored")

    const expired = transitionDraftRetention(aliased, { type: "grace.expired", id: "stored", attempt: 1 })
    expect(expired.effects).toEqual([{ type: "url.revoke", url: "blob:stored" }])
    expect(expired.state.aliases.size).toBe(0)
    expect(selectRetainedBlob(expired.state, "live")).toBeUndefined()
  })

  test("an image resolves through the store whose document references it", () => {
    const state = run([
      { type: "store.registered" },
      { type: "load.succeeded", ...doc, revision: 0, ids: new Set(["first"]), graceMs },
      { type: "store.registered" },
      { type: "load.succeeded", storeId: 2, key: "draft", revision: 0, ids: new Set(), graceMs },
    ]).state

    expect(selectBlobStoreId(state, "first")).toBe(1)
    expect(selectBlobStoreId(state, "unknown")).toBe(2)
    // Each store keeps its own copy of a key.
    expect(state.documents.size).toBe(2)
  })
})
