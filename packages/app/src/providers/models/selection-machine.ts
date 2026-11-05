import { durableVariantSelection, INHERIT_VARIANT, type VariantSelection } from "./variant"

/** How long a commit waits for the server to echo its agent and model before the local selection stops waiting. */
export const COMMIT_ACK_TIMEOUT_MS = 10_000

type ModelRef = { readonly providerID: string; readonly modelID: string }

/** A chosen model. A variant exists only beside a model, so an explicit Default without a model cannot be written. */
export type ModelChoice = ModelRef & { readonly variant: VariantSelection }

export type AgentChoices = Readonly<Record<string, ModelChoice>>

/** A draft's or a Session's local selection: the chosen agent and model, and the model each other agent last used. */
export type Selection = {
  readonly agent?: string
  readonly choice?: ModelChoice
  readonly choices: AgentChoices
}

/** The agent, model and variant a submission asks the server to commit. */
export type CommitTarget = {
  readonly agent: string
  readonly model: ModelRef
  readonly variant: string | undefined
}

/** The Session's committed selection, as the server reports it. */
export type DurableSelection = {
  readonly agent?: string
  readonly model?: { readonly providerID: string; readonly id: string; readonly variant?: string }
}

export type SelectionEdit =
  | {
      readonly type: "agent"
      readonly agent: string
      /** The selection on screen before the switch, remembered for the agent being left. */
      readonly previous: { readonly agent?: string; readonly choice?: ModelChoice }
    }
  | { readonly type: "model"; readonly agent: string | undefined; readonly choice: ModelChoice | undefined }

export type SessionSelectionEntry =
  /** The Session shows a local selection the server has not committed. */
  | ({ readonly phase: "override" } & Selection)
  /** Commit `attempt` waits for the server to echo `target`; the local selection shows until then. */
  | ({ readonly phase: "awaiting-ack"; readonly attempt: number; readonly target: CommitTarget } & Selection)
  /** The server's selection shows; only each agent's last model is kept. */
  | { readonly phase: "committed"; readonly choices: AgentChoices }

type Sessions = Readonly<Record<string, SessionSelectionEntry>>

/** The local selections of one workspace's Sessions. */
export type ModelSelectionState =
  /** Stored selections are still loading; `deleted` names Sessions removed meanwhile, so the load cannot restore them. */
  | {
      readonly status: "hydrating"
      readonly attempt: number
      readonly sessions: Sessions
      readonly deleted: readonly string[]
    }
  | { readonly status: "ready"; readonly attempt: number; readonly sessions: Sessions }
  | { readonly status: "disposed" }

export type ModelSelectionEvent =
  | { readonly type: "hydrated"; readonly sessions: Readonly<Record<string, Selection | undefined>> }
  | { readonly type: "edited"; readonly sessionID: string; readonly edit: SelectionEdit }
  | {
      readonly type: "session.promoted"
      readonly sessionID: string
      readonly selection: Selection
      readonly durable: DurableSelection | undefined
    }
  | {
      readonly type: "session.restored"
      readonly sessionID: string
      /** Whether a provider shows this Session now. */
      readonly visible: boolean
      readonly durable: DurableSelection | undefined
      readonly agent: string
      readonly choice: ModelChoice
    }
  | {
      readonly type: "commit.tracked"
      readonly sessionID: string
      readonly target: CommitTarget
      readonly visible: boolean
      readonly durable: DurableSelection | undefined
    }
  | {
      readonly type: "commit.reconciled"
      readonly sessionID: string
      readonly visible: boolean
      readonly durable: DurableSelection | undefined
    }
  | { readonly type: "commit.cancelled"; readonly sessionID: string; readonly attempt: number }
  | { readonly type: "commit.timed-out"; readonly sessionID: string; readonly attempt: number }
  | { readonly type: "session.deleted"; readonly sessionID: string }
  | { readonly type: "disposed" }

export type ModelSelectionEffect =
  | { readonly type: "persist.write"; readonly sessionID: string; readonly selection: Selection | undefined }
  | {
      readonly type: "ack-timer.start"
      readonly sessionID: string
      readonly attempt: number
      readonly timeoutMs: number
    }
  | { readonly type: "ack-timer.clear"; readonly sessionID: string }
  | { readonly type: "ack-timer.clear-all" }

export type ModelSelectionTransition = {
  readonly state: ModelSelectionState
  readonly effects: readonly ModelSelectionEffect[]
}

type Active = Exclude<ModelSelectionState, { status: "disposed" }>

const NO_EFFECTS: readonly ModelSelectionEffect[] = Object.freeze([])

export function createModelSelectionState(
  input: { readonly status: "hydrating" } | { readonly status: "ready"; readonly sessions: Sessions },
): ModelSelectionState {
  if (input.status === "hydrating") return { status: "hydrating", attempt: 0, sessions: {}, deleted: [] }

  return { status: "ready", attempt: 0, sessions: input.sessions }
}

/** Decodes stored selections into entries; an entry without agent, model or memory is dropped. */
export function storedSessions(stored: Readonly<Record<string, Selection | undefined>>): Sessions {
  return Object.fromEntries(
    Object.entries(stored).flatMap(([sessionID, selection]) => {
      const entry = selection && normalize(selection.agent, selection.choice, selection.choices)

      return entry ? [[sessionID, entry]] : []
    }),
  )
}

export function transitionModelSelection(
  state: ModelSelectionState,
  event: ModelSelectionEvent,
): ModelSelectionTransition {
  const same = { state, effects: NO_EFFECTS }

  if (state.status === "disposed") return same

  if (event.type === "disposed") return { state: { status: "disposed" }, effects: [{ type: "ack-timer.clear-all" }] }

  if (event.type === "hydrated") return hydrate(state, event.sessions)

  const prev = state.sessions[event.sessionID]

  if (event.type === "edited") {
    if (event.edit.type === "agent" && event.edit.previous.agent === event.edit.agent) return same
    const next = editSelection(prev, event.edit) ?? { choices: {} }

    return settle(state, event.sessionID, normalize(next.agent, next.choice, next.choices))
  }

  if (event.type === "session.promoted") {
    const selection = event.selection
    const committed = matchesDurable(selectionTarget(selection), event.durable)

    // Creation already committed this selection; keep only agent memory, so a first-message command's configured
    // overrides are not hidden behind it.
    return settle(
      state,
      event.sessionID,
      committed
        ? normalize(undefined, undefined, selection.choices)
        : normalize(selection.agent, selection.choice, selection.choices),
    )
  }

  if (event.type === "session.restored") {
    if (!event.visible || event.durable?.model || prev !== undefined) return same

    return settle(state, event.sessionID, { phase: "override", agent: event.agent, choice: event.choice, choices: {} })
  }

  if (event.type === "commit.tracked") {
    const attempt = state.attempt + 1
    const next = { ...state, attempt }

    if (matchesDurable(event.target, event.durable)) {
      if (!prev) return { state: next, effects: NO_EFFECTS }

      return settle(next, event.sessionID, release(prev, event.target, event.visible))
    }

    return settle(next, event.sessionID, {
      phase: "awaiting-ack",
      attempt,
      target: event.target,
      ...local(prev),
    })
  }

  if (event.type === "commit.reconciled") {
    if (prev?.phase !== "awaiting-ack" || !matchesDurable(prev.target, event.durable)) return same

    return settle(state, event.sessionID, release(prev, prev.target, event.visible))
  }

  if (event.type === "commit.cancelled" || event.type === "commit.timed-out") {
    if (prev?.phase !== "awaiting-ack" || prev.attempt !== event.attempt) return same

    return settle(state, event.sessionID, normalize(prev.agent, prev.choice, prev.choices))
  }

  if (prev === undefined && (state.status === "ready" || state.deleted.includes(event.sessionID))) return same

  return settle(state, event.sessionID, undefined)
}

/** Applies a picker edit to a draft's or a Session's selection. Switching to the agent already shown changes nothing. */
export function editSelection(current: Selection | undefined, edit: SelectionEdit): Selection | undefined {
  if (edit.type === "model") return { agent: edit.agent, choice: edit.choice, choices: current?.choices ?? {} }

  if (edit.previous.agent === edit.agent) return current
  const choices = { ...current?.choices }
  const left = edit.previous.agent

  if (left && edit.previous.choice) choices[left] = edit.previous.choice

  if (left && !edit.previous.choice) delete choices[left]

  return { agent: edit.agent, choice: choices[edit.agent], choices }
}

/** The local selection a Session shows, or `undefined` when its committed selection shows. */
export function selectSession(state: ModelSelectionState, sessionID: string): Selection | undefined {
  if (state.status === "disposed") return

  return state.sessions[sessionID]
}

/** The model a selection names before agent and configuration defaults apply. */
export function selectChosenModel(
  local: Selection | undefined,
  durable: DurableSelection | undefined,
  agent: string | undefined,
): ModelRef | undefined {
  if (local?.choice) return { providerID: local.choice.providerID, modelID: local.choice.modelID }

  // The Session's model belongs to the agent it was committed with.
  if (durable?.model && (!durable.agent || durable.agent === agent))
    return { providerID: durable.model.providerID, modelID: durable.model.id }
}

/** The variant the selection asks for, when its model is still available. */
export function selectVariant(
  local: Selection | undefined,
  durable: DurableSelection | undefined,
  agent: string | undefined,
  valid: (model: ModelRef) => boolean,
): VariantSelection {
  if (local?.choice && valid(local.choice)) return local.choice.variant

  if (durable?.agent && durable.agent !== agent) return INHERIT_VARIANT

  if (durable?.model && valid({ providerID: durable.model.providerID, modelID: durable.model.id }))
    return durableVariantSelection(durable.model.variant)

  return INHERIT_VARIANT
}

/** What the model chips will show once agents and configuration load, from state already here. */
export function selectPreview(local: Selection | undefined, durable: DurableSelection | undefined) {
  if (local?.choice) {
    return {
      model: { providerID: local.choice.providerID, modelID: local.choice.modelID },
      selected: local.choice.variant,
    }
  }

  if (!durable?.model || (local?.agent && local.agent !== durable.agent)) return

  return {
    model: { providerID: durable.model.providerID, modelID: durable.model.id },
    selected: durableVariantSelection(durable.model.variant),
  }
}

/** The entry's persisted form: the local selection, only agent memory once committed, or nothing. */
export function persistedSelection(entry: SessionSelectionEntry | undefined): Selection | undefined {
  if (!entry) return

  if (entry.phase === "committed") return { choices: entry.choices }

  return { agent: entry.agent, choice: entry.choice, choices: entry.choices }
}

function hydrate(state: Active, stored: Readonly<Record<string, Selection | undefined>>): ModelSelectionTransition {
  if (state.status === "ready") return { state, effects: NO_EFFECTS }
  const loaded = Object.entries(storedSessions(stored)).filter(([sessionID]) => !state.deleted.includes(sessionID))

  // Selections made while loading are newer than the stored ones, so they win and are written back.
  return {
    state: {
      status: "ready",
      attempt: state.attempt,
      sessions: { ...Object.fromEntries(loaded), ...state.sessions },
    },
    effects: [
      ...Object.entries(state.sessions).map(
        ([sessionID, entry]) =>
          ({ type: "persist.write", sessionID, selection: persistedSelection(entry) }) satisfies ModelSelectionEffect,
      ),
      ...state.deleted.map(
        (sessionID) => ({ type: "persist.write", sessionID, selection: undefined }) satisfies ModelSelectionEffect,
      ),
    ],
  }
}

/** Replaces one Session's entry, stops a commit wait it ends, and writes the change once stored state has loaded. */
function settle(
  state: Active,
  sessionID: string,
  next: SessionSelectionEntry | undefined,
): ModelSelectionTransition {
  const prev = state.sessions[sessionID]
  const sessions = { ...state.sessions }

  if (next) sessions[sessionID] = next

  if (!next) delete sessions[sessionID]

  const effects: ModelSelectionEffect[] = []

  if (prev?.phase === "awaiting-ack" && (next?.phase !== "awaiting-ack" || next.attempt !== prev.attempt))
    effects.push({ type: "ack-timer.clear", sessionID })

  if (next?.phase === "awaiting-ack" && (prev?.phase !== "awaiting-ack" || prev.attempt !== next.attempt))
    effects.push({ type: "ack-timer.start", sessionID, attempt: next.attempt, timeoutMs: COMMIT_ACK_TIMEOUT_MS })

  if (state.status === "ready") {
    effects.push({ type: "persist.write", sessionID, selection: persistedSelection(next) })

    return { state: { ...state, sessions }, effects }
  }

  const deleted = state.deleted.filter((item) => item !== sessionID)

  return { state: { ...state, sessions, deleted: next ? deleted : [...deleted, sessionID] }, effects }
}

/**
 * Ends a commit the server has echoed. The Session shows the committed selection only while it is on screen and its
 * local selection is the one committed; otherwise the local selection stays, so a Session shows what was last picked
 * in it when it is opened again.
 */
function release(entry: SessionSelectionEntry, target: CommitTarget, visible: boolean) {
  const current = local(entry)

  if (visible && matchesTarget(current, target)) return normalize(undefined, undefined, current.choices)

  return normalize(current.agent, current.choice, current.choices)
}

function local(entry: SessionSelectionEntry | undefined): Selection {
  if (!entry) return { choices: {} }

  if (entry.phase === "committed") return { choices: entry.choices }

  return { agent: entry.agent, choice: entry.choice, choices: entry.choices }
}

function normalize(
  agent: string | undefined,
  choice: ModelChoice | undefined,
  choices: AgentChoices,
): SessionSelectionEntry | undefined {
  if (agent !== undefined || choice !== undefined) return { phase: "override", agent, choice, choices }

  if (Object.keys(choices).length > 0) return { phase: "committed", choices }
}

function variantName(variant: VariantSelection) {
  return variant.type === "named" ? variant.value : undefined
}

function selectionTarget(selection: Selection) {
  if (!selection.agent || !selection.choice) return

  return {
    agent: selection.agent,
    model: { providerID: selection.choice.providerID, modelID: selection.choice.modelID },
    variant: variantName(selection.choice.variant),
  } satisfies CommitTarget
}

function matchesTarget(selection: Selection, target: CommitTarget) {
  return (
    selection.agent === target.agent &&
    selection.choice?.providerID === target.model.providerID &&
    selection.choice.modelID === target.model.modelID &&
    variantName(selection.choice.variant) === target.variant
  )
}

function matchesDurable(target: CommitTarget | undefined, durable: DurableSelection | undefined) {
  return (
    !!target &&
    !!durable?.model &&
    durable.agent === target.agent &&
    durable.model.providerID === target.model.providerID &&
    durable.model.id === target.model.modelID &&
    durable.model.variant === target.variant
  )
}
