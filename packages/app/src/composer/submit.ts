import { SessionMessage } from "@opencode/schema/session-message"
import type { SessionMessageUser } from "@opencode/client/promise"
import type { Accessor } from "solid-js"
import type { PromptComment } from "./comment-note"
import type { PromptHistoryComment } from "./history/entry"
import type { ImageAttachmentPart, Prompt } from "./state"
import { clonePrompt, promptLength } from "./prompt-parts"
import type { ComposerAdapter, ComposerDelivery, ComposerSelection, ComposerSession } from "./adapter"
import { createComposerSubmission } from "./submission-state"
import { buildPromptRequest, noteComment } from "./request"
import { setCursorPosition } from "./editor/dom"
import { blobDataUrl, resolveBlobUrl } from "@/runtime/persistence/drafts"
import { isAttachment } from "./prompt-parts"
import type { ModelSelection } from "@/providers/models/selection"
import { parseSlashCommand } from "./client-slash-command"

const submitting = new WeakSet<object>()

type ComposerSubmission = {
  id: SessionMessage.ID
  mode: "normal" | "shell"
  prompt: Prompt
  context: ReturnType<ComposerAdapter["state"]["context"]["items"]>
  text: string
  images: ImageAttachmentPart[]
  selection: ComposerSelection
  delivery: ComposerDelivery
}

type ComposerSubmitInput = {
  adapter: ComposerAdapter
  mode: Accessor<"normal" | "shell">
  commands: Accessor<readonly { name: string }[] | undefined>
  editor: () => HTMLDivElement | undefined
  queueScroll: () => void
  addToHistory: (prompt: Prompt, mode: "normal" | "shell") => void
  removeFromHistory: (prompt: Prompt, mode: "normal" | "shell", comments: PromptHistoryComment[]) => void
  resetHistory: () => void
  setMode: (mode: "normal" | "shell") => void
  closePopover: () => void
  delivery?: (alternate: boolean) => ComposerDelivery
  clientCommand?: (text: string) => (() => void | Promise<void>) | undefined
  notify: {
    missingSelection: () => void
    unqueueable: () => void
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a rejected send is opaque; the notifier formats it
    failed: (kind: "shell" | "command" | "prompt", error: unknown) => void
  }
  comments: {
    capture: () => PromptHistoryComment[]
    clear: () => void
    restore: (comments: PromptHistoryComment[]) => void
  }
}

export function createComposerSubmit(input: ComposerSubmitInput) {
  const submit = async (event: globalThis.Event, options?: { alternate?: boolean }) => {
    event.preventDefault()

    const prompt = clonePrompt(input.adapter.state.current())
    const text = submissionText(prompt)
    const clientCommand = input.mode() === "normal" ? input.clientCommand?.(text) : undefined

    if (clientCommand) {
      if (submitting.has(input.adapter.state)) return
      submitting.add(input.adapter.state)

      try {
        // Client commands such as /btw answer with the session's model, so apply the composer's selection first,
        // following the same steer rule as server commands.
        const selection = currentSelection(input)

        if (input.adapter.kind === "active-session" && selection && (input.delivery?.(false) ?? "steer") === "steer")
          await applySelection(
            input.adapter.session(),
            selection,
            input.adapter.controls().model.selection.trackSessionCommit,
          )
        clearClientCommand(input, prompt)
        await clientCommand()
      } catch (error) {
        input.notify.failed("command", error)
      } finally {
        submitting.delete(input.adapter.state)
      }

      return
    }

    const submission = createComposerSubmission({
      target: input.adapter.state,
      prompt,
      context: input.adapter.state.context
        .items()
        .map((item) =>
          item.type === "note"
            ? { ...item, live: item.live ? { ...item.live } : undefined }
            : { ...item, selection: item.selection ? { ...item.selection } : undefined },
        ),
    })

    const read = readSubmission(input, submission.prompt, submission.context, text, options?.alternate ?? false)

    if (!read) {
      if (input.adapter.working() && input.adapter.kind === "active-session") void input.adapter.interrupt()

      return
    }

    // Like the TUI, a shell command runs now or not at all; it cannot wait in the queue.
    if (read.mode === "shell" && read.delivery === "queue") {
      input.notify.unqueueable()

      return
    }

    if (submitting.has(input.adapter.state)) return

    // Images restored from a draft or history carry ids only; the optimistic message shows their URLs.
    const value = {
      ...read,
      images: await Promise.all(
        read.images.map(async (image) => ({
          ...image,
          blob: { ...image.blob, url: (await resolveBlobUrl(image.blob)) ?? image.blob.url },
        })),
      ),
    }

    submitting.add(input.adapter.state)
    const comments = input.comments.capture()
    // Capture command intent before starting a session in a worktree whose catalog has not loaded.
    const command = value.mode === "normal" ? findCommand(input.commands(), value.text) : undefined

    try {
      const started =
        input.adapter.kind === "active-session"
          ? { session: input.adapter.session(), cleanupReady: Promise.resolve() }
          : await input.adapter.start(value.selection, submission, handoffMessage(value))

      if (!started) return
      const session = started.session

      input.addToHistory(value.prompt, value.mode)
      input.resetHistory()
      const restore = () => restoreSubmission(input, submission, value, comments)

      if (value.mode === "normal" && !command) {
        session.handoff?.set(handoffMessage(value))
        const optimisticBusy = !input.adapter.working()

        if (optimisticBusy && input.adapter.kind === "new-session")
          session.data.session.setStatus(session.id, "running")

        const sending = sendPrompt(session, value, input.adapter.controls().model.selection.trackSessionCommit, () => {
          if (optimisticBusy && input.adapter.kind === "active-session")
            session.data.session.setStatus(session.id, "running")
        }).then(
          () => ({ ok: true as const }),
          (error) => ({ ok: false as const, error }),
        )

        await started.cleanupReady
        await started.complete?.()
        input.adapter.submitted()
        // Like the TUI, sent context goes with the prompt rather than riding along on the next one.
        submission.context.forEach((item) => submission.target().context.remove(item.key))
        input.comments.clear()
        clearSubmission(input, submission)
        void sending.then((result) => {
          if (!result.ok)
            failSubmission(input, session, "prompt", result.error, restore, value.id, () => {
              if (optimisticBusy) session.data.session.setStatus(session.id, "idle")
            })
        })

        return
      }

      await started.cleanupReady
      await started.complete?.()
      input.adapter.submitted()

      if (value.mode === "shell") {
        clearSubmission(input, submission)
        void sendShell(session, value).catch((error) => failSubmission(input, session, "shell", error, restore))

        return
      }

      if (command) {
        clearSubmission(input, submission)
        void sendCommand(session, value, command, input.adapter.controls().model.selection.trackSessionCommit).catch(
          (error) => failSubmission(input, session, "command", error, restore, value.id),
        )

        return
      }
    } finally {
      submitting.delete(input.adapter.state)
    }
  }

  return {
    submit,
    stop: () => (input.adapter.kind === "active-session" ? input.adapter.interrupt() : Promise.resolve()),
  }
}

function clearClientCommand(input: ComposerSubmitInput, prompt: Prompt) {
  input.adapter.state.set([{ type: "text", content: "", start: 0, end: 0 }, ...prompt.filter(isAttachment)], 0)
  input.adapter.state.mode.set("normal")
  input.setMode("normal")
  input.closePopover()
}

function selectionModel(selection: ComposerSelection) {
  const model: ComposerSelection["model"] & { variant?: string } = { ...selection.model }

  if (selection.variant) model.variant = selection.variant

  return model
}

function submissionText(prompt: Prompt) {
  return prompt.map((part) => ("content" in part ? part.content : "")).join("")
}

function handoffMessage(value: ComposerSubmission): SessionMessageUser {
  return {
    id: value.id,
    type: "user",
    text: value.text,
    files: value.images.map((image) => ({
      data: "",
      mime: image.mime,
      source: { type: "uri", uri: image.blob.url },
      name: image.sourcePath ?? image.filename,
    })),
    metadata: {
      displayText: value.text,
      attachments: value.prompt.flatMap((part) =>
        part.type === "path" ? [{ name: part.filename, mime: part.mime, path: part.path }] : [],
      ),
      comments: value.context.flatMap((item): PromptComment[] => {
        const comment = item.comment?.trim()

        if (!comment) return []

        if (item.type === "note") return [noteComment(item, comment)]

        return [
          {
            path: item.path,
            comment,
            selection: item.selection && { ...item.selection },
            preview: item.preview,
            origin: item.commentOrigin,
          },
        ]
      }),
      agent: value.selection.agent,
      model: selectionModel(value.selection),
    },
    time: { created: Date.now() },
  }
}

function readSubmission(
  input: ComposerSubmitInput,
  prompt: Prompt,
  context: ComposerSubmission["context"],
  text: string,
  alternate: boolean,
): ComposerSubmission | undefined {
  const mode = input.mode()

  if (mode === "shell" && !text.trim()) return
  const images = prompt.filter((part): part is ImageAttachmentPart => part.type === "image")
  // Like the TUI's blank Enter, file chips alone send nothing; they wait for text.
  const comments = context.filter((item) => !!item.comment?.trim()).length

  if (!text.trim() && !prompt.some(isAttachment) && comments === 0) return

  const selection = currentSelection(input)

  if (!selection) {
    input.notify.missingSelection()

    return
  }

  const retry = input.adapter.state.retry.current()

  const retryID =
    retry &&
    retry.agent === selection.agent &&
    retry.providerID === selection.model.providerID &&
    retry.modelID === selection.model.modelID &&
    (retry.variant ?? "default") === (selection.variant ?? "default")
      ? retry.id
      : undefined

  return {
    id: retryID ?? SessionMessage.ID.create(),
    mode,
    prompt,
    context,
    text,
    images,
    selection,
    delivery: input.delivery?.(alternate) ?? "steer",
  }
}

function currentSelection(input: ComposerSubmitInput): ComposerSelection | undefined {
  const controls = input.adapter.controls()
  const model = controls.model.selection.current()
  const agent = controls.agents.current

  if (!model || !agent) return

  return {
    agent,
    model: { modelID: model.id, providerID: model.provider.id },
    variant: controls.model.selection.variant.current(),
  }
}

function clearSubmission(input: ComposerSubmitInput, submission: ReturnType<typeof createComposerSubmission>) {
  submission.clear()
  submission.target().mode.set("normal")
  input.setMode("normal")
  input.closePopover()

  if (window.matchMedia("(max-width: 767px)").matches) input.editor()?.blur()
}

function restoreSubmission(
  input: ComposerSubmitInput,
  submission: ReturnType<typeof createComposerSubmission>,
  value: ComposerSubmission,
  comments: PromptHistoryComment[],
) {
  const restored = submission.restore()

  if (!restored) return false
  // The prompt is back in the composer; its history entry would only keep attachments referenced.
  input.removeFromHistory(value.prompt, value.mode, comments)
  restored.target.set(restored.prompt, promptLength(restored.prompt))
  restored.target.mode.set(value.mode)
  restored.target.context.replaceComments(
    restored.context
      .filter((item) => !!item.comment?.trim())
      .map((item) =>
        item.type === "note"
          ? {
              type: "note",
              origin: item.origin,
              label: item.label,
              icon: item.icon,
              subject: item.subject,
              href: item.href,
              live: item.live,
              comment: item.comment,
              commentID: item.commentID,
            }
          : {
              type: "file",
              path: item.path,
              selection: item.selection,
              comment: item.comment,
              commentID: item.commentID,
              commentOrigin: item.commentOrigin,
              preview: item.preview,
            },
      ),
  )
  restored.context.forEach((item) => {
    if (item.type === "file" && !item.comment?.trim())
      restored.target.context.add({
        type: "file",
        path: item.path,
        selection: item.selection,
        name: item.name,
        description: item.description,
      })
  })

  // A recovered follow-up changes the payload, so it must use a new admission ID.
  if (value.mode === "normal" && restored.prompt === submission.prompt) {
    restored.target.retry.set({
      id: value.id,
      agent: value.selection.agent,
      providerID: value.selection.model.providerID,
      modelID: value.selection.model.modelID,
      variant: value.selection.variant,
    })
  }

  if (!submission.current(input.adapter.state)) return true

  input.comments.restore(comments)
  input.setMode(value.mode)
  input.closePopover()
  requestAnimationFrame(() => {
    const editor = input.editor()

    if (!editor) return
    editor.focus()
    setCursorPosition(editor, promptLength(value.prompt))
    input.queueScroll()
  })

  return true
}

async function sendShell(session: ComposerSession, value: ComposerSubmission) {
  await session.api.shell({ sessionID: session.id, id: value.id, command: value.text })
}

function findCommand(commands: ReturnType<ComposerSubmitInput["commands"]>, text: string) {
  const parsed = parseSlashCommand(text)

  if (!parsed || !commands?.some((item) => item.name === parsed.name)) return

  return { command: parsed.name, arguments: parsed.input }
}

async function sendCommand(
  session: ComposerSession,
  value: ComposerSubmission,
  command: { command: string; arguments: string },
  track?: ModelSelection["trackSessionCommit"],
) {
  const request = await buildSubmissionRequest(session, value)

  // Like queued prompts, queued commands must not apply the composer's selection to active work.
  if (value.delivery === "steer") await applySelection(session, value.selection, track)
  await session.api.command({
    sessionID: session.id,
    name: command.command,
    text: command.arguments,
    files: request.files.map((file) => ({
      uri: file.uri,
      name: file.name,
      description: file.description,
      mention: file.mention,
    })),
    agents: request.agents,
    skills: request.skills,
    delivery: value.delivery,
  })
}

async function applySelection(
  session: ComposerSession,
  selection: ComposerSelection,
  track?: ModelSelection["trackSessionCommit"],
  beforeModel?: () => Promise<void>,
) {
  const cancel = track?.(session.id, selection)

  try {
    const current = session.current()

    if (current?.agent !== selection.agent) {
      await session.api.switchAgent({ sessionID: session.id, agent: selection.agent })
    }

    await beforeModel?.()

    // The server deduplicates unchanged selections; cached SSE state may still be behind an earlier switch.
    await session.api.switchModel({
      sessionID: session.id,
      model: { id: selection.model.modelID, providerID: selection.model.providerID, variant: selection.variant },
    })
  } catch (error) {
    cancel?.()
    throw error
  }
}

async function sendPrompt(
  session: ComposerSession,
  value: ComposerSubmission,
  track: ModelSelection["trackSessionCommit"] | undefined,
  onAdmit: () => void,
) {
  const request = await buildSubmissionRequest(session, value)

  // Switching agent or model reconfigures the session immediately, and with it
  // the remainder of a running turn. A steer targets that turn, so its
  // selection applies now; a queued follow-up must not reconfigure the turn it
  // waits behind, so it runs with the session selection at delivery time (the
  // intended selection stays recorded in its metadata).
  // Like the TUI, a staged revert settles after the agent switch and before the model switch and admission. The
  // server would otherwise commit it on admission and delete every row from its boundary on, the model switch too.
  const settle = async () => {
    if (session.current()?.revert) await session.api.revert.commit({ sessionID: session.id })
  }

  const prepared = value.delivery === "steer" ? applySelection(session, value.selection, track, settle) : settle()

  // A committed revert also deletes inbox rows after its boundary, so do not insert the optimistic row before it.
  if (session.current()?.revert) await prepared

  const admission = {
    // Render through the client's existing optimistic admission before selection finishes, but keep the POST gated.
    gate: prepared,
    id: value.id,
    sessionID: session.id,
    delivery: value.delivery,
    text: request.text,
    files: request.files.map((file) => ({
      uri: file.uri,
      name: file.name,
      description: file.description,
      mention: file.mention,
    })),
    agents: request.agents,
    skills: request.skills,
    metadata: {
      displayText: request.displayText,
      comments: request.comments,
      attachments: request.attachments,
      agent: value.selection.agent,
      model: selectionModel(value.selection),
    },
  }

  const sending = session.data.session.prompt(admission).catch(() => session.data.session.prompt(admission))
  onAdmit()
  await sending
}

async function buildSubmissionRequest(session: ComposerSession, value: ComposerSubmission) {
  const images = await Promise.all(
    value.images.map(async (attachment) => ({
      ...attachment,
      dataUrl: await blobDataUrl(attachment.blob, attachment.mime),
    })),
  )

  return buildPromptRequest({
    prompt: value.prompt,
    context: value.context,
    images,
    text: value.text,
    sessionDirectory: session.directory,
  })
}

function failSubmission(
  input: ComposerSubmitInput,
  session: ComposerSession,
  kind: "shell" | "command" | "prompt",
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a rejected send is opaque; the notifier formats it
  error: unknown,
  restore: () => boolean,
  messageID?: string,
  rollback?: () => void,
) {
  if (messageID && session.admitted(messageID)) return

  if (messageID) session.handoff?.clear(messageID)
  rollback?.()
  restore()
  input.notify.failed(kind, error)
}
