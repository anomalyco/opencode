import type { SessionMessage } from "@opencode/schema/session-message"
import type { ComposerDelivery, ComposerSelection, ComposerSession } from "./adapter"
import { parseSlashCommand } from "./client-slash-command"
import type { PromptHistoryComment } from "./history/entry"
import { isAttachment } from "./prompt-parts"
import type { QuoteSource } from "./quote-source"
import { claimRetry, type ComposerRetry } from "./retry"
import { isCommentItem, type ComposerStore, type ImageAttachmentPart, type Prompt } from "./state"
import type { ComposerStateTarget } from "./submission-state"

export type ComposerSubmission = {
  id: SessionMessage.ID
  mode: "normal" | "shell"
  prompt: Prompt
  context: ComposerStore["context"]["items"]
  text: string
  images: ImageAttachmentPart[]
  selection: ComposerSelection
  delivery: ComposerDelivery
  first?: boolean
}

type QuoteItem = Extract<ComposerSubmission["context"][number], { type: "quote" }>

/** What a submission sends. A prompt is in flight before the composer clears; shell and commands start after. */
export type SubmissionKind =
  | { type: "prompt" }
  | { type: "shell" }
  | { type: "command"; command: { command: string; arguments: string } }

/** The draft a submission took from the composer, and the composer that now owns it. */
export type CapturedDraft = {
  initial: ComposerStateTarget
  /** Differs from `initial` once a new Session promotes the draft into its own composer. */
  target: ComposerStateTarget
  /** Whether the promoted composer may already hold a follow-up typed while the Session prepared. */
  preserveDraft: boolean
  prompt: Prompt
  context: ComposerSubmission["context"]
  sources: { key: string; source: QuoteSource }[]
}

/** A prompt sent before the composer cleared; `settled` restores the draft through `restore` when it fails. */
export type PromptSend = { settled: (restore: () => boolean) => Promise<boolean> }

/** Settles the caller of `submit` or `submitQuote`; `sent` is false when nothing was sent. */
export type SubmitDone = (sent: boolean) => void

/** A held prompt that already shows in its Session's timeline; `cleared` is the composer it left, once cleared. */
export type ShownHold = { session: ComposerSession; cleared: Prompt | undefined }

export type ComposerSubmitState =
  | { type: "idle"; attempt: number }
  // A send pressed while a cold Location loads its agents and models; it goes through once they load. A prompt to a
  // Session shows in its timeline at once and leaves the composer (`shown`); any other send waits in the composer,
  // where an edit cancels it.
  | { type: "held"; attempt: number; snapshot: SubmitSnapshot; shown: ShownHold | undefined; done: SubmitDone }
  // A client command or a quote runs; neither takes the draft, but the composer submits nothing else meanwhile.
  | { type: "running"; attempt: number; done: SubmitDone }
  // Image attachments resolve and, for a new Session, the Session starts. Nothing is sent yet. `cleared` is the
  // composer a shown hold already cleared.
  | {
      type: "preparing"
      attempt: number
      draft: CapturedDraft
      value: ComposerSubmission
      kind: SubmissionKind
      comments: PromptHistoryComment[]
      cleared: Prompt | undefined
      done: SubmitDone
    }
  // The Session exists and a prompt is in flight; the draft stays until the Session's composer is ready to clear.
  | {
      type: "handing-off"
      attempt: number
      draft: CapturedDraft
      value: ComposerSubmission
      kind: SubmissionKind
      comments: PromptHistoryComment[]
      cleared: Prompt | undefined
      session: ComposerSession
      done: SubmitDone
    }

export type SubmitSnapshot = {
  draft: CapturedDraft
  /** The composer's prompt as JSON, to notice an edit while the send is held. */
  serialized: string
  text: string
  mode: "normal" | "shell"
  alternate: boolean
  first?: boolean
  delivery: ComposerDelivery
  selection: ComposerSelection | undefined
  loading: boolean
  retry: ComposerRetry | undefined
  id: SessionMessage.ID
  commands: readonly { name: string }[] | undefined
  clientCommand: (() => void | Promise<void>) | undefined
  comments: PromptHistoryComment[]
  /** The active Session, whose timeline can show a held prompt; a new-session draft has none yet. */
  session: ComposerSession | undefined
}

export type QuoteSnapshot = {
  key: string
  quote: QuoteItem | undefined
  comment: string
  selection: ComposerSelection | undefined
  delivery: ComposerDelivery
  id: SessionMessage.ID
  session: ComposerSession
}

export type ComposerSubmitEvent =
  | { type: "submit"; snapshot: SubmitSnapshot; done: SubmitDone }
  | { type: "quote"; snapshot: QuoteSnapshot; done: SubmitDone }
  | { type: "stop" }
  | { type: "unmounted" }
  | { type: "hold.changed"; attempt: number }
  | { type: "hold.cleared"; attempt: number; cleared: Prompt }
  /** The Location's agents and models loaded; `selection` is what the composer resolved from them. */
  | {
      type: "hold.loaded"
      attempt: number
      selection: ComposerSelection | undefined
      commands: readonly { name: string }[] | undefined
    }
  | { type: "run.settled"; attempt: number; sent: boolean }
  | {
      type: "session.started"
      attempt: number
      images: ImageAttachmentPart[]
      session: ComposerSession
      ready: Promise<void>
      complete?: () => Promise<void>
    }
  | { type: "session.retargeted"; attempt: number; target: ComposerStateTarget; preserveDraft: boolean }
  | { type: "submit.aborted"; attempt: number }
  | { type: "handoff.ready"; attempt: number; prompt: PromptSend | undefined }

export type ComposerSubmitEffect =
  | { type: "done"; done: SubmitDone; sent: boolean }
  | { type: "notify.missing-selection" }
  | { type: "notify.unqueueable" }
  | { type: "interrupt" }
  | { type: "submit.retry"; alternate: boolean; first?: boolean; done: SubmitDone }
  /** Shows a held prompt in its Session's timeline and clears the composer it came from. */
  | { type: "hold.show"; attempt: number; session: ComposerSession; snapshot: SubmitSnapshot }
  /** Removes a cancelled held prompt from the timeline and returns it to the composer it left. */
  | { type: "hold.cancel"; session: ComposerSession; snapshot: SubmitSnapshot; cleared: Prompt | undefined }
  | { type: "command.run"; attempt: number; prompt: Prompt; run: () => void | Promise<void> }
  | {
      type: "quote.send"
      attempt: number
      key: string
      quote: QuoteItem
      comment: string
      session: ComposerSession
      value: ComposerSubmission
    }
  | { type: "session.start"; attempt: number; target: ComposerStateTarget; value: ComposerSubmission }
  | {
      type: "draft.retarget"
      target: ComposerStateTarget
      context: ComposerSubmission["context"]
      sources: CapturedDraft["sources"]
    }
  | { type: "history.record"; prompt: Prompt; mode: "normal" | "shell" }
  | {
      type: "handoff"
      attempt: number
      session: ComposerSession
      value: ComposerSubmission
      /** A prompt shows in the Session as soon as it starts, before the composer clears. */
      sendFirst: boolean
      ready: Promise<void>
      complete?: () => Promise<void>
    }
  | {
      type: "composer.clear"
      draft: CapturedDraft
      value: ComposerSubmission
      kind: SubmissionKind
      comments: PromptHistoryComment[]
      session: ComposerSession
      prompt: PromptSend | undefined
      /** Set when a shown hold already cleared the composer, which may hold a new draft by now. */
      cleared: Prompt | undefined
    }

export type ComposerSubmitTransition = { state: ComposerSubmitState; effects: ComposerSubmitEffect[] }

export function createComposerSubmitState(): ComposerSubmitState {
  return { type: "idle", attempt: 0 }
}

export function transitionComposerSubmit(
  state: ComposerSubmitState,
  event: ComposerSubmitEvent,
): ComposerSubmitTransition {
  if (event.type === "submit") return submit(state, event.snapshot, event.done)

  if (event.type === "quote") return quote(state, event.snapshot, event.done)

  // Stopping a held send cancels it and leaves the prompt in the composer.
  if (event.type === "stop")
    return state.type === "held" ? cancelHold(state, []) : { state, effects: [{ type: "interrupt" }] }

  // A promoted new-session composer unmounts while its first prompt hands off, so only a held send ends here.
  if (event.type === "unmounted") return state.type === "held" ? cancelHold(state, []) : unchanged(state)

  // Only a prompt still in the composer cancels on an edit; a shown one left it, so the composer holds a new draft.
  if (event.type === "hold.changed")
    return current(state, "held", event.attempt) && !state.shown ? settle(state, false, []) : unchanged(state)

  if (event.type === "hold.cleared") {
    if (!current(state, "held", event.attempt) || !state.shown) return unchanged(state)

    return { state: { ...state, shown: { ...state.shown, cleared: event.cleared } }, effects: [] }
  }

  if (event.type === "hold.loaded") {
    if (!current(state, "held", event.attempt)) return unchanged(state)

    if (!state.shown)
      return {
        state: { type: "idle", attempt: state.attempt },
        effects: [
          {
            type: "submit.retry",
            alternate: state.snapshot.alternate,
            first: state.snapshot.first,
            done: state.done,
          },
        ],
      }

    // The composer already cleared, so the send goes on from what was captured at Enter.
    if (!event.selection) return cancelHold(state, [{ type: "notify.missing-selection" }])

    return prepare(
      state.attempt,
      { ...state.snapshot, selection: event.selection, commands: event.commands, loading: false },
      event.selection,
      state.done,
      state.shown.cleared,
    )
  }

  if (event.type === "run.settled") {
    if (!current(state, "running", event.attempt)) return unchanged(state)

    return settle(state, event.sent, [])
  }

  if (event.type === "session.started") {
    if (!current(state, "preparing", event.attempt)) return unchanged(state)
    const value = { ...state.value, images: event.images }

    return {
      state: { ...state, type: "handing-off", value, session: event.session },
      effects: [
        // A shown hold recorded it when it left the composer.
        ...(state.cleared ? [] : [{ type: "history.record" as const, prompt: value.prompt, mode: value.mode }]),
        {
          type: "handoff",
          attempt: state.attempt,
          session: event.session,
          value,
          sendFirst: state.kind.type === "prompt",
          ready: event.ready,
          complete: event.complete,
        },
      ],
    }
  }

  if (event.type === "session.retargeted") {
    if (!current(state, "preparing", event.attempt) && !current(state, "handing-off", event.attempt))
      return unchanged(state)

    return {
      state: { ...state, draft: { ...state.draft, target: event.target, preserveDraft: event.preserveDraft } },
      effects: [
        { type: "draft.retarget", target: event.target, context: state.draft.context, sources: state.draft.sources },
      ],
    }
  }

  if (event.type === "submit.aborted") {
    if (!current(state, "preparing", event.attempt) && !current(state, "handing-off", event.attempt))
      return unchanged(state)

    return settle(state, false, [])
  }

  if (!current(state, "handing-off", event.attempt)) return unchanged(state)

  return settle(state, true, [
    {
      type: "composer.clear",
      draft: state.draft,
      value: state.value,
      kind: state.kind,
      comments: state.comments,
      session: state.session,
      prompt: event.prompt,
      cleared: state.cleared,
    },
  ])
}

export function composerSubmitView(state: ComposerSubmitState) {
  return {
    held: state.type === "held",
    busy: state.type === "held" || state.type === "preparing" || state.type === "handing-off",
    canSubmit: state.type === "idle",
  }
}

/** The composer that owns the draft of `attempt`, which moves when a new Session promotes it. */
export function composerSubmitTarget(state: ComposerSubmitState, attempt: number) {
  if (current(state, "preparing", attempt) || current(state, "handing-off", attempt)) return state.draft.target
}

function submit(state: ComposerSubmitState, snapshot: SubmitSnapshot, done: SubmitDone): ComposerSubmitTransition {
  if (state.type !== "idle") return { state, effects: [{ type: "done", done, sent: false }] }
  const attempt = state.attempt + 1

  if (snapshot.mode === "normal" && snapshot.clientCommand)
    return {
      state: { type: "running", attempt, done },
      effects: [{ type: "command.run", attempt, prompt: snapshot.draft.prompt, run: snapshot.clientCommand }],
    }

  // Like the TUI, a blank Enter never interrupts; only Stop, Escape and Ctrl+G do.
  if (blank(snapshot)) return { state, effects: [{ type: "done", done, sent: false }] }

  if (!snapshot.selection) {
    // A cold Location lists its agents and models only after its plugins activate, so hold the send until then.
    if (snapshot.loading) {
      // A prompt that steers a Session shows in its timeline at once, like any sent prompt. A slash command, a shell
      // command or a queued prompt has no timeline row before the server takes it, so it waits in the composer.
      const session = snapshot.session && showsWhileHeld(snapshot) ? snapshot.session : undefined

      return {
        state: { type: "held", attempt, snapshot, shown: session && { session, cleared: undefined }, done },
        effects: session ? [{ type: "hold.show", attempt, session, snapshot }] : [],
      }
    }

    return { state, effects: [{ type: "notify.missing-selection" }, { type: "done", done, sent: false }] }
  }

  // Like the TUI, a shell command runs now or not at all; it cannot wait in the queue.
  if (snapshot.mode === "shell" && snapshot.delivery === "queue")
    return { state, effects: [{ type: "notify.unqueueable" }, { type: "done", done, sent: false }] }

  return prepare(attempt, snapshot, snapshot.selection, done, undefined)
}

function prepare(
  attempt: number,
  snapshot: SubmitSnapshot,
  selection: ComposerSelection,
  done: SubmitDone,
  cleared: Prompt | undefined,
): ComposerSubmitTransition {
  // Capture command intent before starting a session in a worktree whose catalog has not loaded.
  const command = snapshot.mode === "normal" ? findCommand(snapshot.commands, snapshot.text) : undefined

  const kind: SubmissionKind =
    snapshot.mode === "shell" ? { type: "shell" } : command ? { type: "command", command } : { type: "prompt" }

  const payload = {
    mode: snapshot.mode,
    prompt: snapshot.draft.prompt,
    context: snapshot.draft.context,
    text: snapshot.text,
    images: snapshot.draft.prompt.filter((part): part is ImageAttachmentPart => part.type === "image"),
    selection,
    delivery: snapshot.delivery,
    first: snapshot.first,
  }

  // Only a prompt is admitted under its ID; shell commands and server commands always start fresh.
  const value: ComposerSubmission = {
    ...payload,
    id: kind.type === "prompt" ? claimRetry(snapshot.retry, payload, snapshot.id) : snapshot.id,
  }

  return {
    state: {
      type: "preparing",
      attempt,
      draft: snapshot.draft,
      value,
      kind,
      comments: snapshot.comments,
      cleared,
      done,
    },
    effects: [{ type: "session.start", attempt, target: snapshot.draft.target, value }],
  }
}

function showsWhileHeld(snapshot: SubmitSnapshot) {
  return snapshot.mode === "normal" && snapshot.delivery === "steer" && !parseSlashCommand(snapshot.text)
}

// A shown hold returns its prompt to the composer it left and removes it from the timeline.
function cancelHold(state: Extract<ComposerSubmitState, { type: "held" }>, effects: ComposerSubmitEffect[]) {
  if (!state.shown) return settle(state, false, effects)

  return settle(state, false, [
    ...effects,
    { type: "hold.cancel", session: state.shown.session, snapshot: state.snapshot, cleared: state.shown.cleared },
  ])
}

function quote(state: ComposerSubmitState, snapshot: QuoteSnapshot, done: SubmitDone): ComposerSubmitTransition {
  if (state.type !== "idle" || !snapshot.quote) return { state, effects: [{ type: "done", done, sent: false }] }

  if (!snapshot.selection)
    return { state, effects: [{ type: "notify.missing-selection" }, { type: "done", done, sent: false }] }
  const attempt = state.attempt + 1

  return {
    state: { type: "running", attempt, done },
    effects: [
      {
        type: "quote.send",
        attempt,
        key: snapshot.key,
        quote: snapshot.quote,
        comment: snapshot.comment,
        session: snapshot.session,
        value: {
          id: snapshot.id,
          mode: "normal",
          prompt: [],
          context: [
            {
              ...snapshot.quote,
              comment: snapshot.comment,
              source: snapshot.quote.source ? { ...snapshot.quote.source } : undefined,
            },
          ],
          text: "",
          images: [],
          selection: snapshot.selection,
          delivery: snapshot.delivery,
        },
      },
    ],
  }
}

function blank(snapshot: SubmitSnapshot) {
  if (snapshot.text.trim()) return false

  // A shell command needs text. Like the TUI's blank Enter, file chips alone send nothing; they wait for text.
  return (
    snapshot.mode === "shell" ||
    (!snapshot.draft.prompt.some(isAttachment) && !snapshot.draft.context.some(isCommentItem))
  )
}

function findCommand(commands: SubmitSnapshot["commands"], text: string) {
  const parsed = parseSlashCommand(text)

  if (!parsed || !commands?.some((item) => item.name === parsed.name)) return

  return { command: parsed.name, arguments: parsed.input }
}

function current<T extends ComposerSubmitState["type"]>(
  state: ComposerSubmitState,
  type: T,
  attempt: number,
): state is Extract<ComposerSubmitState, { type: T }> {
  return state.type === type && state.attempt === attempt
}

function settle(
  state: Exclude<ComposerSubmitState, { type: "idle" }>,
  sent: boolean,
  effects: ComposerSubmitEffect[],
): ComposerSubmitTransition {
  return {
    state: { type: "idle", attempt: state.attempt },
    effects: [...effects, { type: "done", done: state.done, sent }],
  }
}

function unchanged(state: ComposerSubmitState): ComposerSubmitTransition {
  return { state, effects: [] }
}
