import type { SshConfig, SshError, SshItem, SshPrompt } from "./contract"

/** Why the dialog opened: to add a server, to connect a known one, or only to show an attempt's prompts. */
export type SshDialogMode = "add" | "connect" | "prompt"

/** A prompt the dialog shows and what the user typed for it; the next prompt starts empty. */
export type SshDialogChallenge = {
  readonly prompt: SshPrompt
  readonly response: string
}

/** What this window's SSH machine and main's state show for the dialog's server. */
export type SshDialogSnapshot = {
  readonly item: SshItem | undefined
  /** A call to main for the attempt is in flight. */
  readonly submitting: boolean
  /** The attempt failed, or its last answer did not reach main. */
  readonly error: boolean
  /** The prompt this window answers now, or answered last in the attempt. */
  readonly answeredPrompt: string | undefined
  /** This window runs an attempt for the server that has not failed. */
  readonly activeAttempt: boolean
}

type SshDialogFields = {
  readonly id: string
  readonly mode: SshDialogMode
  readonly target: string
  readonly name: string
}

/**
 * `idle` shows the form. `active` follows the attempt the dialog started, or in prompt mode the one it opened for;
 * `prompted` records that the attempt showed a prompt. `completed` closes the dialog on a ready server, and `closed`
 * is a dialog that went away.
 */
export type SshDialogState =
  | (SshDialogFields & { readonly status: "idle" })
  | (SshDialogFields & {
      readonly status: "active"
      readonly prompted: boolean
      readonly challenge?: SshDialogChallenge
    })
  | (SshDialogFields & {
      readonly status: "completed"
      readonly prompted: boolean
      readonly challenge?: SshDialogChallenge
    })
  | (SshDialogFields & { readonly status: "closed" })

export type SshDialogEvent =
  | { readonly type: "target.changed"; readonly value: string }
  | { readonly type: "name.changed"; readonly value: string }
  | { readonly type: "response.changed"; readonly prompt: string; readonly value: string }
  | { readonly type: "submitted"; readonly snapshot: SshDialogSnapshot }
  | { readonly type: "responded"; readonly snapshot: SshDialogSnapshot }
  | { readonly type: "synced"; readonly snapshot: SshDialogSnapshot }
  | { readonly type: "disposed" }

export type SshDialogEffect =
  | { readonly type: "connect"; readonly config: SshConfig; readonly replace: boolean }
  | { readonly type: "respond"; readonly prompt: string; readonly value: string }
  | { readonly type: "cancel" }
  | { readonly type: "complete" }

export type SshDialogTransition = {
  readonly state: SshDialogState
  readonly effects: readonly SshDialogEffect[]
}

export type SshDialogErrorKey = "common.requestFailed" | `error.${SshError}`

export type SshDialogView = {
  readonly title: "add" | "connectTo"
  readonly showForm: boolean
  readonly inputsDisabled: boolean
  readonly incompatible: boolean
  readonly prompt: SshPrompt | undefined
  readonly response: string
  /** The prompt was answered, or the attempt connects: the response field waits. */
  readonly waiting: boolean
  readonly error: SshDialogErrorKey | undefined
  readonly primary: {
    readonly action: "submit" | "respond"
    readonly disabled: boolean
    readonly label: "stage.connecting" | "update" | "connect" | "form.add" | "trust" | "continue"
  }
}

export function createSshDialogState(input: { id: string; config?: SshConfig; promptOnly?: boolean }): SshDialogState {
  const fields = { id: input.id, target: input.config?.target ?? "", name: input.config?.name ?? "" }

  if (input.promptOnly) return { ...fields, mode: "prompt", status: "active", prompted: true }

  return { ...fields, mode: input.config ? "connect" : "add", status: "idle" }
}

export function transitionSshDialog(state: SshDialogState, event: SshDialogEvent): SshDialogTransition {
  if (state.status === "completed" || state.status === "closed") return unchanged(state)

  if (event.type === "disposed")
    return {
      state: { id: state.id, mode: state.mode, target: state.target, name: state.name, status: "closed" },
      effects: state.status === "active" ? [{ type: "cancel" }] : [],
    }

  if (event.type === "target.changed")
    return state.target === event.value ? unchanged(state) : { state: { ...state, target: event.value }, effects: [] }

  if (event.type === "name.changed")
    return state.name === event.value ? unchanged(state) : { state: { ...state, name: event.value }, effects: [] }

  if (event.type === "submitted") {
    if (isBusy(state, event.snapshot) || !state.target.trim() || (state.status === "active" && state.challenge))
      return unchanged(state)

    // Each start forgets the prompts shown before it.
    return {
      state: {
        id: state.id,
        mode: state.mode,
        target: state.target,
        name: state.name,
        status: "active",
        prompted: false,
      },
      effects: [
        {
          type: "connect",
          config: { id: state.id, target: state.target, name: state.name },
          replace: event.snapshot.item?.stage === "incompatible",
        },
      ],
    }
  }

  if (state.status === "idle") return unchanged(state)
  const challenge = state.challenge

  if (event.type === "response.changed") {
    if (challenge?.prompt.id !== event.prompt || challenge.response === event.value) return unchanged(state)

    return { state: { ...state, challenge: { prompt: challenge.prompt, response: event.value } }, effects: [] }
  }

  if (event.type === "responded") {
    if (
      !challenge ||
      event.snapshot.item?.prompt?.id !== challenge.prompt.id ||
      isWaiting(state, event.snapshot) ||
      (!challenge.prompt.confirm && !challenge.response)
    )
      return unchanged(state)

    return {
      state,
      effects: [
        { type: "respond", prompt: challenge.prompt.id, value: challenge.prompt.confirm ? "yes" : challenge.response },
      ],
    }
  }

  const snapshot = event.snapshot

  if (!snapshot.submitting && snapshot.item?.stage === "ready")
    return { state: { ...state, status: "completed" }, effects: [{ type: "complete" }] }
  const prompt = snapshot.item?.prompt

  if (prompt) {
    if (challenge?.prompt.id === prompt.id) return unchanged(state)

    return { state: { ...state, prompted: true, challenge: { prompt, response: "" } }, effects: [] }
  }

  // The prompt this window answered stays, disabled, while main checks the answer; any other goes once main clears it.
  if (
    !challenge ||
    (snapshot.answeredPrompt === challenge.prompt.id &&
      !snapshot.error &&
      (snapshot.submitting || snapshot.item?.stage === "connecting"))
  )
    return unchanged(state)

  return { state: { ...state, challenge: undefined }, effects: [] }
}

export function viewSshDialog(state: SshDialogState, snapshot: SshDialogSnapshot): SshDialogView {
  const shown = state.status === "active" || state.status === "completed"
  const prompted = shown && state.prompted
  const challenge = shown ? state.challenge : undefined
  const incompatible = snapshot.item?.stage === "incompatible"
  const settled = state.status === "completed" || state.status === "closed"
  const busy = isBusy(state, snapshot)
  const waiting = isWaiting(state, snapshot) || settled

  // The attempt ended without a server or an error, as when main goes away while it starts.
  const lost =
    state.status === "active" && !snapshot.submitting && !snapshot.activeAttempt && !snapshot.item && !snapshot.error

  const error: SshDialogErrorKey | undefined =
    snapshot.error || lost ? "common.requestFailed" : snapshot.item?.error ? `error.${snapshot.item.error}` : undefined

  return {
    title: prompted || state.mode !== "add" ? "connectTo" : "add",
    showForm: state.mode !== "prompt" && !incompatible && (!prompted || (!!error && !challenge)),
    inputsDisabled: busy || !!challenge || settled,
    incompatible,
    prompt: challenge?.prompt,
    response: challenge?.response ?? "",
    waiting,
    error: incompatible ? undefined : error,
    primary: challenge
      ? {
          action: "respond",
          disabled: waiting || (!challenge.prompt.confirm && !challenge.response),
          label: waiting ? "stage.connecting" : challenge.prompt.confirm ? "trust" : "continue",
        }
      : {
          action: "submit",
          disabled: busy || !state.target.trim() || settled,
          label: busy ? "stage.connecting" : incompatible ? "update" : state.mode === "add" ? "form.add" : "connect",
        },
  }
}

/** A call is in flight, or the dialog's own attempt connects. */
function isBusy(state: SshDialogState, snapshot: SshDialogSnapshot) {
  return (
    snapshot.submitting ||
    (state.status === "active" &&
      snapshot.activeAttempt &&
      !snapshot.error &&
      (snapshot.item?.stage ?? "connecting") === "connecting")
  )
}

function isWaiting(state: SshDialogState, snapshot: SshDialogSnapshot) {
  return (
    isBusy(state, snapshot) ||
    (state.status === "active" &&
      !!state.challenge &&
      !snapshot.error &&
      snapshot.answeredPrompt === state.challenge.prompt.id)
  )
}

function unchanged(state: SshDialogState): SshDialogTransition {
  return { state, effects: [] }
}
