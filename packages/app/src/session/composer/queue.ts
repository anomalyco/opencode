import { createEffect, createMemo, onCleanup, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { useMutation } from "@tanstack/solid-query"
import { Option, Schema } from "effect"
import type { PromptAttachment, SessionInboxInfo } from "@opencode/client/promise"
import { SessionMessage } from "@opencode/schema/session-message"
import type { ComposerDelivery, ComposerSession } from "@/composer/adapter"
import type { ComposerStateTarget } from "@/composer/submission-state"
import type { ContextItem, ImageAttachmentPart, PathAttachmentPart, Prompt } from "@/composer/state"
import { appendPrompt, clonePrompt, isAttachment, promptLength } from "@/composer/prompt-parts"
import { buildPromptRequest } from "@/composer/request"
import { type BlobReference, blobDataUrl, createLegacyBlobReference } from "@/runtime/persistence/drafts"
import { readPromptPresentation } from "@/composer/comment-note"
import { pinPromptMedia } from "@/composer/media"
import { extractPromptContext, extractPromptFromMessage } from "@/composer/prompt"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useLanguage } from "@/runtime/i18n/language"
import { showToast } from "@/shell/notifications/toast"

type QueuedPromptFile = PromptAttachment

export type QueuedPrompt = Extract<SessionInboxInfo, { type: "user" }>

// An edit confirmed from the composer while the server catches up. The strip shows it in place of
// the original until the server's queue reflects it, so a slow round trip never looks undone.
export type SentEdit = {
  original: string
  delivery: ComposerDelivery
  text: string
  attachments: number
  // Each inbox ID the edit replaces, mapped to the ID admitted in its place: the original's
  // replacement and, for a queued edit, the prompts after it that are re-admitted to keep their order.
  moved: Record<string, string>
  // The server admitted every replacement, so a later failure must not resend the edit.
  admitted: boolean
}

type EditStash = {
  prompt: Prompt
  cursor: number
  mode: "normal" | "shell"
  retry: ReturnType<ComposerStateTarget["retry"]["current"]>
}

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

  const [state, setState] = createStore<{
    editing?: { id: string; stash: EditStash }
    sent: SentEdit[]
    // Reordering re-admits prompts under new inbox IDs. Keep their existing row keys until the
    // whole rewrite settles so admission and cancellation events cannot grow or shrink the strip.
    reordering?: { rows: ReturnType<typeof queuedPromptRows>; moved: Record<string, string> }
    // Prompts the server confirmed have left the queue. The pending list only drops them when the
    // server's events arrive, which lag on a loaded server, so the strip hides them until then.
    gone: string[]
  }>({ sent: [], gone: [] })

  const notify = () => showToast({ title: language.t("common.requestFailed") })
  const settle = (original: string) => setState("sent", (sent) => sent.filter((edit) => edit.original !== original))
  // A missed event would hide a row for good, so each hidden ID expires. A pending re-sync is no
  // substitute: it drops rows from the pending list but leaves their materialized messages in the
  // timeline as if delivered.
  const expiries = new Set<ReturnType<typeof setTimeout>>()
  onCleanup(() => expiries.forEach(clearTimeout))

  const hide = (ids: string[]) => {
    setState("gone", (gone) => [...gone, ...ids])

    const timer = setTimeout(() => {
      expiries.delete(timer)
      setState("gone", (gone) => gone.filter((id) => !ids.includes(id)))
    }, 30_000)

    expiries.add(timer)
  }

  const mutation = useMutation(() => ({
    // Changes run one at a time in the order they were made, so an edit confirmed while another is
    // in flight waits for it instead of being dropped.
    scope: { id: `session-queue:${input.sessionID}` },
    mutationFn: async (
      change:
        | { type: "reorder"; inboxIDs: string[] }
        | { type: "undo"; item: QueuedPrompt; prompt: Prompt; context: ContextItem[] }
        | {
            type: "edit"
            original: string
            moved: Record<string, string>
            item: QueuedPrompt | undefined
            prompt: Prompt
            text: string
            delivery: ComposerDelivery
          },
    ) => {
      if (change.type === "reorder") return rewrite(change.inboxIDs)

      if (change.type === "undo") {
        const rehydrated = await undoQueuedPrompt({
          prompt: change.prompt,
          cancelInboxItem: () =>
            server.api.session.inbox.cancel({ sessionID: input.sessionID, inboxID: change.item.id }),
        })

        hide([change.item.id])
        const prompt = mergePrompt(input.draft.current(), rehydrated)

        input.draft.set(prompt, promptLength(prompt))
        change.context.forEach((item) => input.draft.context.add(item))
        input.restoreFocus(promptLength(prompt))

        return
      }

      const replacement = await editedPromptInput(
        input.sessionID,
        location().directory,
        change.item,
        change.prompt,
        change.text,
      )

      // Admit before cancelling so a failed replacement never discards the original. A queued edit
      // rebuilds its position in one rewrite, which leaves the queue unchanged if any admission fails.
      const admission = { ...replacement, id: change.moved[change.original], delivery: change.delivery }

      if (change.delivery === "queue")
        return rewrite(undefined, {
          original: change.original,
          admission: { ...admission, resume: false },
          moved: change.moved,
        })

      // Like a queued edit, an original the server delivered meanwhile keeps the edit draft instead of sending twice.
      const pending = await server.api.session.inbox.list({ sessionID: input.sessionID })

      if (!pending.some((item) => item.id === change.original && item.type === "user" && item.delivery === "queue"))
        throw new Error("Queued prompt was delivered before the edit")
      const background = input.background()
      await data.session.prompt(admission)
      void background?.move()
      setState("sent", (edit) => edit.original === change.original, "admitted", true)
      // Cancelling is a no-op once the original is gone, so one retry is safe.
      const cancel = () => server.api.session.inbox.cancel({ sessionID: input.sessionID, inboxID: change.original })
      await cancel().catch(cancel)
    },
    onSuccess: (_data, change) => {
      if (change.type !== "edit") return
      hide(Object.keys(state.sent.find((edit) => edit.original === change.original)?.moved ?? change.moved))
      settle(change.original)
    },
    onError: (_error, change) => {
      notify()

      if (change.type !== "edit") return
      const sent = state.sent.find((edit) => edit.original === change.original)
      settle(change.original)

      if (sent?.admitted) return
      restoreEdit(change.prompt)
    },
    onSettled: async (_data, _error, change) => {
      if (change.type === "reorder") data.session.pending.invalidate(input.sessionID)
      await data.session.pending.sync(input.sessionID).catch(() => undefined)

      if (change.type === "reorder") setState("reordering", undefined)
    },
  }))

  const queued = createMemo(() =>
    data.session.pending
      .list(input.sessionID)
      .filter((item): item is QueuedPrompt => item.type === "user" && item.delivery === "queue"),
  )

  const rows = createMemo(() => {
    const current = queuedPromptRows(queued(), state.sent, state.gone)
    const reordering = state.reordering

    if (!reordering) return current
    const hidden = new Set([...reordering.rows.map((row) => row.id), ...Object.values(reordering.moved)])

    // Fresh prompts still appear while the reordered rows keep their optimistic positions.
    return [...reordering.rows, ...current.filter((row) => !hidden.has(row.id))]
  })

  createEffect(() => {
    const listed = new Set(queued().map((item) => item.id))

    if (state.gone.every((id) => listed.has(id))) return
    setState("gone", (gone) => gone.filter((id) => listed.has(id)))
  })

  createEffect(() => {
    const editing = state.editing

    if (!editing || mutation.isPending || queued().some((item) => item.id === editing.id)) return
    setState("editing", undefined)
  })

  // A failed edit returns to the composer, merged into what it holds now (or into the draft an
  // open edit stashed), so nothing typed is lost.
  const restoreEdit = (prompt: Prompt) => {
    if (state.editing) {
      setState("editing", "stash", "prompt", (stash) => mergePrompt(stash, prompt))

      return
    }

    const merged = mergePrompt(input.draft.current(), prompt)
    input.draft.set(merged, promptLength(merged))
    input.restoreFocus(promptLength(merged))
  }

  onCleanup(() => cancelEdit())

  // `replace` substitutes an edited prompt for the original at its position in the same rewrite.
  // Without `inboxIDs` the server's current order is kept.
  const rewrite = async (
    inboxIDs: string[] | undefined,
    replace?: { original: string; admission: Parameters<typeof data.session.prompt>[0]; moved: Record<string, string> },
  ) => {
    const pending = await server.api.session.inbox.list({ sessionID: input.sessionID })

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

    // An edit's pending rows follow the queue as the server has it now, keeping the IDs minted at confirm.
    const moved = Object.fromEntries(
      ordered.slice(changed).map((item) => [item.id, replace?.moved[item.id] ?? SessionMessage.ID.create()]),
    )

    if (replace) setState("sent", (edit) => edit.original === replace.original, "moved", moved)

    if (!replace) setState("reordering", "moved", moved)

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

      replacements.push(id)
      await data.session.prompt({ ...admission, id }).catch(async (error) => {
        await Promise.all(
          replacements.map((inboxID) =>
            server.api.session.inbox.cancel({ sessionID: input.sessionID, inboxID }).then(
              () => {
                if (!replace) hide([inboxID])
              },
              () => undefined,
            ),
          ),
        )
        throw error
      })
    }

    if (replace) setState("sent", (edit) => edit.original === replace.original, "admitted", true)

    // An edit cancels last first: the strip shows each original until it goes, so its copies never
    // show out of order.
    const replaced = current.slice(changed)

    for (const item of replace ? replaced.reverse() : replaced) {
      await server.api.session.inbox.cancel({ sessionID: input.sessionID, inboxID: item.id })

      if (!replace) hide([item.id])
    }
  }

  const steer = (id: string) => {
    if (state.editing?.id === id) cancelEdit()
    const background = input.background()

    return server.api.session.inbox.update({ sessionID: input.sessionID, inboxID: id, delivery: "steer" }).then(
      () => {
        void background?.move()
        hide([id])
      },
      () => notify(),
    )
  }

  const remove = (id: string) => {
    if (state.editing?.id === id) cancelEdit()

    return server.api.session.inbox.cancel({ sessionID: input.sessionID, inboxID: id }).then(
      () => hide([id]),
      () => notify(),
    )
  }

  const undo = (id: string) => {
    if (mutation.isPending || state.editing || sending(id)) return
    const item = queued().find((entry) => entry.id === id)

    if (!item) return

    if (input.draft.mode.current() !== "normal") {
      showToast({ title: language.t("session.queue.undoShell") })

      return
    }

    const source = { id: item.id, ...item.payload }
    const context = extractPromptContext(source, { directory: location().directory })

    mutation.mutate({
      type: "undo",
      item,
      prompt: extractPromptFromMessage(source, {
        directory: location().directory,
        attachmentName: language.t("common.attachment"),
        sessionTitle: (id) => data.session.get(id)?.title,
      }),
      context: [...context.comments, ...context.files],
    })
  }

  // Re-admitting a queued prompt commits a staged revert, which drops every prompt queued after its boundary.
  const refuseReverted = () => {
    if (!data.session.get(input.sessionID)?.revert) return false
    showToast({ title: language.t("session.queue.reverted") })

    return true
  }

  const reorder = (inboxIDs: string[]) => {
    if (state.reordering || mutation.isPending || refuseReverted()) return Promise.resolve()
    const current = rows()
    setState("reordering", { rows: inboxIDs.flatMap((id) => current.filter((row) => row.id === id)), moved: {} })

    return mutation.mutateAsync({ type: "reorder", inboxIDs }).catch(() => undefined)
  }

  const sending = (id: string) =>
    state.reordering?.rows.some((row) => row.id === id) ||
    state.sent.some((edit) => id in edit.moved || Object.values(edit.moved).includes(id))

  // Other rows stay editable while a change is in flight; the row it is changing ignores clicks
  // and shows as pending until the server catches up.
  const edit = (id: string) => {
    if (sending(id) || refuseReverted()) return false

    if (state.editing?.id === id) return true
    const item = queued().find((entry) => entry.id === id)

    if (!item) return false

    if (state.editing) cancelEdit()
    const draft = input.draft.current()
    setState("editing", {
      id,
      stash: {
        prompt: clonePrompt(draft),
        cursor: input.draft.cursor() ?? promptLength(draft),
        mode: input.draft.mode.current(),
        retry: input.draft.retry.current(),
      },
    })
    const text = queuedPromptText(item)
    const attachments = queuedPromptAttachments(item)
    input.draft.mode.set("normal")
    input.draft.set([{ type: "text", content: text, start: 0, end: text.length }, ...attachments], text.length)
    input.restoreFocus(text.length)
    // The edit cancels the original once its replacement is admitted, so the draft takes local copies of the
    // queued media as soon as they load; images the user removed meanwhile stay removed.
    void pinPromptMedia(attachments).then(
      (pinned) => {
        if (state.editing?.id !== id) return
        const blobs = new Map<string, BlobReference>()

        for (const part of pinned) if (part.type === "image") blobs.set(part.id, part.blob)
        const current = input.draft.current()
        input.draft.set(
          current.map((part) => {
            const blob = part.type === "image" ? blobs.get(part.id) : undefined

            return blob && part.type === "image" ? { ...part, blob } : part
          }),
          input.draft.cursor() ?? promptLength(current),
        )
      },
      () => undefined,
    )

    return true
  }

  const cancelEdit = () => {
    const editing = state.editing

    if (!editing) return
    setState("editing", undefined)
    // Mode first, then prompt, then retry: mode and prompt writes both clear
    // the retry marker.
    input.draft.mode.set(editing.stash.mode)
    input.draft.set(editing.stash.prompt, editing.stash.cursor)

    if (editing.stash.retry) input.draft.retry.set(editing.stash.retry)
    input.restoreFocus(editing.stash.cursor)
  }

  const confirmEdit = (delivery: ComposerDelivery) => {
    const editing = state.editing

    if (!editing || refuseReverted()) return
    const prompt = clonePrompt(input.draft.current())
    const text = prompt.map((part) => ("content" in part ? part.content : "")).join("")
    const attachments = prompt.filter(isAttachment)

    if (!text.trim() && !attachments.length) return cancelEdit()
    const item = queued().find((entry) => entry.id === editing.id)
    const original = item ? queuedPromptAttachments(item) : []

    const pristine =
      item &&
      text.trim() === queuedPromptText(item) &&
      attachments.length === original.length &&
      attachments.every((attachment, index) => attachment.id === original[index].id)

    if (pristine && delivery === "queue") return cancelEdit()

    // An unchanged prompt steers in place instead of being replaced.
    if (pristine) return void steer(editing.id)
    // A queued edit re-admits the prompts after it, so they are pending too; their IDs are minted now.
    const after = delivery === "queue" ? queued().slice(queued().findIndex((entry) => entry.id === editing.id) + 1) : []

    const moved = Object.fromEntries(
      [editing.id, ...after.map((entry) => entry.id)].map((id) => [id, SessionMessage.ID.create()]),
    )

    // Optimistic: the composer returns to the draft it held before the edit and the strip shows
    // the edited prompt as pending. A failure restores the edit; see restoreEdit.
    setState("sent", (sent) => [
      ...sent,
      { original: editing.id, delivery, text: text.trim(), attachments: attachments.length, moved, admitted: false },
    ])
    cancelEdit()
    mutation.mutate({ type: "edit", original: editing.id, moved, item, prompt, text, delivery })
  }

  const editFirst = () => {
    const first = rows()[0]

    if (!first) return false

    return edit(first.id)
  }

  return {
    count: () => rows().length,
    delivery: () => (input.working() ? input.behavior() : "steer"),
    alternate: () => {
      if (state.editing) return "steer"

      if (!input.working()) return undefined

      return input.behavior() === "queue" ? "steer" : "queue"
    },
    editing: () => state.editing?.id,
    confirmEdit,
    cancelEdit,
    editFirst,
    rows,
    busy: () => mutation.isPending,
    undoing: () => mutation.isPending && mutation.variables?.type === "undo",
    working: input.working,
    steer,
    remove,
    undo,
    edit,
    reorder,
  }
}

export type SessionQueue = ReturnType<typeof createSessionQueue>

// The slice of the queue the panel renders and drives.
export type SessionQueueView = Pick<
  SessionQueue,
  "rows" | "editing" | "working" | "busy" | "steer" | "remove" | "undo" | "edit" | "reorder"
>

// An edit in flight shows its edited text on the original row, and every row it rewrites shows as
// pending. A re-admitted copy stays hidden while the row it replaces is listed, so the strip keeps
// its order; a steered edit leaves the strip once the server admits it. Rows the server confirmed
// gone stay hidden while its events catch up.
export function queuedPromptRows(items: QueuedPrompt[], sent: SentEdit[] = [], gone: string[] = []) {
  const queued = items.filter((item) => !gone.includes(item.id))
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

// A prompt of only comments or attachments adds no text, so it needs no paragraph break.
function mergePrompt(draft: Prompt, prompt: Prompt) {
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
  const files: readonly QueuedPromptFile[] = item.payload.files ?? []
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

// Pin `media:<hash>` attachments before cancelling: the cancel releases the item's blob refs and sweeps blobs
// nothing else references, so a pin that fails leaves the item queued.
export async function undoQueuedPrompt<A>(input: {
  prompt: Prompt
  cancelInboxItem: () => Promise<A>
}): Promise<Prompt> {
  const pinned = await pinPromptMedia(input.prompt)
  await input.cancelInboxItem()

  return pinned
}

// A stored file re-admits by the URI it came from, as the TUI does, so a file:// reference keeps its
// provenance (review comment files stay recognizable) instead of turning into an inline snapshot.
function storedFileUri(file: QueuedPromptFile) {
  const source = file.source

  return source?.type === "uri" ? source.uri : "uri" in file ? file.uri : `data:${file.mime};base64,${file.data}`
}

function isComposerAttachment(file: QueuedPromptFile) {
  const source = file.source

  return !file.mention && (!source || source.type === "inline")
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
