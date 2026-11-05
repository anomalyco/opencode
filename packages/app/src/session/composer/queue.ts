import { createEffect, createMemo, createSignal, onCleanup, untrack, type Accessor } from "solid-js"
import type { PromptAttachment } from "@opencode/client/promise"
import { SessionMessage } from "@opencode/schema/session-message"
import type { ComposerDelivery, ComposerSession } from "@/composer/adapter"
import type { ComposerStateTarget } from "@/composer/submission-state"
import type { ImageAttachmentPart, Prompt } from "@/composer/state"
import { clonePrompt, promptLength } from "@/composer/prompt-parts"
import { buildPromptRequest } from "@/composer/request"
import { type BlobReference, blobDataUrl } from "@/runtime/persistence/drafts"
import { pinPromptMedia } from "@/composer/media"
import { extractPromptContext, extractPromptFromMessage } from "@/composer/prompt"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useLanguage } from "@/runtime/i18n/language"
import { showToast } from "@/shell/notifications/toast"
import {
  createQueueState,
  editingID,
  isComposerAttachment,
  isPristine,
  mergePrompt,
  QUEUE_MUTATION_TIMEOUT_MS,
  queuedPromptText,
  transitionQueue,
  viewQueue,
  type ActiveOperation,
  type EditOperation,
  type QueueEffect,
  type QueueEvent,
  type QueueMutationStage,
  type QueuedPrompt,
} from "./queue-machine"

export function createSessionQueue(input: {
  sessionID: string
  draft: ComposerStateTarget
  working: Accessor<boolean>
  behavior: Accessor<ComposerDelivery>
  restoreFocus: (cursor: number) => void
  background: NonNullable<ComposerSession["background"]>
}) {
  const data = useData()
  const server = useServerSDK()
  const location = useWorkspaceLocation()
  const language = useLanguage()

  const queued = createMemo(() =>
    data.session.pending
      .list(input.sessionID)
      .filter((item): item is QueuedPrompt => item.type === "user" && item.delivery === "queue"),
  )

  const [state, setState] = createSignal(createQueueState(untrack(queued)))
  const view = createMemo(() => viewQueue(state(), { working: input.working(), behavior: input.behavior() }))
  // OS handles for the machine's expiry timers, keyed by its expiry IDs.
  const timers = new Map<number, ReturnType<typeof setTimeout>>()
  // The bound on the operation in flight, and each running operation's progress, keyed by attempt.
  let mutationTimer: ReturnType<typeof setTimeout> | undefined
  const runs = new Map<number, MutationProgress>()

  // Effects read and write the composer, so neither the transition nor its effects subscribe the caller.
  const dispatch = (event: QueueEvent) =>
    untrack(() => {
      const next = transitionQueue(state(), event)
      setState(next.state)
      next.effects.forEach(perform)
    })

  const perform = (effect: QueueEffect) => {
    if (effect.type === "draft.load") {
      input.draft.mode.set("normal")
      input.draft.set(effect.prompt, effect.cursor)
      input.restoreFocus(effect.cursor)

      return
    }

    if (effect.type === "draft.restore") {
      const current = input.draft.current()

      const prompt =
        effect.keep && !isPristine(effect.keep, current)
          ? mergePrompt(effect.stash.prompt, current)
          : effect.stash.prompt

      const cursor = prompt === effect.stash.prompt ? effect.stash.cursor : promptLength(prompt)
      // The stashed retry fingerprints its own payload, so a merged prompt sends under a new ID.
      input.draft.mode.set(effect.stash.mode)
      input.draft.set(prompt, cursor)

      if (effect.stash.retry) input.draft.retry.set(effect.stash.retry)

      if (effect.focus) input.restoreFocus(cursor)

      return
    }

    if (effect.type === "draft.pinned") {
      const current = input.draft.current()
      input.draft.set(
        current.map((part) => {
          const blob = part.type === "image" ? effect.blobs.get(part.id) : undefined

          return blob && part.type === "image" ? { ...part, blob } : part
        }),
        input.draft.cursor() ?? promptLength(current),
      )

      return
    }

    if (effect.type === "draft.merge") {
      const prompt = mergePrompt(input.draft.current(), effect.prompt)
      input.draft.set(prompt, promptLength(prompt))
      effect.context.forEach((item) => input.draft.context.add(item))

      if (effect.focus !== false) input.restoreFocus(promptLength(prompt))

      return
    }

    if (effect.type === "media.pin") {
      // Images the user removed meanwhile stay removed; a pin for a row no longer open is rejected by the machine.
      void pinPromptMedia([...effect.attachments]).then(
        (pinned) =>
          dispatch({
            type: "edit.mediaPinned",
            attempt: effect.attempt,
            blobs: new Map(
              pinned.flatMap((part): [string, BlobReference][] =>
                part.type === "image" ? [[part.id, part.blob]] : [],
              ),
            ),
          }),
        () => undefined,
      )

      return
    }

    if (effect.type === "mutation.run") {
      const attempt = effect.operation.attempt
      const progress: MutationProgress = { controller: new AbortController(), hidden: [], stage: "running" }
      runs.set(attempt, progress)

      return void run(effect.operation, progress).finally(() => runs.delete(attempt))
    }

    if (effect.type === "mutation.abort") return runs.get(effect.attempt)?.controller.abort()

    if (effect.type === "mutation.timer.start") {
      clearTimeout(mutationTimer)
      mutationTimer = setTimeout(() => {
        const progress = runs.get(effect.attempt)

        dispatch({
          type: "mutation.timed-out",
          attempt: effect.attempt,
          hidden: progress ? [...progress.hidden] : [],
          stage: progress?.stage ?? "running",
        })
      }, QUEUE_MUTATION_TIMEOUT_MS)

      return
    }

    if (effect.type === "mutation.timer.clear") {
      clearTimeout(mutationTimer)
      mutationTimer = undefined

      return
    }

    if (effect.type === "timer.start") {
      timers.set(
        effect.expiry,
        setTimeout(() => {
          timers.delete(effect.expiry)
          dispatch({ type: "gone.expired", expiry: effect.expiry })
        }, 30_000),
      )

      return
    }

    if (effect.type === "timer.clear") {
      clearTimeout(timers.get(effect.expiry))
      timers.delete(effect.expiry)

      return
    }

    if (effect.type === "timer.clearAll") {
      timers.forEach(clearTimeout)
      timers.clear()
      clearTimeout(mutationTimer)
      mutationTimer = undefined

      return
    }

    showToast({ title: language.t(effect.key) })
  }

  // Runs the operation in flight and reports its progress. Each report carries the operation's attempt, so the machine
  // ignores one that arrives after the operation stopped being current.
  const run = async (operation: ActiveOperation, progress: MutationProgress) => {
    const attempt = operation.attempt

    // SSE retracts and updates materialized timeline messages for a steer or removal, so neither re-syncs the queue.
    if (operation.type === "steer") {
      const background = input.background()

      return server.api.session.inbox
        .update({ sessionID: input.sessionID, inboxID: operation.id, delivery: "steer" })
        .then(
          () => {
            void background?.move()
            dispatch({ type: "mutation.succeeded", attempt })
          },
          () => dispatch({ type: "mutation.failed", attempt, hidden: [] }),
        )
    }

    if (operation.type === "remove")
      return server.api.session.inbox.cancel({ sessionID: input.sessionID, inboxID: operation.id }).then(
        () => dispatch({ type: "mutation.succeeded", attempt }),
        () => dispatch({ type: "mutation.failed", attempt, hidden: [] }),
      )

    if (operation.type === "undo") {
      const source = { id: operation.item.id, ...operation.item.payload }
      const context = extractPromptContext(source, { directory: location().directory })

      await undoQueuedPrompt({
        prompt: extractPromptFromMessage(source, {
          directory: location().directory,
          attachmentName: language.t("common.attachment"),
          sessionTitle: (id) => data.session.get(id)?.title,
        }),
        signal: progress.controller.signal,
        cancelInboxItem: () => {
          progress.stage = "committed"

          return server.api.session.inbox.cancel({ sessionID: input.sessionID, inboxID: operation.item.id })
        },
      }).then(
        (prompt) =>
          dispatch({ type: "mutation.undone", attempt, prompt, context: [...context.comments, ...context.files] }),
        () => dispatch({ type: "mutation.failed", attempt, hidden: [] }),
      )
      await data.session.pending.sync(input.sessionID).catch(() => undefined)

      return
    }

    const settled = await (
      operation.type === "reorder" ? rewrite(attempt, progress, [...operation.inboxIDs]) : sendEdit(operation, progress)
    ).then(
      () => true,
      () => false,
    )

    if (settled) progress.stage = "settled"

    if (operation.type === "reorder") data.session.pending.invalidate(input.sessionID)
    // The rows keep their optimistic state until the server's queue has caught up.
    await data.session.pending.sync(input.sessionID).catch(() => undefined)
    dispatch(
      settled ? { type: "mutation.succeeded", attempt } : { type: "mutation.failed", attempt, hidden: progress.hidden },
    )
  }

  const sendEdit = async (operation: EditOperation & { attempt: number }, progress: MutationProgress) => {
    const signal = progress.controller.signal

    const replacement = await editedPromptInput(
      input.sessionID,
      location().directory,
      operation.item,
      operation.prompt,
      operation.raw,
    )

    // Admit before cancelling so a failed replacement never discards the original. A queued edit rebuilds its position
    // in one rewrite, which leaves the queue unchanged if any admission fails.
    const admission = { ...replacement, id: operation.moved[operation.original], delivery: operation.delivery }

    if (operation.delivery === "queue")
      return rewrite(operation.attempt, progress, undefined, {
        original: operation.original,
        admission: { ...admission, resume: false },
        moved: operation.moved,
      })

    signal.throwIfAborted()
    // Like a queued edit, an original the server delivered meanwhile keeps the edit draft instead of sending twice.
    const pending = await server.api.session.inbox.list({ sessionID: input.sessionID })

    if (!pending.some((item) => item.id === operation.original && item.type === "user" && item.delivery === "queue"))
      throw new Error("Queued prompt was delivered before the edit")
    signal.throwIfAborted()
    const background = input.background()
    // A steered replacement can be delivered before a withdrawal reaches it, so the bound waits for the admission and
    // the edit returns to the composer only if it really did not go out.
    progress.stage = "committed"
    await data.session.prompt(admission)
    void background?.move()
    dispatch({ type: "mutation.admitted", attempt: operation.attempt })
    // Cancelling is a no-op once the original is gone, so one retry is safe.
    const cancel = () => server.api.session.inbox.cancel({ sessionID: input.sessionID, inboxID: operation.original })
    await cancel().catch(cancel)
  }

  // `replace` substitutes an edited prompt for the original at its position in the same rewrite.
  // Without `inboxIDs` the server's current order is kept.
  const rewrite = async (
    attempt: number,
    progress: MutationProgress,
    inboxIDs: string[] | undefined,
    replace?: {
      original: string
      admission: Parameters<typeof data.session.prompt>[0]
      moved: Readonly<Record<string, string>>
    },
  ) => {
    const signal = progress.controller.signal
    signal.throwIfAborted()
    const pending = await server.api.session.inbox.list({ sessionID: input.sessionID })
    signal.throwIfAborted()

    if (pending.some((item) => item.delivery === "queue" && item.type !== "user"))
      throw new Error("Queued control items block reordering")
    const current = pending.filter((item): item is QueuedPrompt => item.type === "user" && item.delivery === "queue")
    const ordered = inboxIDs ? inboxIDs.flatMap((id) => current.filter((item) => item.id === id)) : current

    // An edited prompt delivered meanwhile is no longer queued; fail so the edit draft stays.
    if (ordered.length !== current.length || (replace && !current.some((item) => item.id === replace.original)))
      throw new Error("Queued prompts changed before reordering")
    const changed = ordered.findIndex((item, index) => item.id !== current[index]?.id || item.id === replace?.original)

    if (changed < 0) return

    // Existing inbox APIs cannot reorder rows, so replace only the changed suffix. A replacement
    // can fail (its file may be gone), so withdraw the ones already sent to keep the queue intact.
    // Each ID is recorded before sending: the server can admit a prompt whose response then fails.
    const replacements: string[] = []

    const withdraw = () =>
      Promise.all(
        replacements.map((inboxID) =>
          server.api.session.inbox.cancel({ sessionID: input.sessionID, inboxID }).then(
            () => void progress.hidden.push(inboxID),
            () => undefined,
          ),
        ),
      )

    // A rewrite stopped by its bound withdraws what it sent, as a failed one does.
    const stopped = async () => {
      if (!signal.aborted) return
      await withdraw()
      signal.throwIfAborted()
    }

    // An edit's pending rows follow the queue as the server has it now, keeping the IDs minted at confirm.
    const moved = Object.fromEntries(
      ordered.slice(changed).map((item) => [item.id, replace?.moved[item.id] ?? SessionMessage.ID.create()]),
    )

    dispatch({ type: "mutation.moved", attempt, moved })

    for (const item of ordered.slice(changed)) {
      const admission =
        item.id === replace?.original
          ? replace.admission
          : {
              id: moved[item.id],
              sessionID: input.sessionID,
              text: item.payload.text,
              files: item.payload.files?.map((file) => ({
                uri: storedFileUri(file),
                name: file.name,
                description: file.description,
                mention: file.mention,
              })),
              agents: item.payload.agents,
              skills: item.payload.skills,
              metadata: item.payload.metadata,
              delivery: "queue" as const,
              resume: false,
            }

      const id = admission.id ?? SessionMessage.ID.create()

      await stopped()
      replacements.push(id)
      await data.session.prompt({ ...admission, id }).catch(async (error) => {
        await withdraw()
        throw error
      })
    }

    await stopped()
    // Every copy is in, so the originals must go, however long that takes, or the queue holds both.
    progress.stage = "committed"

    if (replace) dispatch({ type: "mutation.admitted", attempt })

    // An edit cancels last first: the strip shows each original until it goes, so its copies never
    // show out of order.
    const replaced = current.slice(changed)

    for (const item of replace ? replaced.reverse() : replaced) {
      await server.api.session.inbox.cancel({ sessionID: input.sessionID, inboxID: item.id })
      progress.hidden.push(item.id)
    }
  }

  createEffect(() => {
    const items = queued()
    dispatch({ type: "inbox.synced", items })
  })

  onCleanup(() => dispatch({ type: "dispose" }))

  const reverted = () => !!data.session.get(input.sessionID)?.revert

  const edit = (id: string) => {
    const draft = input.draft.current()

    dispatch({
      type: "edit.start",
      id,
      reverted: reverted(),
      draft: {
        prompt: clonePrompt(draft),
        cursor: input.draft.cursor() ?? promptLength(draft),
        mode: input.draft.mode.current(),
        retry: input.draft.retry.current(),
      },
    })

    return editingID(state()) === id
  }

  return {
    count: () => view().rows.length,
    delivery: () => view().delivery,
    alternate: () => view().alternate,
    editing: () => view().editing,
    confirmEdit: (delivery: ComposerDelivery) =>
      dispatch({
        type: "edit.confirm",
        delivery,
        reverted: reverted(),
        prompt: clonePrompt(input.draft.current()),
        ids: queued().map(() => SessionMessage.ID.create()),
      }),
    cancelEdit: () => dispatch({ type: "edit.cancel" }),
    editFirst: () => {
      const first = view().rows[0]

      if (!first) return false

      return edit(first.id)
    },
    rows: () => view().rows,
    moved: () => view().moved,
    busy: () => view().busy,
    undoing: () => view().undoing,
    working: input.working,
    steer: (id: string) => dispatch({ type: "steer.requested", id }),
    remove: (id: string) => dispatch({ type: "remove.requested", id }),
    undo: (id: string) => dispatch({ type: "undo.requested", id, mode: input.draft.mode.current() }),
    edit,
    reorder: (inboxIDs: string[]) => dispatch({ type: "reorder.requested", inboxIDs, reverted: reverted() }),
  }
}

export type SessionQueue = ReturnType<typeof createSessionQueue>

// What a running operation has done so far: the IDs it withdrew or cancelled, and how far it got.
type MutationProgress = { controller: AbortController; hidden: string[]; stage: QueueMutationStage }

// The slice of the queue the panel renders and drives. Without `moved`, a replaced row closes and its replacement opens.
export type SessionQueueView = Pick<
  SessionQueue,
  "rows" | "editing" | "working" | "busy" | "steer" | "remove" | "undo" | "edit" | "reorder"
> &
  Partial<Pick<SessionQueue, "moved">>

// Pin `media:<hash>` attachments before cancelling: the cancel releases the item's blob refs and sweeps blobs
// nothing else references, so a pin that fails leaves the item queued.
// An undo stopped while its media loads leaves the item queued.
export async function undoQueuedPrompt<A>(input: {
  prompt: Prompt
  signal?: AbortSignal
  cancelInboxItem: () => Promise<A>
}): Promise<Prompt> {
  const pinned = await pinPromptMedia(input.prompt)
  input.signal?.throwIfAborted()
  await input.cancelInboxItem()

  return pinned
}

// A stored file re-admits by the URI it came from, as the TUI does, so a file:// reference keeps its
// provenance (review comment files stay recognizable) instead of turning into an inline snapshot.
function storedFileUri(file: PromptAttachment) {
  const source = file.source

  return source?.type === "uri" ? source.uri : "uri" in file ? file.uri : `data:${file.mime};base64,${file.data}`
}

// Confirming an edit submits the current composer content as the replacement:
// mentions and attachments are parsed like a normal submission, so removed
// attachments drop and added ones join. Stored file mentions and context files
// the composer cannot show are preserved, and the review-comment notes appended
// to the original's model-visible text survive. Ambient composer context (open
// review comments) stays out: it belongs to the next fresh prompt, not to a
// queued edit.
async function editedPromptInput(
  sessionID: string,
  directory: string,
  item: QueuedPrompt | undefined,
  prompt: Prompt,
  text: string,
) {
  const images = await Promise.all(
    prompt
      .filter((part): part is ImageAttachmentPart => part.type === "image")
      .map(async (part) => ({ ...part, dataUrl: await blobDataUrl(part.blob, part.mime) })),
  )

  const request = buildPromptRequest({ prompt, context: [], images, text, sessionDirectory: directory })
  const payload = item?.payload
  const display = item ? queuedPromptText(item) : ""
  const notes = payload && display && payload.text.startsWith(display) ? payload.text.slice(display.length) : ""

  const mention = (value: { start: number; end: number; text: string } | undefined) => {
    if (!value) return undefined
    const start = text.indexOf(value.text)

    if (start < 0) return undefined

    return { text: value.text, start, end: start + value.text.length }
  }

  // Structured mentions degrade to plain text in the editor, so an original
  // agent or skill reference survives the edit as long as its mention text
  // still appears; newly typed structured mentions come from the request.
  const agents = [
    ...(payload?.agents?.filter(
      (agent) =>
        (!agent.mention || text.includes(agent.mention.text)) &&
        !request.agents.some((entry) => entry.name === agent.name),
    ) ?? []),
    ...request.agents,
  ]

  const skills = [
    ...(payload?.skills?.filter(
      (skill) =>
        (!skill.mention || text.includes(skill.mention.text)) && !request.skills.some((entry) => entry.id === skill.id),
    ) ?? []),
    ...request.skills,
  ]

  return {
    sessionID,
    text: request.text + notes,
    files: [
      // A stored file whose mention the edit deleted is dropped; unmentioned context stays.
      ...(payload?.files
        ?.filter(
          (file) =>
            !isComposerAttachment(file) &&
            (!file.mention || text.includes(file.mention.text)) &&
            !request.files.some((entry) => entry.uri === storedFileUri(file)),
        )
        .map((file) => ({
          uri: storedFileUri(file),
          name: file.name,
          description: file.description,
          mention: mention(file.mention),
        })) ?? []),
      ...request.files.map((file) => ({
        uri: file.uri,
        name: file.name,
        description: file.description,
        mention: file.mention,
      })),
    ],
    agents: agents.map((agent) => ({ name: agent.name, mention: mention(agent.mention) })),
    skills: skills.map((skill) => ({ id: skill.id, mention: mention(skill.mention) })),
    // Presentation metadata reads only with a comments list, which prompts from other clients lack.
    // Comments survive while their notes stay out of the edited text; when the editor showed the
    // notes as text (a prompt with no display text), the edit owns them and the comments go.
    metadata: {
      ...payload?.metadata,
      comments: notes ? (payload?.metadata?.["comments"] ?? []) : [],
      displayText: request.displayText,
      attachments: request.attachments,
    },
  }
}
