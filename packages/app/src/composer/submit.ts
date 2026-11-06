import { SessionMessage } from "@opencode/schema/session-message"
import type { SessionMessageUser } from "@opencode/client/promise"
import { createEffect, createSignal, onCleanup, untrack, type Accessor } from "solid-js"
import type { PromptComment } from "./comment-note"
import type { PromptHistoryComment } from "./history/entry"
import { isCommentItem, type ContextItem, type ImageAttachmentPart, type Prompt } from "./state"
import { appendPrompt, clonePrompt, isAttachment, promptLength, serializePrompt } from "./prompt-parts"
import type {
  ComposerAdapter,
  ComposerDelivery,
  ComposerSelection,
  ComposerSession,
  ComposerSubmissionHandle,
} from "./adapter"
import { buildPromptRequest, noteComment, quoteComment } from "./request"
import { setCursorPosition } from "./editor/dom"
import { blobDataUrl, resolveBlobUrl } from "@/runtime/persistence/drafts"
import type { ModelSelection } from "@/providers/models/selection"
import {
  composerSubmitTarget,
  createComposerSubmitState,
  transitionComposerSubmit,
  type CapturedDraft,
  type ComposerSubmission,
  type ComposerSubmitEffect,
  type ComposerSubmitEvent,
  type PromptSend,
  type SubmissionKind,
  type SubmitSnapshot,
} from "./machine"
import { retryFingerprint } from "./retry"
import {
  SERVER_PROMPT_STATUS,
  transitionPromptStatus,
  type PromptStatusEvent,
  type PromptStatusState,
} from "./prompt-status-machine"

// The model each session was last switched to from this client, by session ID.
const switched = new Map<string, string>()

// The optimistic busy status of each session, by session ID. Module-wide, because a new session's first prompt and
// the follow-ups sent from its own composer go through different submit machines. A session left out is `server`.
const statuses = new Map<string, PromptStatusState>()

type ComposerSubmitInput = {
  adapter: ComposerAdapter
  mode: Accessor<"normal" | "shell">
  commands: Accessor<readonly { name: string }[] | undefined>
  editor: () => HTMLDivElement | undefined
  queueScroll: () => void
  addToHistory: (prompt: Prompt, mode: "normal" | "shell") => void
  removeFromHistory: (prompt: Prompt, mode: "normal" | "shell", comments: PromptHistoryComment[]) => void
  resetHistory: () => void
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

// The submit lifecycle is `transitionComposerSubmit`; this runs its effects and turns their results into events.
export function createComposerSubmit(input: ComposerSubmitInput) {
  const [state, setState] = createSignal(createComposerSubmitState())

  const dispatch = (event: ComposerSubmitEvent) => {
    const result = transitionComposerSubmit(state(), event)
    setState(result.state)
    result.effects.forEach(run)
  }

  const run = (effect: ComposerSubmitEffect) => {
    if (effect.type === "done") return effect.done(effect.sent)

    if (effect.type === "notify.missing-selection") return input.notify.missingSelection()

    if (effect.type === "notify.unqueueable") return input.notify.unqueueable()

    if (effect.type === "interrupt") {
      if (input.adapter.kind === "active-session") void input.adapter.interrupt()

      return
    }

    if (effect.type === "submit.retry")
      return dispatch({ type: "submit", snapshot: snapshot(input, effect.alternate), done: effect.done })

    if (effect.type === "hold.show") {
      input.adapter.beforeSubmit?.()
      effect.session.handoff.hold({
        message: handoffMessage({
          id: effect.snapshot.id,
          prompt: effect.snapshot.draft.prompt,
          context: effect.snapshot.draft.context,
          images: effect.snapshot.draft.prompt.filter((part): part is ImageAttachmentPart => part.type === "image"),
        }),
      })
      input.addToHistory(effect.snapshot.draft.prompt, effect.snapshot.mode)
      input.resetHistory()

      return dispatch({
        type: "hold.cleared",
        attempt: effect.attempt,
        cleared: clearComposer(input, effect.snapshot.draft, "prompt").cleared,
      })
    }

    if (effect.type === "hold.cancel") {
      effect.session.handoff.clear(effect.snapshot.id)

      if (!effect.cleared) return
      restoreDraft(
        input,
        { draft: effect.snapshot.draft, mode: effect.snapshot.mode, comments: effect.snapshot.comments },
        afterHold(effect.snapshot.draft, effect.cleared),
      )

      return
    }

    if (effect.type === "command.run") {
      input.adapter.beforeSubmit?.()
      void runClientCommand(input, effect.prompt, effect.run).then(
        () => dispatch({ type: "run.settled", attempt: effect.attempt, sent: true }),
        (error) => {
          input.notify.failed("command", error)
          dispatch({ type: "run.settled", attempt: effect.attempt, sent: false })
        },
      )

      return
    }

    if (effect.type === "quote.send") {
      input.adapter.beforeSubmit?.()
      const target = input.adapter.state

      void dispatchPrompt(input, effect.session, effect.value)
        .settled(() => {
          target.context.updateComment(effect.quote.commentID, { comment: effect.comment })

          return true
        })
        .then((sent) => {
          if (sent) {
            target.context.remove(effect.key)

            if (target.quoteComment.key() === effect.key) target.quoteComment.set()
            input.adapter.submitted()
          }

          dispatch({ type: "run.settled", attempt: effect.attempt, sent })
        })

      return
    }

    if (effect.type === "session.start") {
      input.adapter.beforeSubmit?.()
      void startSession(input, effect.value, {
        target: () => composerSubmitTarget(state(), effect.attempt) ?? effect.target,
        retarget: (target, options) =>
          dispatch({
            type: "session.retargeted",
            attempt: effect.attempt,
            target,
            preserveDraft: options?.preserveDraft ?? false,
          }),
      }).then(
        (started) =>
          dispatch(
            started
              ? {
                  type: "session.started",
                  attempt: effect.attempt,
                  images: started.images,
                  session: started.session,
                  ready: started.cleanupReady,
                  complete: started.complete,
                }
              : { type: "submit.aborted", attempt: effect.attempt },
          ),
        (error) => {
          dispatch({ type: "submit.aborted", attempt: effect.attempt })
          throw error
        },
      )

      return
    }

    if (effect.type === "draft.retarget") {
      effect.context.forEach((item) => effect.target.context.add(item))
      effect.sources.forEach((item) => effect.target.quoteSource.add(item.key, item.source))

      return
    }

    if (effect.type === "history.record") {
      input.addToHistory(effect.prompt, effect.mode)
      input.resetHistory()

      return
    }

    if (effect.type === "handoff") {
      const prompt = effect.sendFirst ? dispatchPrompt(input, effect.session, effect.value) : undefined

      void effect.ready
        .then(() => effect.complete?.())
        .then(
          () => dispatch({ type: "handoff.ready", attempt: effect.attempt, prompt }),
          (error) => {
            dispatch({ type: "submit.aborted", attempt: effect.attempt })
            throw error
          },
        )

      return
    }

    clearSubmission(input, effect)
  }

  // A held send goes through once the Location's agents and models load. One still in the composer ends if the draft
  // changes first; a shown one already left it.
  createEffect(() => {
    const current = state()

    if (current.type !== "held") return

    if (!current.shown && JSON.stringify(input.adapter.state.current()) !== current.snapshot.serialized)
      return untrack(() => dispatch({ type: "hold.changed", attempt: current.attempt }))

    if (!input.adapter.controls().model.loading)
      untrack(() =>
        dispatch({
          type: "hold.loaded",
          attempt: current.attempt,
          selection: currentSelection(input),
          commands: input.commands(),
        }),
      )
  })

  onCleanup(() => dispatch({ type: "unmounted" }))

  return {
    state,
    submit(event: globalThis.Event, options?: { alternate?: boolean }) {
      event.preventDefault()

      return new Promise<void>((resolve) =>
        dispatch({ type: "submit", snapshot: snapshot(input, options?.alternate ?? false), done: () => resolve() }),
      )
    },
    submitQuote(key: string, comment: string) {
      const adapter = input.adapter

      if (adapter.kind !== "active-session") return Promise.resolve(false)
      const quote = adapter.state.context.items().find((item) => item.key === key)

      return new Promise<boolean>((resolve) =>
        dispatch({
          type: "quote",
          snapshot: {
            key,
            quote: quote?.type === "quote" ? quote : undefined,
            comment,
            selection: currentSelection(input),
            delivery: input.delivery?.(true) ?? "steer",
            id: SessionMessage.ID.create(),
            session: adapter.session(),
          },
          done: resolve,
        }),
      )
    },
    stop() {
      dispatch({ type: "stop" })

      return Promise.resolve()
    },
  }
}

function snapshot(input: ComposerSubmitInput, alternate: boolean): SubmitSnapshot {
  const target = input.adapter.state
  const prompt = clonePrompt(target.current())
  const text = submissionText(prompt)
  const mode = input.mode()

  const context = target.context.items().map((item) => {
    if (item.type === "note") return { ...item, live: item.live ? { ...item.live } : undefined }

    if (item.type === "quote") return { ...item, source: item.source ? { ...item.source } : undefined }

    return { ...item, selection: item.selection ? { ...item.selection } : undefined }
  })

  return {
    draft: {
      initial: target,
      target,
      preserveDraft: false,
      prompt,
      context,
      sources: context.flatMap((item) => {
        const source = target.quoteSource.state.sources[item.key]

        return source ? [{ key: item.key, source }] : []
      }),
    },
    serialized: JSON.stringify(target.current()),
    text,
    mode,
    alternate,
    delivery: input.delivery?.(alternate) ?? "steer",
    selection: currentSelection(input),
    loading: input.adapter.controls().model.loading,
    retry: target.retry.current(),
    id: SessionMessage.ID.create(),
    commands: input.commands(),
    clientCommand: mode === "normal" ? input.clientCommand?.(text) : undefined,
    comments: input.comments.capture(),
    session: input.adapter.kind === "active-session" ? input.adapter.session() : undefined,
  }
}

async function runClientCommand(input: ComposerSubmitInput, prompt: Prompt, run: () => void | Promise<void>) {
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
  await run()
}

async function startSession(
  input: ComposerSubmitInput,
  submission: ComposerSubmission,
  handle: ComposerSubmissionHandle,
) {
  // Images restored from a draft or history carry ids only; the optimistic message shows their URLs.
  const images = await Promise.all(
    submission.images.map(async (image) => ({
      ...image,
      blob: { ...image.blob, url: (await resolveBlobUrl(image.blob).catch(() => undefined)) ?? image.blob.url },
    })),
  )

  if (input.adapter.kind === "active-session")
    return { images, session: input.adapter.session(), cleanupReady: Promise.resolve(), complete: undefined }
  const started = await input.adapter.start(submission.selection, handle, handoffMessage({ ...submission, images }))

  return started && { ...started, images }
}

// The composer clears its captured draft once the Session's composer is ready; then the send settles. A shown hold
// cleared it already, and the composer may hold a new draft since.
function clearSubmission(
  input: ComposerSubmitInput,
  effect: Extract<ComposerSubmitEffect, { type: "composer.clear" }>,
) {
  const held = effect.cleared
  const clear = held ? undefined : clearComposer(input, effect.draft, effect.kind.type)

  // A held prompt cleared the composer at Enter, so what it goes back to is read only once the send fails.
  const restore = () => {
    const back = clear ?? (held && afterHold(effect.draft, held))

    return !!back && restoreSubmission(input, effect, back)
  }

  if (effect.prompt) return void effect.prompt.settled(restore)

  if (effect.kind.type === "shell")
    return void sendShell(effect.session, effect.value).catch((error) =>
      failSubmission(input, effect.session, "shell", error, restore),
    )

  if (effect.kind.type === "command")
    void sendCommand(
      effect.session,
      effect.value,
      effect.kind.command,
      input.adapter.controls().model.selection.trackSessionCommit,
    ).catch((error) => failSubmission(input, effect.session, "command", error, restore, effect.value.id))
}

// Returns the cleared composer, which a failed send restores only while it is unchanged, and any follow-up already
// typed into a promoted new-session composer.
function clearComposer(input: ComposerSubmitInput, draft: CapturedDraft, kind: SubmissionKind["type"]) {
  const target = draft.target
  input.adapter.submitted()

  if (kind === "prompt") {
    // Like the TUI, sent context goes with the prompt rather than riding along on the next one.
    draft.context.forEach((item) => target.context.remove(item.key))
    input.comments.clear()
  }

  if (draft.initial !== target) draft.initial.reset()

  // A preparing session may already have an unsent follow-up in its promoted composer.
  const following =
    draft.initial !== target &&
    draft.preserveDraft &&
    target.current().some((part) => isAttachment(part) || part.content.length > 0)
      ? clonePrompt(target.current())
      : undefined

  if (!following) target.reset()
  const cleared = target.current()
  // The ID went with this send; a failure arms it again for this payload when it restores the draft.
  target.retry.clear()
  target.mode.set("normal")
  input.closePopover()

  if (window.matchMedia("(max-width: 767px)").matches) input.editor()?.blur()

  return { cleared, following, edited: !!following } satisfies ClearedComposer
}

// A held prompt left the composer before it was sent, so a draft typed since follows it back rather than keeping it out.
function afterHold(draft: CapturedDraft, cleared: Prompt): ClearedComposer {
  const current = draft.target.current()
  const edited = current !== cleared
  const typed = edited && current.some((part) => isAttachment(part) || part.content.length > 0)

  return { cleared: current, following: typed ? clonePrompt(current) : undefined, edited }
}

function clearClientCommand(input: ComposerSubmitInput, prompt: Prompt) {
  input.adapter.state.set([{ type: "text", content: "", start: 0, end: 0 }, ...prompt.filter(isAttachment)], 0)
  input.adapter.state.mode.set("normal")
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

// A held prompt has no agent or model until its Location's catalog loads.
function handoffMessage(
  value: Pick<ComposerSubmission, "id" | "prompt" | "context" | "images"> & { selection?: ComposerSelection },
): SessionMessageUser {
  const text = submissionText(serializePrompt(value.prompt))

  return {
    id: value.id,
    type: "user",
    text,
    files: value.images.map((image) => ({
      data: "",
      mime: image.mime,
      source: { type: "uri", uri: image.blob.url },
      name: image.sourcePath ?? image.filename,
    })),
    metadata: {
      displayText: text,
      attachments: value.prompt.flatMap((part) =>
        part.type === "path" ? [{ name: part.filename, mime: part.mime, path: part.path }] : [],
      ),
      comments: value.context.flatMap((item): PromptComment[] => {
        if (item.type === "quote") return [quoteComment(item)]

        if (item.type === "note") return [noteComment(item, item.comment.trim())]
        const comment = item.comment?.trim()

        if (!comment) return []

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
      ...(value.selection && { agent: value.selection.agent, model: selectionModel(value.selection) }),
    },
    time: { created: Date.now() },
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

function dispatchPrompt(input: ComposerSubmitInput, session: ComposerSession, value: ComposerSubmission): PromptSend {
  // A steer appears in the timeline before the composer clears; queued prompts appear in the queue on admission.
  if (value.delivery === "steer")
    session.handoff.set({
      message: handoffMessage(value),
      selection: {
        agent: value.selection.agent,
        model: {
          id: value.selection.model.modelID,
          providerID: value.selection.model.providerID,
          variant: value.selection.variant,
        },
      },
    })
  const working = input.adapter.working()

  const background = value.delivery === "steer" && working ? session.background?.() : undefined

  updateStatus(session, { type: "dispatched", id: value.id, working })

  const sending = sendPrompt(session, value, input.adapter.controls().model.selection.trackSessionCommit).then(
    () => ({ ok: true as const }),
    (error) => ({ ok: false as const, error }),
  )

  // Settled here rather than when the composer settles, which an aborted promotion never reaches.
  void sending.then((result) => {
    const admitted = result.ok || session.admitted(value.id)
    updateStatus(session, admitted ? { type: "admitted" } : { type: "failed", id: value.id })

    if (value.delivery !== "steer") return

    if (admitted) return session.handoff.settle(value.id)
    session.handoff.clear(value.id)
  })

  return {
    // The composer settles after clearing its captured draft; a quote settles before removing only its context.
    settled: (restore) =>
      sending.then((result) => {
        const admitted = result.ok || failSubmission(input, session, "prompt", result.error, restore, value.id)

        if (!admitted) return false

        // Move blocking work only once the steer is admitted, so the next step can read it from the inbox.
        void background?.move()

        return true
      }),
  }
}

function updateStatus(session: ComposerSession, event: PromptStatusEvent) {
  const result = transitionPromptStatus(statuses.get(session.id) ?? SERVER_PROMPT_STATUS, event)

  if (result.state.type === "server") statuses.delete(session.id)

  if (result.state.type === "optimistic") statuses.set(session.id, result.state)
  result.effects.forEach((effect) => session.data.session.setStatus(session.id, effect.status))
}

/**
 * The composer a restore goes back to: the prompt it was cleared to, a follow-up typed into it since, and whether it
 * was edited since, which keeps the comments added meanwhile.
 */
type ClearedComposer = { cleared: Prompt; following: Prompt | undefined; edited: boolean }

// Puts a failed submission back, unless the composer changed since it cleared: then the edit is the user's.
function restoreSubmission(
  input: ComposerSubmitInput,
  submission: {
    draft: CapturedDraft
    value: ComposerSubmission
    kind: SubmissionKind
    comments: PromptHistoryComment[]
  },
  back: ClearedComposer,
) {
  const value = submission.value

  if (!restoreDraft(input, { ...submission, mode: value.mode }, back)) return false

  // Only a prompt was admitted under its ID. A recovered follow-up changes the payload, so it needs a new one.
  if (submission.kind.type === "prompt" && !back.following)
    submission.draft.target.retry.set({ id: value.id, fingerprint: retryFingerprint(value) })

  return true
}

// Puts a cleared draft back, unless the composer changed since it cleared: then the edit is the user's.
function restoreDraft(
  input: ComposerSubmitInput,
  submission: { draft: CapturedDraft; mode: "normal" | "shell"; comments: PromptHistoryComment[] },
  back: ClearedComposer,
) {
  const target = submission.draft.target
  const following = back.following

  if (target.current() !== back.cleared) return false
  const kept = back.edited ? input.comments.capture() : []
  const prompt = following ? appendPrompt(submission.draft.prompt, following) : submission.draft.prompt
  // The prompt is back in the composer; its history entry would only keep attachments referenced.
  input.removeFromHistory(submission.draft.prompt, submission.mode, submission.comments)
  target.set(prompt, promptLength(prompt))
  target.mode.set(submission.mode)
  const sent = new Set(submission.draft.context.map((item) => item.key))

  // In the order it was sent: an unedited resend must send the same request, which the retry ID's fingerprint names.
  // Files listed since the send stay after it. Comments the draft gained since are replaced, as before, unless they
  // were added to a draft typed since, which keeps them.
  target.context.replace([
    ...submission.draft.context.map((item): ContextItem => {
      if (item.type === "quote")
        return {
          type: "quote",
          text: item.text,
          comment: item.comment,
          source: item.source ? { ...item.source } : undefined,
          commentID: item.commentID,
        }

      if (item.type === "note")
        return {
          type: "note",
          origin: item.origin,
          label: item.label,
          title: item.title,
          subtitle: item.subtitle,
          icon: item.icon,
          subject: item.subject,
          href: item.href,
          live: item.live,
          comment: item.comment,
          commentID: item.commentID,
        }

      return {
        type: "file",
        path: item.path,
        selection: item.selection,
        comment: item.comment,
        commentID: item.commentID,
        commentOrigin: item.commentOrigin,
        preview: item.preview,
        name: item.name,
        description: item.description,
      }
    }),
    ...target.context.items().filter((item) => (back.edited || !isCommentItem(item)) && !sent.has(item.key)),
  ])
  submission.draft.sources.forEach((item) => target.quoteSource.add(item.key, item.source))

  if (target !== input.adapter.state) return true

  input.comments.restore([
    ...submission.comments,
    ...kept.filter((item) => !submission.comments.some((comment) => comment.id === item.id)),
  ])
  input.closePopover()
  requestAnimationFrame(() => {
    const editor = input.editor()

    if (!editor) return
    editor.focus()
    setCursorPosition(editor, promptLength(submission.draft.prompt))
    input.queueScroll()
  })

  return true
}

async function sendShell(session: ComposerSession, value: ComposerSubmission) {
  await session.api.shell({ sessionID: session.id, id: value.id, command: value.text })
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

    // Skip an unchanged model so a send never waits on that request. An agent switch or a revert can move the
    // model, and cached SSE state may lag this client's earlier switch, which must also match.
    const model = `${selection.model.providerID}/${selection.model.modelID}/${selection.variant ?? ""}`
    const saved = current?.model && `${current.model.providerID}/${current.model.id}/${current.model.variant ?? ""}`

    if (
      current?.agent === selection.agent &&
      !current.revert &&
      saved === model &&
      (switched.get(session.id) ?? model) === model
    )
      return
    await session.api.switchModel({
      sessionID: session.id,
      model: { id: selection.model.modelID, providerID: selection.model.providerID, variant: selection.variant },
    })
    switched.set(session.id, model)
  } catch (error) {
    cancel?.()
    throw error
  }
}

async function sendPrompt(
  session: ComposerSession,
  value: ComposerSubmission,
  track: ModelSelection["trackSessionCommit"] | undefined,
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

  const commit = () => (value.delivery === "steer" ? applySelection(session, value.selection, track, settle) : settle())
  // The data layer admits the prompt locally before it commits the selection, so a steer shows as pending while the
  // selection commits. A staged revert settles before admission instead: its committed echo removes every local row
  // from its boundary on. Only an idle session stages one, and a prompt into it starts work rather than showing as
  // pending.
  const staged = !!session.current()?.revert

  if (staged) await commit()
  // A retried admission reuses the first commit rather than switching again.
  let committed: Promise<void> | undefined

  const admission = {
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
    prepare: staged ? undefined : () => (committed ??= commit()),
  }

  await session.data.session.prompt(admission).catch(() => session.data.session.prompt(admission))
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
) {
  if (messageID && session.admitted(messageID)) return true
  restore()
  input.notify.failed(kind, error)

  return false
}
