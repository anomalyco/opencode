import { createEffect, createMemo, onCleanup, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { useMutation } from "@tanstack/solid-query"
import { Option, Schema } from "effect"
import type { SessionInboxInfo } from "@opencode/client/promise"
import { SessionMessage } from "@opencode/schema/session-message"
import type { ComposerDelivery } from "@/composer/adapter"
import type { ComposerStateTarget } from "@/composer/submission-state"
import type { ContextItem, ImageAttachmentPart, PathAttachmentPart, Prompt } from "@/composer/state"
import { appendPrompt, clonePrompt, isAttachment, promptLength } from "@/composer/prompt-parts"
import { buildPromptRequest } from "@/composer/request"
import { blobDataUrl, createLegacyBlobReference } from "@/runtime/persistence/drafts"
import { readPromptPresentation } from "@/composer/comment-note"
import { extractPromptContext, extractPromptFromMessage } from "@/composer/prompt"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useLanguage } from "@/runtime/i18n/language"
import { showToast } from "@/shell/notifications/toast"

export type QueuedPrompt = Extract<SessionInboxInfo, { type: "user" }>

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
}) {
  const data = useData()
  const server = useServerSDK()
  const location = useWorkspaceLocation()
  const language = useLanguage()
  const [state, setState] = createStore<{ editing?: { id: string; stash: EditStash } }>({})
  const notify = () => showToast({ title: language.t("common.requestFailed") })

  const mutation = useMutation(() => ({
    mutationFn: async (
      change:
        | { type: "reorder"; inboxIDs: string[] }
        | { type: "undo"; item: QueuedPrompt; prompt: Prompt; context: ContextItem[] }
        | {
            type: "edit"
            inboxIDs: string[]
            original: string
            replacement: string
            item: QueuedPrompt | undefined
            prompt: Prompt
            text: string
            delivery: ComposerDelivery
          },
    ) => {
      if (change.type === "reorder") return rewrite(change.inboxIDs)

      if (change.type === "undo") {
        await server.api.session.inbox.cancel({ sessionID: input.sessionID, inboxID: change.item.id })
        const draft = input.draft.current()

        // A prompt of only comments or attachments adds no text, so it needs no paragraph break.
        const prompt = !promptLength(draft)
          ? [...change.prompt, ...draft.filter(isAttachment)]
          : promptLength(change.prompt)
            ? appendPrompt(draft, change.prompt)
            : [...clonePrompt(draft), ...change.prompt.filter(isAttachment)]

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
      const admission = { ...replacement, id: change.replacement, delivery: change.delivery }

      if (change.delivery === "queue") {
        await rewrite(change.inboxIDs, { original: change.original, admission: { ...admission, resume: false } })
        cancelEdit()

        return
      }

      // Like a queued edit, an original the server delivered meanwhile keeps the edit draft instead of sending twice.
      const pending = await server.api.session.inbox.list({ sessionID: input.sessionID })

      if (!pending.some((item) => item.id === change.original && item.type === "user" && item.delivery === "queue"))
        throw new Error("Queued prompt was delivered before the edit")
      await data.session.prompt(admission)
      await server.api.session.inbox.cancel({ sessionID: input.sessionID, inboxID: change.original })
      cancelEdit()
    },
    onError: notify,
    onSettled: () => data.session.pending.sync(input.sessionID).catch(() => undefined),
  }))

  const queued = createMemo(() =>
    data.session.pending
      .list(input.sessionID)
      .filter((item): item is QueuedPrompt => item.type === "user" && item.delivery === "queue"),
  )

  const rows = createMemo(() => {
    const replacement = mutation.isPending ? mutation.variables : undefined

    return queuedPromptRows(
      queued(),
      replacement?.type === "edit" && replacement.delivery === "queue" ? replacement : undefined,
    )
  })

  createEffect(() => {
    const editing = state.editing

    if (!editing || mutation.isPending || queued().some((item) => item.id === editing.id)) return
    setState("editing", undefined)
  })
  onCleanup(() => cancelEdit())

  // `replace` substitutes an edited prompt for the original at its position in the same rewrite.
  const rewrite = async (
    inboxIDs: string[],
    replace?: { original: string; admission: Parameters<typeof data.session.prompt>[0] },
  ) => {
    const pending = await server.api.session.inbox.list({ sessionID: input.sessionID })

    if (pending.some((item) => item.delivery === "queue" && item.type !== "user"))
      throw new Error("Queued control items block reordering")
    const current = pending.filter((item): item is QueuedPrompt => item.type === "user" && item.delivery === "queue")
    const ordered = inboxIDs.flatMap((id) => current.filter((item) => item.id === id))

    // An edited prompt delivered meanwhile is no longer queued; fail so the edit draft stays.
    if (ordered.length !== current.length || (replace && !current.some((item) => item.id === replace.original)))
      throw new Error("Queued prompts changed before reordering")
    const changed = ordered.findIndex((item, index) => item.id !== current[index]?.id || item.id === replace?.original)

    if (changed < 0) return

    // Existing inbox APIs cannot reorder rows, so replace only the changed suffix. A replacement
    // can fail (its file may be gone), so withdraw the ones already sent to keep the queue intact.
    // Each ID is recorded before sending: the server can admit a prompt whose response then fails.
    const replacements: string[] = []

    for (const item of ordered.slice(changed)) {
      const admission =
        item.id === replace?.original
          ? replace.admission
          : {
              id: SessionMessage.ID.create(),
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
            server.api.session.inbox.cancel({ sessionID: input.sessionID, inboxID }).catch(() => undefined),
          ),
        )
        throw error
      })
    }

    for (const item of current.slice(changed)) {
      await server.api.session.inbox.cancel({ sessionID: input.sessionID, inboxID: item.id })
    }
  }

  const steer = (id: string) => {
    if (state.editing?.id === id) cancelEdit()

    return server.api.session.inbox
      .update({ sessionID: input.sessionID, inboxID: id, delivery: "steer" })
      .catch(() => notify())
  }

  const remove = (id: string) => {
    if (state.editing?.id === id) cancelEdit()

    return server.api.session.inbox.cancel({ sessionID: input.sessionID, inboxID: id }).catch(() => notify())
  }

  const undo = (id: string) => {
    if (mutation.isPending || state.editing) return
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
    if (mutation.isPending || refuseReverted()) return Promise.resolve()

    return mutation.mutateAsync({ type: "reorder", inboxIDs }).catch(() => undefined)
  }

  const edit = (id: string) => {
    if (mutation.isPending || refuseReverted()) return false

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
    input.draft.mode.set("normal")
    input.draft.set(
      [{ type: "text", content: text, start: 0, end: text.length }, ...queuedPromptAttachments(item)],
      text.length,
    )
    input.restoreFocus(text.length)

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

    if (!editing || mutation.isPending || refuseReverted()) return
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
    mutation.mutate({
      type: "edit",
      inboxIDs: queued().map((entry) => entry.id),
      original: editing.id,
      replacement: SessionMessage.ID.create(),
      item,
      prompt,
      text,
      delivery,
    })
  }

  const editFirst = () => {
    const first = queued()[0]

    if (!first) return false

    return edit(first.id)
  }

  return {
    count: () => queued().length,
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

export function queuedPromptRows(items: QueuedPrompt[], replacement?: { original: string; replacement: string }) {
  const replaced = replacement && items.some((item) => item.id === replacement.replacement)

  return items.flatMap((item) =>
    replaced && item.id === replacement.original
      ? []
      : [
          {
            id: item.id,
            text: queuedPromptText(item),
            attachments:
              (item.payload.files?.length ?? 0) +
              (readPromptPresentation(item.payload.metadata)?.attachments.length ?? 0),
          },
        ],
  )
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
  return [
    ...(item.payload.files ?? [])
      .filter((file) => isComposerAttachment(file))
      .map(
        (file, index): ImageAttachmentPart => ({
          type: "image",
          id: `${item.id}:file:${index}`,
          filename: file.name ?? "attachment",
          mime: file.mime,
          blob: createLegacyBlobReference(`data:${file.mime};base64,${file.data}`),
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

// A stored file re-admits by the URI it came from, as the TUI does, so a file:// reference keeps its
// provenance (review comment files stay recognizable) instead of turning into an inline snapshot.
function storedFileUri(file: NonNullable<QueuedPrompt["payload"]["files"]>[number]) {
  return file.source.type === "uri" ? file.source.uri : `data:${file.mime};base64,${file.data}`
}

function isComposerAttachment(file: NonNullable<QueuedPrompt["payload"]["files"]>[number]) {
  return !file.mention && file.source.type === "inline"
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
