import { Option, Schema } from "effect"
import type { PromptAttachment, SessionInboxInfo } from "@opencode/client/promise"
import type { ComposerDelivery } from "@/composer/adapter"
import type { ComposerStateTarget } from "@/composer/submission-state"
import type { ContextItem, ImageAttachmentPart, PathAttachmentPart, Prompt } from "@/composer/state"
import { appendPrompt, clonePrompt, isAttachment, promptLength } from "@/composer/prompt-parts"
import { readPromptPresentation } from "@/composer/comment-note"
import { type BlobReference, createLegacyBlobReference } from "@/runtime/persistence/drafts"

export type QueuedPrompt = Extract<SessionInboxInfo, { type: "user" }>

export type EditStash = {
  readonly prompt: Prompt
  readonly cursor: number
  readonly mode: "normal" | "shell"
  readonly retry: ReturnType<ComposerStateTarget["retry"]["current"]>
}

// The queued prompt loaded in the composer. `stash` is the draft the composer held before the first row opened; every
// way out of the edit puts it back. `pin` tags the media pin started when this row opened.
export type ActiveEdit = {
  readonly id: string
  readonly item: QueuedPrompt
  readonly pin: number
  readonly stash: EditStash
}

export type QueueRow = {
  readonly id: string
  readonly text: string
  readonly attachments: number
  readonly pending?: boolean
}

// An edit confirmed from the composer. `moved` maps each inbox ID the edit replaces to the ID admitted in its place:
// the original's replacement and, for a queued edit, the prompts after it, re-admitted to keep their order.
export type EditOperation = {
  readonly type: "edit"
  readonly original: string
  readonly delivery: ComposerDelivery
  readonly item: QueuedPrompt
  readonly prompt: Prompt
  readonly raw: string
  readonly text: string
  readonly attachments: number
  readonly moved: Readonly<Record<string, string>>
}

export type QueuedOperation =
  | EditOperation
  | { readonly type: "steer"; readonly id: string }
  | { readonly type: "remove"; readonly id: string }

// Operations that leave the composer free, so a row can be edited while one runs. `cancelling` means the server
// admitted every replacement, so a later failure must not hand the edit back to the composer.
export type ConcurrentOperation =
  | (EditOperation & { readonly attempt: number; readonly phase: "admitting" | "cancelling" })
  | { readonly type: "steer"; readonly attempt: number; readonly id: string }
  | { readonly type: "remove"; readonly attempt: number; readonly id: string }

export type ActiveOperation =
  | ConcurrentOperation
  | {
      readonly type: "reorder"
      readonly attempt: number
      readonly inboxIDs: readonly string[]
      // Reordering re-admits prompts under new inbox IDs. The rows keep their keys and order until the whole rewrite
      // settles, so admission and cancellation events cannot grow or shrink the strip.
      readonly rows: readonly QueueRow[]
      readonly moved: Readonly<Record<string, string>>
    }
  | { readonly type: "undo"; readonly attempt: number; readonly item: QueuedPrompt }

// Prompts the server confirmed have left the queue. The pending list drops them only when the server's events arrive,
// which lag on a loaded server, so the strip hides them until then. A missed event would hide a row for good, so each
// entry expires.
type GoneEntry = { readonly id: string; readonly expiry: number }

type QueueBase = {
  readonly seq: number
  readonly items: readonly QueuedPrompt[]
  readonly gone: readonly GoneEntry[]
  // Each inbox ID a finished edit or reorder replaced, mapped to the ID admitted in its place, so the strip can swap
  // the row in place. An entry is dropped once no ID along its chain is queued.
  readonly moved: Readonly<Record<string, string>>
}

const NO_MOVES: Readonly<Record<string, string>> = Object.freeze({})

/**
 * Bounds an edit, reorder or undo, whose chains include local media reads and one request per rewritten prompt. Each
 * request already fails on its own after the request queue's 60 s wait for headers; a steer or removal is one request,
 * so it needs no other bound.
 */
export const QUEUE_MUTATION_TIMEOUT_MS = 60_000

/**
 * How far a timed-out operation got. `committed`: a step it cannot take back is in flight (an undo's cancel, or the
 * cancels of a rewrite's originals once every copy is in), so the operation waits for its result. `settled`: the server
 * holds the whole change and only re-reading its queue stalled.
 */
export type QueueMutationStage = "running" | "committed" | "settled"

// After unmount, an operation still in flight can owe the composer's saved draft a prompt: an edit the server never
// admitted, or an undo whose cancel the server may still apply.
type DisposedReturn =
  | { readonly type: "edit"; readonly attempt: number; readonly prompt: Prompt }
  | { readonly type: "undo"; readonly attempt: number }

// Operations run one at a time in the order they were requested: `active` is in flight and `pending` waits for it.
export type QueueState =
  | (QueueBase & { readonly status: "idle" })
  | (QueueBase & { readonly status: "editing"; readonly edit: ActiveEdit })
  | (QueueBase & {
      readonly status: "mutating"
      readonly active: ActiveOperation
      readonly pending: readonly QueuedOperation[]
    })
  | (QueueBase & {
      readonly status: "editing-while-mutating"
      readonly edit: ActiveEdit
      readonly active: ConcurrentOperation
      readonly pending: readonly QueuedOperation[]
    })
  | { readonly status: "disposed"; readonly returning?: DisposedReturn }

type LiveQueueState = Exclude<QueueState, { status: "disposed" }>

export type QueueEvent =
  | { readonly type: "inbox.synced"; readonly items: readonly QueuedPrompt[] }
  | { readonly type: "edit.start"; readonly id: string; readonly reverted: boolean; readonly draft: EditStash }
  | { readonly type: "edit.mediaPinned"; readonly attempt: number; readonly blobs: ReadonlyMap<string, BlobReference> }
  | { readonly type: "edit.cancel" }
  | {
      readonly type: "edit.confirm"
      readonly delivery: ComposerDelivery
      readonly reverted: boolean
      readonly prompt: Prompt
      // Fresh inbox IDs, one per queued prompt, for the replacements an edit admits.
      readonly ids: readonly string[]
    }
  | { readonly type: "reorder.requested"; readonly inboxIDs: readonly string[]; readonly reverted: boolean }
  | { readonly type: "steer.requested"; readonly id: string }
  | { readonly type: "remove.requested"; readonly id: string }
  | { readonly type: "undo.requested"; readonly id: string; readonly mode: "normal" | "shell" }
  | { readonly type: "mutation.moved"; readonly attempt: number; readonly moved: Readonly<Record<string, string>> }
  | { readonly type: "mutation.admitted"; readonly attempt: number }
  | { readonly type: "mutation.succeeded"; readonly attempt: number }
  | {
      readonly type: "mutation.undone"
      readonly attempt: number
      readonly prompt: Prompt
      readonly context: readonly ContextItem[]
    }
  // `hidden` lists the inbox IDs the failed operation already withdrew or cancelled.
  | { readonly type: "mutation.failed"; readonly attempt: number; readonly hidden: readonly string[] }
  // `hidden` as for a failure: what the operation withdrew or cancelled before the bound ran out.
  | {
      readonly type: "mutation.timed-out"
      readonly attempt: number
      readonly hidden: readonly string[]
      readonly stage: QueueMutationStage
    }
  | { readonly type: "gone.expired"; readonly expiry: number }
  | { readonly type: "dispose" }

export type QueueToastKey = "common.requestFailed" | "session.queue.reverted" | "session.queue.undoShell"

export type QueueEffect =
  | { readonly type: "draft.load"; readonly prompt: Prompt; readonly cursor: number }
  // `keep` is the prompt the edit was loaded from: changes made to it join the restored draft.
  | { readonly type: "draft.restore"; readonly stash: EditStash; readonly focus: boolean; readonly keep?: QueuedPrompt }
  | { readonly type: "draft.pinned"; readonly blobs: ReadonlyMap<string, BlobReference> }
  // `focus: false` after unmount, when the merge lands in the session's saved draft.
  | {
      readonly type: "draft.merge"
      readonly prompt: Prompt
      readonly context: readonly ContextItem[]
      readonly focus?: false
    }
  | {
      readonly type: "media.pin"
      readonly attempt: number
      readonly attachments: readonly (ImageAttachmentPart | PathAttachmentPart)[]
    }
  | { readonly type: "mutation.run"; readonly operation: ActiveOperation }
  // Stops the operation at its next step; a request already sent still finishes.
  | { readonly type: "mutation.abort"; readonly attempt: number }
  | { readonly type: "mutation.timer.start"; readonly attempt: number }
  | { readonly type: "mutation.timer.clear" }
  | { readonly type: "timer.start"; readonly expiry: number }
  | { readonly type: "timer.clear"; readonly expiry: number }
  | { readonly type: "timer.clearAll" }
  | { readonly type: "toast"; readonly key: QueueToastKey }

export type QueueTransition = { readonly state: QueueState; readonly effects: readonly QueueEffect[] }

export type QueueView = {
  readonly rows: QueueRow[]
  readonly editing: string | undefined
  readonly busy: boolean
  readonly undoing: boolean
  readonly delivery: ComposerDelivery
  readonly alternate: ComposerDelivery | undefined
  /** Inbox IDs replaced by an edit or reorder, finished or in flight, mapped to their replacements. */
  readonly moved: Readonly<Record<string, string>>
}

export function createQueueState(items: readonly QueuedPrompt[]): QueueState {
  return { status: "idle", seq: 0, items, gone: [], moved: NO_MOVES }
}

export function transitionQueue(state: QueueState, event: QueueEvent): QueueTransition {
  if (state.status === "disposed") return settleDisposed(state, event)

  if (event.type === "inbox.synced") return synced(state, event.items)

  if (event.type === "edit.start") return startEdit(state, event)

  if (event.type === "edit.mediaPinned")
    return editOf(state)?.pin === event.attempt
      ? changed(state, [{ type: "draft.pinned", blobs: event.blobs }])
      : unchanged(state)

  if (event.type === "edit.cancel") {
    if (state.status !== "editing" && state.status !== "editing-while-mutating") return unchanged(state)

    return changed(closeEdit(state), [restore(state.edit, true)])
  }

  if (event.type === "edit.confirm") return confirmEdit(state, event)

  if (event.type === "reorder.requested") return reorder(state, event)

  if (event.type === "steer.requested") return request(state, { type: "steer", id: event.id })

  if (event.type === "remove.requested") return request(state, { type: "remove", id: event.id })

  if (event.type === "undo.requested") return undo(state, event)

  if (event.type === "gone.expired") {
    const gone = state.gone.filter((entry) => entry.expiry !== event.expiry)

    return gone.length === state.gone.length ? unchanged(state) : changed({ ...state, gone })
  }

  if (event.type === "dispose") {
    const edit = editOf(state)
    const active = state.status === "mutating" || state.status === "editing-while-mutating" ? state.active : undefined

    const returning: DisposedReturn | undefined =
      active?.type === "edit" && active.phase === "admitting"
        ? { type: "edit", attempt: active.attempt, prompt: active.prompt }
        : active?.type === "undo"
          ? { type: "undo", attempt: active.attempt }
          : undefined

    // Operations in flight still finish, since the server may already hold half of an edit, but waiting ones never
    // start. An undo stops before its cancel if it can: nothing would show the restored prompt.
    return changed(returning ? { status: "disposed", returning } : { status: "disposed" }, [
      ...(edit ? [restore(edit, false)] : []),
      ...(active?.type === "undo" ? [{ type: "mutation.abort" as const, attempt: active.attempt }] : []),
      { type: "timer.clearAll" },
    ])
  }

  if (event.type === "mutation.timed-out") return timedOut(state, event)

  return settle(state, event)
}

function settleDisposed(state: Extract<QueueState, { status: "disposed" }>, event: QueueEvent): QueueTransition {
  const returning = state.returning

  if (!returning || !("attempt" in event) || event.attempt !== returning.attempt) return unchanged(state)

  if (event.type === "mutation.admitted" || event.type === "mutation.succeeded")
    return changed({ status: "disposed" })

  if (event.type === "mutation.undone")
    return changed({ status: "disposed" }, [
      { type: "draft.merge", prompt: event.prompt, context: event.context, focus: false },
    ])

  if (event.type !== "mutation.failed") return unchanged(state)

  return changed(
    { status: "disposed" },
    returning.type === "edit" ? [{ type: "draft.merge", prompt: returning.prompt, context: [], focus: false }] : [],
  )
}

// An operation past its bound ends as it got: a finished change succeeds, an undo whose cancel is in flight waits for
// it, and anything else fails with what it already withdrew, while its chain stops at the next step.
function timedOut(state: LiveQueueState, event: Extract<QueueEvent, { type: "mutation.timed-out" }>) {
  if (state.status !== "mutating" && state.status !== "editing-while-mutating") return unchanged(state)

  if (state.active.attempt !== event.attempt || event.stage === "committed") return unchanged(state)

  const next = settle(
    state,
    event.stage === "settled"
      ? { type: "mutation.succeeded", attempt: event.attempt }
      : { type: "mutation.failed", attempt: event.attempt, hidden: event.hidden },
  )

  return changed(next.state, [{ type: "mutation.abort", attempt: event.attempt }, ...next.effects])
}

export function selectQueueRows(state: QueueState): QueueRow[] {
  if (state.status === "disposed") return []
  const operations = operationsOf(state)

  const hidden = [
    ...state.gone.map((entry) => entry.id),
    ...operations.flatMap((operation) =>
      operation.type === "steer" || operation.type === "remove" ? [operation.id] : [],
    ),
  ]

  const edits = operations.flatMap((operation): SentEdit[] =>
    operation.type === "edit"
      ? [
          {
            original: operation.original,
            delivery: operation.delivery,
            text: operation.text,
            attachments: operation.attachments,
            moved: operation.moved,
            admitted: "phase" in operation && operation.phase === "cancelling",
          },
        ]
      : [],
  )

  const rows = queuedPromptRows(state.items, edits, hidden)
  const active = operations[0]

  if (active?.type === "undo") return rows.map((row) => (row.id === active.item.id ? { ...row, pending: true } : row))

  if (active?.type !== "reorder") return rows
  const covered = new Set([...active.rows.map((row) => row.id), ...Object.values(active.moved)])

  // Fresh prompts still appear while the reordered rows keep their optimistic positions.
  return [...active.rows.filter((row) => !hidden.includes(row.id)), ...rows.filter((row) => !covered.has(row.id))]
}

export function viewQueue(
  state: QueueState,
  context: { readonly working: boolean; readonly behavior: ComposerDelivery },
): QueueView {
  const editing = editOf(state)?.id

  return {
    rows: selectQueueRows(state),
    editing,
    busy: state.status === "mutating" || state.status === "editing-while-mutating",
    undoing: state.status === "mutating" && state.active.type === "undo",
    delivery: context.working ? context.behavior : "steer",
    alternate: editing ? "steer" : context.working ? (context.behavior === "queue" ? "steer" : "queue") : undefined,
    moved: selectQueueMoved(state),
  }
}

export function selectQueueMoved(state: QueueState) {
  if (state.status === "disposed") return NO_MOVES
  const active = state.status === "mutating" || state.status === "editing-while-mutating" ? state.active : undefined

  if ((active?.type !== "edit" && active?.type !== "reorder") || !Object.keys(active.moved).length) return state.moved

  return { ...state.moved, ...active.moved }
}

/** The first ID along `id`'s chain of replacements that `listed` holds. */
export function movedTarget(moved: Readonly<Record<string, string>>, id: string, listed: ReadonlySet<string>) {
  // Every replacement is a freshly minted ID, so a chain cannot loop; the bound only guards malformed input.
  const hops = Object.keys(moved).length

  for (let next = moved[id], step = 0; next !== undefined && step < hops; next = moved[next], step++) {
    if (listed.has(next)) return next
  }

  return undefined
}

export function editingID(state: QueueState) {
  return editOf(state)?.id
}

function synced(state: LiveQueueState, items: readonly QueuedPrompt[]): QueueTransition {
  if (items === state.items) return unchanged(state)
  const listed = new Set(items.map((item) => item.id))
  const gone = state.gone.filter((entry) => listed.has(entry.id))

  const cleared = [...new Set(state.gone.map((entry) => entry.expiry))].flatMap((expiry): QueueEffect[] =>
    gone.some((entry) => entry.expiry === expiry) ? [] : [{ type: "timer.clear", expiry }],
  )

  // A replacement in flight can continue a finished one's chain.
  const chains = selectQueueMoved(state)

  const kept = Object.entries(state.moved).filter(
    ([, id]) => listed.has(id) || movedTarget(chains, id, listed) !== undefined,
  )

  const moved = kept.length === Object.keys(state.moved).length ? state.moved : Object.fromEntries(kept)
  const next = { ...state, items, gone, moved }

  if (next.status !== "editing" && next.status !== "editing-while-mutating") return changed(next, cleared)

  if (listed.has(next.edit.id)) return changed(next, cleared)

  // The server delivered or cancelled the prompt being edited: the composer gets its earlier draft back, and keeps
  // whatever was typed into the edit.
  return changed(closeEdit(next), [...cleared, restore(next.edit, true, next.edit.item)])
}

function startEdit(state: LiveQueueState, event: Extract<QueueEvent, { type: "edit.start" }>): QueueTransition {
  // Other rows stay editable while an edit, steer or removal is in flight; the row it is changing ignores clicks and
  // shows as pending until the server catches up.
  if (state.status === "mutating" && !isConcurrent(state.active)) return unchanged(state)
  const row = selectQueueRows(state).find((entry) => entry.id === event.id)
  const item = state.items.find((entry) => entry.id === event.id)

  if (!row || row.pending || !item) return unchanged(state)

  // Re-admitting a queued prompt commits a staged revert, which drops every prompt queued after its boundary.
  if (event.reverted) return changed(state, [{ type: "toast", key: "session.queue.reverted" }])
  const current = editOf(state)

  if (current?.id === event.id) return unchanged(state)
  const text = queuedPromptText(item)
  const attachments = queuedPromptAttachments(item)
  const edit = { id: item.id, item, pin: state.seq + 1, stash: current?.stash ?? event.draft }

  // The edit cancels the original once its replacement is admitted, so the draft takes local copies of the queued
  // media as soon as they load.
  const effects: QueueEffect[] = [
    {
      type: "draft.load",
      prompt: [{ type: "text", content: text, start: 0, end: text.length }, ...attachments],
      cursor: text.length,
    },
    ...(attachments.length ? [{ type: "media.pin" as const, attempt: edit.pin, attachments }] : []),
  ]

  const base = { seq: edit.pin, items: state.items, gone: state.gone, moved: state.moved }

  if (state.status === "idle" || state.status === "editing")
    return changed({ ...base, status: "editing", edit }, effects)

  if (!isConcurrent(state.active)) return unchanged(state)

  return changed(
    { ...base, status: "editing-while-mutating", edit, active: state.active, pending: state.pending },
    effects,
  )
}

function confirmEdit(state: LiveQueueState, event: Extract<QueueEvent, { type: "edit.confirm" }>): QueueTransition {
  if (state.status !== "editing" && state.status !== "editing-while-mutating") return unchanged(state)

  if (event.reverted) return changed(state, [{ type: "toast", key: "session.queue.reverted" }])
  const closed = closeEdit(state)
  // Optimistic: the composer returns to the draft it held before the edit and the strip shows the edited prompt as
  // pending. A failure hands the edit back to the composer.
  const restored = restore(state.edit, true)
  const raw = promptText(event.prompt)
  const attachments = event.prompt.filter(isAttachment)

  if (!raw.trim() && !attachments.length) return changed(closed, [restored])
  const position = state.items.findIndex((entry) => entry.id === state.edit.id)
  const item = state.items[position] ?? state.edit.item
  const pristine = isPristine(item, event.prompt)

  if (pristine && event.delivery === "queue") return changed(closed, [restored])

  // An unchanged prompt steers in place instead of being replaced.
  if (pristine) return enqueue(closed, { type: "steer", id: item.id }, [restored])
  // A queued edit re-admits the prompts after it, so they are pending too; their IDs are minted now.
  const after = event.delivery === "queue" && position >= 0 ? state.items.slice(position + 1) : []

  return enqueue(
    closed,
    {
      type: "edit",
      original: item.id,
      delivery: event.delivery,
      item,
      prompt: event.prompt,
      raw,
      text: raw.trim(),
      attachments: attachments.length,
      moved: Object.fromEntries([item, ...after].map((entry, index) => [entry.id, event.ids[index]])),
    },
    [restored],
  )
}

function reorder(state: LiveQueueState, event: Extract<QueueEvent, { type: "reorder.requested" }>): QueueTransition {
  if (state.status !== "idle" && state.status !== "editing") return unchanged(state)

  if (event.reverted) return changed(state, [{ type: "toast", key: "session.queue.reverted" }])
  const current = selectQueueRows(state)
  const rows = event.inboxIDs.flatMap((id) => current.filter((row) => row.id === id))

  if (!rows.length) return unchanged(state)
  const active = { type: "reorder" as const, attempt: state.seq + 1, inboxIDs: event.inboxIDs, rows, moved: {} }

  // The rewrite can replace the row being edited, so the edit closes first and keeps what was typed into it.
  return changed(
    {
      seq: active.attempt,
      items: state.items,
      gone: state.gone,
      moved: state.moved,
      status: "mutating",
      active,
      pending: [],
    },
    [...(state.status === "editing" ? [restore(state.edit, true, state.edit.item)] : []), ...start(active)],
  )
}

function request(state: LiveQueueState, operation: Extract<QueuedOperation, { type: "steer" | "remove" }>) {
  const row = selectQueueRows(state).find((entry) => entry.id === operation.id)

  if (!row || row.pending) return unchanged(state)

  if ((state.status === "editing" || state.status === "editing-while-mutating") && state.edit.id === operation.id)
    return enqueue(closeEdit(state), operation, [restore(state.edit, true)])

  return enqueue(state, operation)
}

function undo(state: LiveQueueState, event: Extract<QueueEvent, { type: "undo.requested" }>): QueueTransition {
  if (state.status !== "idle") return unchanged(state)
  const row = selectQueueRows(state).find((entry) => entry.id === event.id)
  const item = state.items.find((entry) => entry.id === event.id)

  if (!row || row.pending || !item) return unchanged(state)

  if (event.mode !== "normal") return changed(state, [{ type: "toast", key: "session.queue.undoShell" }])
  const active = { type: "undo" as const, attempt: state.seq + 1, item }

  return changed(
    {
      seq: active.attempt,
      items: state.items,
      gone: state.gone,
      moved: state.moved,
      status: "mutating",
      active,
      pending: [],
    },
    start(active),
  )
}

function settle(
  state: LiveQueueState,
  event: Extract<
    QueueEvent,
    { type: "mutation.moved" | "mutation.admitted" | "mutation.succeeded" | "mutation.undone" | "mutation.failed" }
  >,
): QueueTransition {
  // A result for an operation that is no longer in flight is stale, for example one that settles after unmount.
  if (state.status !== "mutating" && state.status !== "editing-while-mutating") return unchanged(state)
  const active = state.active

  if (active.attempt !== event.attempt) return unchanged(state)

  if (event.type === "mutation.moved") {
    if (active.type !== "edit" && active.type !== "reorder") return unchanged(state)

    return changed(withActive(state, { ...active, moved: event.moved }))
  }

  if (event.type === "mutation.admitted") {
    if (active.type !== "edit") return unchanged(state)

    return changed(withActive(state, { ...active, phase: "cancelling" }))
  }

  if (event.type === "mutation.undone") {
    if (active.type !== "undo") return unchanged(state)
    const hidden = hide(state, [active.item.id])
    const next = advance(hidden.state, {})

    return changed(next.state, [
      { type: "draft.merge", prompt: event.prompt, context: event.context },
      ...hidden.effects,
      ...next.effects,
    ])
  }

  if (event.type === "mutation.succeeded") {
    const confirmed =
      active.type === "steer" || active.type === "remove"
        ? [active.id]
        : active.type === "undo"
          ? [active.item.id]
          : Object.keys(active.moved)

    const hidden = hide(state, confirmed)
    const moved = active.type === "edit" || active.type === "reorder" ? active.moved : NO_MOVES

    const next = advance(
      moved === NO_MOVES ? hidden.state : { ...hidden.state, moved: { ...hidden.state.moved, ...moved } },
      moved,
    )

    return changed(next.state, [...hidden.effects, ...next.effects])
  }

  const hidden = hide(state, event.hidden)
  // Nothing typed is lost: an edit that never reached the server returns to the composer, merged into what it holds
  // now, or into the draft an open edit stashed.
  const returned = active.type === "edit" && active.phase === "admitting"

  const restored =
    returned && hidden.state.status === "editing-while-mutating"
      ? {
          ...hidden.state,
          edit: {
            ...hidden.state.edit,
            stash: { ...hidden.state.edit.stash, prompt: mergePrompt(hidden.state.edit.stash.prompt, active.prompt) },
          },
        }
      : hidden.state

  const next = advance(restored, {})

  return changed(next.state, [
    { type: "toast", key: "common.requestFailed" },
    ...(returned && restored.status === "mutating"
      ? [{ type: "draft.merge" as const, prompt: active.prompt, context: [] }]
      : []),
    ...hidden.effects,
    ...next.effects,
  ])
}

type Mutating = Extract<QueueState, { status: "mutating" | "editing-while-mutating" }>

type MutatingTransition = { readonly state: Mutating; readonly effects: readonly QueueEffect[] }

function hide(state: Mutating, ids: readonly string[]): MutatingTransition {
  const listed = ids.filter((id) => state.items.some((item) => item.id === id))

  if (!listed.length) return { state, effects: [] }
  const expiry = state.seq + 1

  return {
    state: { ...state, seq: expiry, gone: [...state.gone, ...listed.map((id) => ({ id, expiry }))] },
    effects: [{ type: "timer.start", expiry }],
  }
}

// Starts the next waiting operation. Prompts the finished one re-admitted carry over to their new inbox IDs, so a
// steer or removal requested meanwhile never targets an ID the rewrite already cancelled.
function advance(state: Mutating, moved: Readonly<Record<string, string>>): QueueTransition {
  const remap = (id: string) => moved[id] ?? id

  const [head, ...rest] = state.pending.map(
    (operation): QueuedOperation =>
      operation.type === "edit"
        ? {
            ...operation,
            original: remap(operation.original),
            moved: Object.fromEntries(Object.entries(operation.moved).map(([id, next]) => [remap(id), next])),
          }
        : { ...operation, id: remap(operation.id) },
  )

  const base = { seq: state.seq, items: state.items, gone: state.gone, moved: state.moved }
  // `state.active` is the operation that just finished.
  const clear: QueueEffect[] = bounded(state.active) ? [{ type: "mutation.timer.clear" }] : []

  if (!head)
    return changed(
      state.status === "editing-while-mutating"
        ? { ...base, status: "editing", edit: state.edit }
        : { ...base, status: "idle" },
      clear,
    )
  const active = activate(head, state.seq + 1)
  const next = { ...base, seq: active.attempt, active, pending: rest }

  return changed(
    state.status === "editing-while-mutating"
      ? { ...next, status: "editing-while-mutating", edit: state.edit }
      : { ...next, status: "mutating" },
    [...clear, ...start(active)],
  )
}

function start(operation: ActiveOperation): QueueEffect[] {
  const run: QueueEffect = { type: "mutation.run", operation }

  return bounded(operation) ? [run, { type: "mutation.timer.start", attempt: operation.attempt }] : [run]
}

function bounded(operation: ActiveOperation) {
  return operation.type !== "steer" && operation.type !== "remove"
}

function enqueue(state: LiveQueueState, operation: QueuedOperation, effects: QueueEffect[] = []): QueueTransition {
  if (state.status === "mutating" || state.status === "editing-while-mutating")
    return changed({ ...state, pending: [...state.pending, operation] }, effects)
  const active = activate(operation, state.seq + 1)
  const base = { seq: active.attempt, items: state.items, gone: state.gone, moved: state.moved, active, pending: [] }

  if (state.status === "editing")
    return changed({ ...base, status: "editing-while-mutating", edit: state.edit }, [...effects, ...start(active)])

  return changed({ ...base, status: "mutating" }, [...effects, ...start(active)])
}

function activate(operation: QueuedOperation, attempt: number): ConcurrentOperation {
  if (operation.type === "edit") return { ...operation, attempt, phase: "admitting" }

  return { ...operation, attempt }
}

function withActive(state: Mutating, active: ActiveOperation): QueueState {
  if (state.status === "mutating") return { ...state, active }

  return isConcurrent(active) ? { ...state, active } : state
}

function closeEdit(state: Extract<QueueState, { edit: ActiveEdit }>): LiveQueueState {
  const base = { seq: state.seq, items: state.items, gone: state.gone, moved: state.moved }

  if (state.status === "editing") return { ...base, status: "idle" }

  return { ...base, status: "mutating", active: state.active, pending: state.pending }
}

function restore(edit: ActiveEdit, focus: boolean, keep?: QueuedPrompt): QueueEffect {
  return keep
    ? { type: "draft.restore", stash: edit.stash, focus, keep }
    : { type: "draft.restore", stash: edit.stash, focus }
}

function editOf(state: QueueState) {
  return state.status === "editing" || state.status === "editing-while-mutating" ? state.edit : undefined
}

function operationsOf(state: QueueState): readonly (ActiveOperation | QueuedOperation)[] {
  return state.status === "mutating" || state.status === "editing-while-mutating"
    ? [state.active, ...state.pending]
    : []
}

function isConcurrent(operation: ActiveOperation): operation is ConcurrentOperation {
  return operation.type !== "reorder" && operation.type !== "undo"
}

function changed(state: QueueState, effects: readonly QueueEffect[] = []): QueueTransition {
  return { state, effects }
}

function unchanged(state: QueueState): QueueTransition {
  return { state, effects: [] }
}

// An edit in flight, as the strip shows it.
export type SentEdit = {
  readonly original: string
  readonly delivery: ComposerDelivery
  readonly text: string
  readonly attachments: number
  readonly moved: Readonly<Record<string, string>>
  // The server admitted every replacement.
  readonly admitted: boolean
}

// An edit in flight shows its edited text on the original row, and every row it rewrites shows as
// pending. A re-admitted copy stays hidden while the row it replaces is listed, so the strip keeps
// its order; a steered edit leaves the strip once the server admits it. Hidden rows (confirmed gone
// or optimistically steered or removed) stay out.
export function queuedPromptRows(
  items: readonly QueuedPrompt[],
  sent: readonly SentEdit[] = [],
  hidden: readonly string[] = [],
) {
  const queued = items.filter((item) => !hidden.includes(item.id))
  const listed = new Set(queued.map((item) => item.id))
  const moves = sent.flatMap((edit) => Object.entries(edit.moved))

  return queued.flatMap((item): { id: string; text: string; attachments: number; pending?: boolean }[] => {
    // The latest edit of this prompt, on its original row or, once that is gone, on its replacement.
    const edit = sent.findLast((entry) => entry.original === item.id || entry.moved[entry.original] === item.id)

    if (moves.some(([old, next]) => next === item.id && listed.has(old))) return []

    if (sent.some((entry) => entry.original === item.id && entry.admitted && entry.delivery === "steer")) return []

    const presentation = readPromptPresentation(item.payload.metadata)
    // Text-only edits preserve the original context suffix. A context-only edit currently loads that suffix as text.
    const comments = !edit || presentation?.displayText.trim() ? (presentation?.comments ?? []) : []

    return [
      {
        id: item.id,
        text: edit ? edit.text : (presentation?.displayText.trim() ?? queuedPromptText(item)),
        attachments:
          (edit ? edit.attachments : (item.payload.files?.length ?? 0) + (presentation?.attachments.length ?? 0)) +
          // File comments already contribute their context file; quotes and plugin notes have no file.
          comments.filter((comment) => comment.type === "quote" || comment.type === "note").length,
        pending: moves.some(([old, next]) => old === item.id || next === item.id) ? true : undefined,
      },
    ]
  })
}

// Whether the composer still holds the queued prompt exactly as it was loaded.
export function isPristine(item: QueuedPrompt, prompt: Prompt) {
  const attachments = prompt.filter(isAttachment)
  const original = queuedPromptAttachments(item)

  return (
    promptText(prompt).trim() === queuedPromptText(item) &&
    attachments.length === original.length &&
    attachments.every((attachment, index) => attachment.id === original[index].id)
  )
}

// A prompt of only comments or attachments adds no text, so it needs no paragraph break.
export function mergePrompt(draft: Prompt, prompt: Prompt) {
  if (!promptLength(draft)) return [...prompt, ...draft.filter(isAttachment)]

  if (promptLength(prompt)) return appendPrompt(draft, prompt)

  return [...clonePrompt(draft), ...prompt.filter(isAttachment)]
}

const decodeDisplayText = Schema.decodeUnknownOption(Schema.Struct({ displayText: Schema.NonEmptyString }))

export function queuedPromptText(item: QueuedPrompt) {
  return Option.match(decodeDisplayText(item.payload.metadata), {
    onNone: () => item.payload.text,
    onSome: (metadata) => metadata.displayText,
  })
}

// Inline attachments are the files the composer added itself, so they return
// to it as image parts that an edit can remove or extend, and path references
// return as path parts. Mentions and `file://` context stay in the payload; see
// editedPromptInput.
export function queuedPromptAttachments(item: QueuedPrompt): (ImageAttachmentPart | PathAttachmentPart)[] {
  // Opted-in reads leave stored files as `media:` refs, which the generated inbox type does not describe.
  const files: readonly PromptAttachment[] = item.payload.files ?? []
  const inline = files.filter((file) => isComposerAttachment(file))

  return [
    ...inline.map(
      (file, index): ImageAttachmentPart => ({
        type: "image",
        id: `${item.id}:file:${index}`,
        filename: file.name ?? "attachment",
        mime: file.mime,
        blob: createLegacyBlobReference("uri" in file ? file.uri : `data:${file.mime};base64,${file.data}`),
      }),
    ),
    ...(readPromptPresentation(item.payload.metadata)?.attachments ?? []).map(
      (file, index): PathAttachmentPart => ({
        type: "path",
        id: `${item.id}:path:${index}`,
        filename: file.name,
        mime: file.mime,
        path: file.path,
      }),
    ),
  ]
}

export function isComposerAttachment(file: PromptAttachment) {
  const source = file.source

  return !file.mention && (!source || source.type === "inline")
}

function promptText(prompt: Prompt) {
  return prompt.map((part) => ("content" in part ? part.content : "")).join("")
}
