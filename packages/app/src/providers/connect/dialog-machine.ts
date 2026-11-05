import {
  selectProviderConnectView,
  startProviderConnect,
  transitionProviderConnect,
  type ProviderConnectEffect,
  type ProviderConnectEvent,
  type ProviderConnectScreen,
  type ProviderConnectState,
  type ProviderConnectTransition,
} from "./machine"

// The OpenCode Console account is the `opencode` integration. OpenCode Go is its own integration
// and connects with its own methods, the same as the TUI.
export const CONSOLE_INTEGRATION = "opencode"

export const CLAUDE_AGENT_INTEGRATION = "claude-agent"

// The server allows 30 seconds for `claude` to start and 30 more to read each model's context size.
export const CLAUDE_CHECK_TIMEOUT_MS = 65_000

export type ProviderReturnTarget = "picker" | "accounts"

export type AccountStepAction =
  | { readonly type: "idle" }
  | { readonly type: "confirming"; readonly accountID: string }
  | { readonly type: "renaming"; readonly accountID: string }
  | { readonly type: "activating"; readonly attempt: number; readonly accountID: string }
  | { readonly type: "removing"; readonly attempt: number; readonly accountID: string; readonly final: boolean }

/** Saving a Claude Agent connection only records the choice; the server then checks `claude` itself. */
export type ClaudeStepPhase =
  | { readonly status: "idle" }
  /** The connect request is in flight. `replacing` lists the accounts the new connection replaces once saved. */
  | { readonly status: "starting"; readonly check: number; readonly replacing: readonly string[] }
  | { readonly status: "checking"; readonly check: number }
  /** Models appeared; the integration is read again before they count as a working login. */
  | { readonly status: "confirming"; readonly check: number }
  | { readonly status: "timed-out"; readonly check: number }

export type ProviderDialogStep =
  | { readonly kind: "accounts"; readonly action: AccountStepAction; readonly connect: ProviderConnectState }
  | {
      readonly kind: "connect"
      readonly returnTo: ProviderReturnTarget
      /** The result of copying the Console sign-in link, for the authorization it was copied from. */
      readonly copy?: { readonly attemptID: string; readonly copied: boolean }
      readonly connect: ProviderConnectState
    }
  | {
      readonly kind: "claude"
      readonly returnTo: ProviderReturnTarget
      readonly phase: ClaudeStepPhase
      readonly connect: ProviderConnectState
    }
  | {
      readonly kind: "no-models"
      readonly returnTo: ProviderReturnTarget
      /** The workspace providers had not loaded when the wait ran out. */
      readonly catalogPending: boolean
      readonly connect: ProviderConnectState
    }
  | {
      readonly kind: "models"
      readonly selectedModel: string
      readonly collapsed: Readonly<Record<string, boolean>>
    }

/** What the server lists for the selected integration. The server lists the active account first. */
export type ProviderAccounts = {
  readonly count: number
  readonly activeID: string | undefined
  /** The active account needs a fresh sign-in. For Claude Agent it is the latest check of `claude`. */
  readonly problem: boolean
}

type DialogMeta = {
  /** Bumped whenever the selected provider changes or resets; async results carry it. */
  readonly session: number
  /** Last attempt ID handed to an account action or a Claude check. */
  readonly attempt: number
  readonly standalone: boolean
  /** The user picked a model to start with. */
  readonly completed: boolean
  readonly chatgptWelcome: boolean
}

export type ProviderDialogState =
  | (DialogMeta & { readonly status: "picker" })
  | (DialogMeta & {
      readonly status: "provider"
      readonly provider: string
      readonly accounts: ProviderAccounts
      readonly step: ProviderDialogStep
      /** The dialog is closing: the last step stays visible while it animates out, and input is ignored. */
      readonly closed: boolean
    })
  | (DialogMeta & { readonly status: "disposed" })

export type ProviderCatalogSnapshot = {
  /** The Console workspace providers had not loaded when the wait ran out. */
  readonly pending: boolean
  readonly firstModel: string | undefined
}

export type ModelChoice = { readonly providerID: string; readonly modelID: string }

export type ProviderDialogEvent =
  | {
      readonly type: "provider.selected"
      readonly provider: string
      readonly fromPicker: boolean
      readonly accounts: ProviderAccounts
    }
  | { readonly type: "provider.cleared" }
  /** User input for the sign-in of the current step. */
  | { readonly type: "connect.input"; readonly event: ProviderConnectEvent }
  /** An async sign-in result. `catalog` comes with `refresh.succeeded`. */
  | {
      readonly type: "connect.result"
      readonly session: number
      readonly provider: string
      readonly event: ProviderConnectEvent
      readonly catalog?: ProviderCatalogSnapshot
    }
  | { readonly type: "accounts.synced"; readonly accounts: ProviderAccounts }
  | { readonly type: "account.add" }
  | { readonly type: "account.rename.started"; readonly accountID: string }
  | { readonly type: "account.rename.closed" }
  | { readonly type: "account.remove.prompted"; readonly accountID: string }
  | { readonly type: "account.remove.cancelled" }
  | { readonly type: "account.remove.confirmed"; readonly accountID: string }
  | { readonly type: "account.remove.settled"; readonly session: number; readonly attempt: number }
  | { readonly type: "account.activate.requested"; readonly accountID: string }
  | { readonly type: "account.activate.settled"; readonly session: number; readonly attempt: number }
  | { readonly type: "claude.check"; readonly replacing: readonly string[] }
  | { readonly type: "claude.status.changed"; readonly hasProblem: boolean; readonly hasModels: boolean }
  | { readonly type: "claude.timed-out"; readonly session: number; readonly check: number }
  | {
      readonly type: "claude.confirmed"
      readonly session: number
      readonly check: number
      readonly hasProblem: boolean
      readonly firstModel: string | undefined
    }
  | { readonly type: "link.copied"; readonly session: number; readonly attemptID: string; readonly copied: boolean }
  | { readonly type: "model.selected"; readonly modelKey: string }
  | { readonly type: "group.collapsed"; readonly providerID: string; readonly collapsed: boolean }
  | { readonly type: "model.confirmed"; readonly selection: ModelChoice }
  | { readonly type: "back" }
  | { readonly type: "disposed" }

export type ProviderDialogEffect =
  | {
      readonly type: "connect.effect"
      readonly session: number
      readonly provider: string
      readonly effect: Exclude<ProviderConnectEffect, { type: "complete" }>
    }
  /** Mirrors the selected provider into the caller's controller. */
  | { readonly type: "controller.sync"; readonly provider: string | undefined }
  | {
      readonly type: "account.activate"
      readonly session: number
      readonly attempt: number
      readonly provider: string
      readonly accountID: string
    }
  | {
      readonly type: "account.remove"
      readonly session: number
      readonly attempt: number
      readonly provider: string
      readonly accountID: string
      readonly final: boolean
    }
  | { readonly type: "claude.replace"; readonly credentialIDs: readonly string[] }
  | {
      readonly type: "claude.timer.start"
      readonly session: number
      readonly check: number
      readonly timeoutMs: number
    }
  | { readonly type: "claude.timer.stop" }
  | { readonly type: "claude.confirm"; readonly session: number; readonly check: number }
  | { readonly type: "settle.cancel" }
  | { readonly type: "models.reveal"; readonly provider: string }
  | { readonly type: "connected.notify"; readonly provider: string }
  | { readonly type: "toast.connected"; readonly provider: string }
  | { readonly type: "model.apply"; readonly selection: ModelChoice }
  | { readonly type: "dialog.close" }

export type ProviderDialogTransition = {
  readonly state: ProviderDialogState
  readonly effects: readonly ProviderDialogEffect[]
}

type ProviderState = Extract<ProviderDialogState, { status: "provider" }>

type ConnectStep = Extract<ProviderDialogStep, { connect: ProviderConnectState }>

export function createProviderDialogState(input: { standalone: boolean }): ProviderDialogState {
  return {
    status: "picker",
    session: 0,
    attempt: 0,
    standalone: input.standalone,
    completed: false,
    chatgptWelcome: false,
  }
}

export function transitionProviderDialog(
  state: ProviderDialogState,
  event: ProviderDialogEvent,
): ProviderDialogTransition {
  // A result for a provider the dialog has left can still have happened on the server: an attempt it opened
  // late is cancelled, and a credential it saved still reaches the catalogs.
  if (event.type === "connect.result" && !current(state, event.session))
    return unchanged(
      state,
      wrap(event.session, event.provider, transitionProviderConnect({ status: "disposed" }, event.event)),
    )

  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed")
    return { state: { ...meta(state), status: "disposed" }, effects: state.status === "provider" ? leave(state) : [] }

  if (state.status === "provider" && state.closed) return unchanged(state)

  if (event.type === "provider.selected") {
    if (state.status === "provider" && state.provider === event.provider) return unchanged(state)
    const session = state.session + 1
    const start = startProviderConnect()

    return {
      state: {
        ...meta(state),
        status: "provider",
        session,
        provider: event.provider,
        accounts: event.accounts,
        step: entry(event.provider, event.fromPicker, event.accounts, start.state),
        closed: false,
      },
      effects: [
        ...(state.status === "provider" ? leave(state) : []),
        { type: "controller.sync", provider: event.provider },
        ...wrap(session, event.provider, start),
      ],
    }
  }

  if (state.status === "picker") return unchanged(state)

  if (event.type === "provider.cleared") return toPicker(state)

  if (event.type === "back") return back(state)

  if (event.type === "accounts.synced") return synced(state, event.accounts)

  if (event.type === "connect.input") {
    if (!("connect" in state.step)) return unchanged(state)

    return connectTransition(state, state.step, transitionProviderConnect(state.step.connect, event.event))
  }

  if (event.type === "connect.result") return connected(state, event)

  const step = state.step

  if (step.kind === "accounts") return account(state, step, event)

  if (step.kind === "claude") return claude(state, step, event)

  if (step.kind === "models") {
    if (event.type === "model.selected")
      return unchanged({ ...state, step: { ...step, selectedModel: event.modelKey } })

    if (event.type === "group.collapsed") {
      if (!!step.collapsed[event.providerID] === event.collapsed) return unchanged(state)

      return unchanged({
        ...state,
        step: { ...step, collapsed: { ...step.collapsed, [event.providerID]: event.collapsed } },
      })
    }

    if (event.type !== "model.confirmed") return unchanged(state)

    return {
      state: { ...state, completed: true, closed: true },
      effects: [{ type: "dialog.close" }, { type: "model.apply", selection: event.selection }],
    }
  }

  if (step.kind !== "connect" || event.type !== "link.copied" || event.session !== state.session)
    return unchanged(state)

  if (selectProviderConnectView(step.connect).authorization?.attemptID !== event.attemptID) return unchanged(state)

  return unchanged({ ...state, step: { ...step, copy: { attemptID: event.attemptID, copied: event.copied } } })
}

export type ProviderBackTarget = "accounts" | "methods" | "picker"

/** Where Back goes from the current step; undefined when there is nowhere to go. */
export function providerBackTarget(state: ProviderDialogState): ProviderBackTarget | undefined {
  if (state.status !== "provider") return

  const step = state.step

  if (step.kind === "models") return

  const picker = state.standalone ? undefined : "picker"

  if (step.kind === "accounts") return picker

  if (step.kind === "no-models") return "methods"

  if (step.kind === "claude") return step.returnTo === "accounts" && state.accounts.count > 0 ? "accounts" : picker

  const view = selectProviderConnectView(step.connect)

  if (
    step.returnTo === "accounts" &&
    state.accounts.count > 0 &&
    (view.methods.length === 1 || step.connect.status === "choosing")
  )
    return "accounts"

  if ((state.provider === CONSOLE_INTEGRATION || view.methods.length > 1) && view.methodIndex !== undefined)
    return "methods"

  return picker
}

/** Which dialog shell the step uses: the searchable list, the model choice, or a provider step. */
export type ProviderDialogFrame = "picker" | "models" | "accounts" | "provider"

export type ProviderDialogTitle = "connect" | "console-error" | "console-sign-in" | "anthropic-max"

export type ProviderDialogBody =
  | { readonly kind: "picker" }
  | { readonly kind: "models"; readonly selectedModel: string; readonly collapsed: Readonly<Record<string, boolean>> }
  | {
      readonly kind: "accounts"
      readonly action: AccountStepAction
      readonly busy: boolean
      readonly activeID: string | undefined
      readonly canAdd: boolean
    }
  | { readonly kind: "claude"; readonly checking: boolean; readonly canCheck: boolean; readonly timedOut: boolean }
  | { readonly kind: "no-models"; readonly catalogPending: boolean; readonly refreshing: boolean }
  | { readonly kind: "console-sign-in"; readonly copy: "idle" | "copied" | "failed" }
  | { readonly kind: ProviderConnectScreen }

export function selectProviderDialogView(state: ProviderDialogState) {
  const provider = state.status === "provider" ? state : undefined
  const step = provider?.step
  const connect = step && "connect" in step ? selectProviderConnectView(step.connect) : undefined
  const target = providerBackTarget(state)
  const body = selectBody(state, connect)
  const isConsole = provider?.provider === CONSOLE_INTEGRATION

  const frame: ProviderDialogFrame = !step
    ? "picker"
    : step.kind === "models" || step.kind === "accounts"
      ? step.kind
      : "provider"

  return {
    provider: provider?.provider,
    frame,
    connect,
    body,
    canBack: target !== undefined,
    title: ((): ProviderDialogTitle => {
      if (isConsole && connect?.status === "failed") return "console-error"

      if (body.kind === "console-sign-in") return "console-sign-in"

      if (provider?.provider === "anthropic" && connect?.method?.label?.toLowerCase().includes("max"))
        return "anthropic-max"

      return "connect"
    })(),
    // Closing on a stray backdrop click would abandon a sign-in the user is finishing in the browser.
    preventBackdropDismiss: !!provider && !provider.closed && !!connect?.authorizing,
    completed: state.completed,
    chatgptWelcome: state.chatgptWelcome,
  }
}

export type ProviderDialogView = ReturnType<typeof selectProviderDialogView>

function selectBody(
  state: ProviderDialogState,
  connect: ReturnType<typeof selectProviderConnectView> | undefined,
): ProviderDialogBody {
  if (state.status !== "provider") return { kind: "picker" }

  const step = state.step

  if (step.kind === "models") return { kind: "models", selectedModel: step.selectedModel, collapsed: step.collapsed }

  if (step.kind === "accounts") {
    const busy = step.action.type === "activating" || step.action.type === "removing"

    return {
      kind: "accounts",
      action: step.action,
      busy,
      activeID: step.action.type === "activating" ? step.action.accountID : state.accounts.activeID,
      canAdd: !busy && (connect?.methods.length ?? 0) > 0,
    }
  }

  if (!connect) return { kind: "busy" }

  if (connect.status === "failed") return { kind: "failed" }

  if (step.kind === "claude") {
    const phase = step.phase.status

    return {
      kind: "claude",
      checking:
        phase === "checking" ||
        phase === "confirming" ||
        connect.status === "starting" ||
        connect.status === "refreshing",
      canCheck: connect.status !== "loading",
      timedOut: phase === "timed-out",
    }
  }

  if (step.kind === "no-models")
    return { kind: "no-models", catalogPending: step.catalogPending, refreshing: connect.status === "refreshing" }

  if (state.provider === CONSOLE_INTEGRATION && connect.screen === "browser") {
    const copy = step.copy?.attemptID === connect.authorization?.attemptID ? step.copy : undefined

    return { kind: "console-sign-in", copy: !copy ? "idle" : copy.copied ? "copied" : "failed" }
  }

  return { kind: connect.screen }
}

// The first step for a provider. A healthy connected provider picked from the list shows its accounts first.
function entry(
  provider: string,
  fromPicker: boolean,
  accounts: ProviderAccounts,
  connect: ProviderConnectState,
): ProviderDialogStep {
  const claude = provider === CLAUDE_AGENT_INTEGRATION

  if (fromPicker && accounts.count > 0 && !(claude && accounts.problem))
    return { kind: "accounts", action: { type: "idle" }, connect }

  return fresh(provider, "picker", connect)
}

function fresh(provider: string, returnTo: ProviderReturnTarget, connect: ProviderConnectState): ProviderDialogStep {
  if (provider === CLAUDE_AGENT_INTEGRATION) return { kind: "claude", returnTo, phase: { status: "idle" }, connect }

  return { kind: "connect", returnTo, connect }
}

function back(state: ProviderState): ProviderDialogTransition {
  const target = providerBackTarget(state)
  const step = state.step

  if (!target || !("connect" in step)) return unchanged(state)

  if (target === "picker") return toPicker(state)

  const result = transitionProviderConnect(step.connect, { type: "back" })

  const effects = [
    ...stopClaude(step),
    ...settleCancel(step.connect, result.state),
    ...wrap(state.session, state.provider, result),
  ]

  if (target === "accounts")
    return {
      state: { ...state, step: { kind: "accounts", action: { type: "idle" }, connect: result.state } },
      effects,
    }

  const returnTo = step.kind === "accounts" ? "picker" : step.returnTo

  return { state: { ...state, step: { kind: "connect", returnTo, connect: result.state } }, effects }
}

function synced(state: ProviderState, accounts: ProviderAccounts): ProviderDialogTransition {
  const same =
    state.accounts.count === accounts.count &&
    state.accounts.activeID === accounts.activeID &&
    state.accounts.problem === accounts.problem

  if (same) return unchanged(state)
  const next = { ...state, accounts }
  const step = state.step

  // An account action in flight decides where it lands when it settles.
  if (step.kind !== "accounts" || step.action.type === "activating" || step.action.type === "removing")
    return unchanged(next)

  return unchanged({ ...next, step: afterAccounts(next, step) })
}

// Accounts that ran out, or a Claude Agent login that broke, leave the accounts list for the setup.
function afterAccounts(state: ProviderState, step: Extract<ProviderDialogStep, { kind: "accounts" }>) {
  if (state.accounts.count === 0 || (state.provider === CLAUDE_AGENT_INTEGRATION && state.accounts.problem))
    return fresh(state.provider, "picker", step.connect)

  return step
}

function account(
  state: ProviderState,
  step: Extract<ProviderDialogStep, { kind: "accounts" }>,
  event: ProviderDialogEvent,
): ProviderDialogTransition {
  const action = step.action
  const busy = action.type === "activating" || action.type === "removing"
  const set = (next: AccountStepAction) => unchanged({ ...state, step: { ...step, action: next } })

  if (event.type === "account.activate.settled" || event.type === "account.remove.settled") {
    if (!busy || event.session !== state.session || event.attempt !== action.attempt) return unchanged(state)

    // Removing the last account disconnects the integration, so the dialog is done, as in the TUI.
    if (action.type === "removing" && action.final && state.accounts.count === 0)
      return {
        state: { ...state, step: { ...step, action: { type: "idle" } }, closed: true },
        effects: [{ type: "dialog.close" }],
      }

    return unchanged({ ...state, step: afterAccounts(state, { ...step, action: { type: "idle" } }) })
  }

  if (busy) return unchanged(state)

  if (event.type === "account.rename.started") return set({ type: "renaming", accountID: event.accountID })

  if (event.type === "account.rename.closed")
    return action.type === "renaming" ? set({ type: "idle" }) : unchanged(state)

  if (event.type === "account.remove.prompted") return set({ type: "confirming", accountID: event.accountID })

  if (event.type === "account.remove.cancelled")
    return action.type === "confirming" ? set({ type: "idle" }) : unchanged(state)

  if (event.type === "account.activate.requested") {
    if (event.accountID === state.accounts.activeID) return unchanged(state)
    const attempt = state.attempt + 1

    return {
      state: {
        ...state,
        attempt,
        step: { ...step, action: { type: "activating", attempt, accountID: event.accountID } },
      },
      effects: [
        {
          type: "account.activate",
          session: state.session,
          attempt,
          provider: state.provider,
          accountID: event.accountID,
        },
      ],
    }
  }

  if (event.type === "account.remove.confirmed") {
    if (action.type !== "confirming" || action.accountID !== event.accountID) return unchanged(state)
    const attempt = state.attempt + 1
    const final = state.accounts.count === 1

    return {
      state: {
        ...state,
        attempt,
        step: { ...step, action: { type: "removing", attempt, accountID: event.accountID, final } },
      },
      effects: [
        {
          type: "account.remove",
          session: state.session,
          attempt,
          provider: state.provider,
          accountID: event.accountID,
          final,
        },
      ],
    }
  }

  if (event.type !== "account.add") return unchanged(state)

  // Like the TUI: a lone method starts directly, several show the method list. Claude Agent shows its setup first.
  if (state.provider === CLAUDE_AGENT_INTEGRATION)
    return unchanged({
      ...state,
      step: { kind: "claude", returnTo: "accounts", phase: { status: "idle" }, connect: step.connect },
    })

  const methods = selectProviderConnectView(step.connect).methods

  if (methods.length === 0) return unchanged(state)

  const next: ProviderDialogStep = { kind: "connect", returnTo: "accounts", connect: step.connect }

  if (methods.length > 1) return unchanged({ ...state, step: next })

  return connectTransition(
    { ...state, step: next },
    next,
    transitionProviderConnect(step.connect, { type: "method.selected", index: 0 }),
  )
}

function claude(
  state: ProviderState,
  step: Extract<ProviderDialogStep, { kind: "claude" }>,
  event: ProviderDialogEvent,
): ProviderDialogTransition {
  const phase = step.phase

  const set = (next: ClaudeStepPhase, effects: ProviderDialogEffect[] = []) => ({
    state: { ...state, step: { ...step, phase: next } },
    effects,
  })

  // Connecting again is what makes the server check `claude` again.
  if (event.type === "claude.check") {
    const body = selectBody(state, selectProviderConnectView(step.connect))

    if (body.kind !== "claude" || body.checking || !body.canCheck) return unchanged(state)
    const check = state.attempt + 1
    const result = transitionProviderConnect(step.connect, { type: "method.selected", index: 0 })

    if (result.state === step.connect) return unchanged(state)

    return {
      state: {
        ...state,
        attempt: check,
        step: { ...step, phase: { status: "starting", check, replacing: event.replacing }, connect: result.state },
      },
      effects: [{ type: "claude.timer.stop" }, ...wrap(state.session, state.provider, result)],
    }
  }

  if (event.type === "claude.status.changed") {
    if (phase.status !== "checking" && phase.status !== "timed-out" && phase.status !== "confirming")
      return unchanged(state)

    if (event.hasProblem) return set({ status: "idle" }, [{ type: "claude.timer.stop" }])

    // A check that outlives the timeout can still finish, so a late result replaces the timeout message.
    if (phase.status === "confirming" || !event.hasModels) return unchanged(state)

    return set({ status: "confirming", check: phase.check }, [
      { type: "claude.timer.stop" },
      { type: "claude.confirm", session: state.session, check: phase.check },
    ])
  }

  if (event.type === "claude.timed-out") {
    if (phase.status !== "checking" || event.session !== state.session || event.check !== phase.check)
      return unchanged(state)

    return set({ status: "timed-out", check: phase.check })
  }

  if (event.type !== "claude.confirmed") return unchanged(state)

  if (phase.status !== "confirming" || event.session !== state.session || event.check !== phase.check)
    return unchanged(state)

  if (event.hasProblem) return set({ status: "idle" })
  const finished = finish(state, event.firstModel)

  return {
    state: finished.state,
    effects: [{ type: "models.reveal", provider: state.provider }, ...finished.effects],
  }
}

// Applies a sign-in transition to the current step. A sign-in that completes moves the dialog on.
function connectTransition(
  state: ProviderState,
  step: ConnectStep,
  result: ProviderConnectTransition,
  catalog?: ProviderCatalogSnapshot,
): ProviderDialogTransition {
  const complete = result.effects.find((effect) => effect.type === "complete")
  const effects = [...settleCancel(step.connect, result.state), ...wrap(state.session, state.provider, result)]

  if (result.state === step.connect && complete === undefined) return unchanged(state, effects)

  const next: ProviderState = { ...state, step: { ...step, connect: result.state } }

  if (complete?.type !== "complete") return { state: next, effects }

  const method = complete.method

  const notified: ProviderState = {
    ...next,
    chatgptWelcome:
      state.chatgptWelcome ||
      (state.provider === "openai" && method.type === "oauth" && method.id === "chatgpt-token-sharing"),
  }

  const notify: ProviderDialogEffect[] = [...effects, { type: "connected.notify", provider: state.provider }]
  const returnTo = step.kind === "accounts" ? "picker" : step.returnTo

  if (step.kind === "claude") {
    // Each connect saves a new account, so drop the ones this check replaces.
    const replacing = step.phase.status === "starting" ? step.phase.replacing : []
    const check = step.phase.status === "starting" ? step.phase.check : state.attempt + 1

    const replace: ProviderDialogEffect[] = replacing.length
      ? [{ type: "claude.replace", credentialIDs: replacing }]
      : []

    return {
      state: {
        ...notified,
        attempt: Math.max(state.attempt, check),
        step: { ...step, connect: result.state, phase: { status: "checking", check } },
      },
      effects: [
        ...notify,
        ...replace,
        { type: "claude.timer.start", session: state.session, check, timeoutMs: CLAUDE_CHECK_TIMEOUT_MS },
      ],
    }
  }

  // The picker only lists the newest model per family by default, which hides most of what a new connection
  // just unlocked. Show everything the connected integration offers.
  const reveal: ProviderDialogEffect[] = [...notify, { type: "models.reveal", provider: state.provider }]

  if (catalog?.pending)
    return {
      state: { ...notified, step: { kind: "no-models", returnTo, catalogPending: true, connect: result.state } },
      effects: reveal,
    }

  const finished = finish(notified, catalog?.firstModel, result.state, returnTo)

  return { state: finished.state, effects: [...reveal, ...finished.effects] }
}

// Like the TUI, every connection continues to that provider's models. A Console connection without models stays
// open so the workspace can be fixed.
function finish(
  state: ProviderState,
  firstModel: string | undefined,
  connect?: ProviderConnectState,
  returnTo: ProviderReturnTarget = "picker",
): ProviderDialogTransition {
  const announce: ProviderDialogEffect[] = [{ type: "toast.connected", provider: state.provider }]

  if (firstModel)
    return {
      state: { ...state, step: { kind: "models", selectedModel: firstModel, collapsed: {} } },
      effects: announce,
    }

  if (state.provider === CONSOLE_INTEGRATION && connect)
    return {
      state: { ...state, step: { kind: "no-models", returnTo, catalogPending: false, connect } },
      effects: announce,
    }

  return { state: { ...state, closed: true }, effects: [...announce, { type: "dialog.close" }] }
}

function connected(
  state: ProviderState,
  event: Extract<ProviderDialogEvent, { type: "connect.result" }>,
): ProviderDialogTransition {
  const step = state.step

  if (!("connect" in step))
    return unchanged(
      state,
      wrap(event.session, event.provider, transitionProviderConnect({ status: "disposed" }, event.event)),
    )

  // Whether a lone method starts on its own depends on the step: the accounts list and the Claude Agent setup
  // wait for the user.
  const input =
    event.event.type === "integration.loaded"
      ? { ...event.event, manual: step.kind === "accounts" || step.kind === "claude" }
      : event.event

  return connectTransition(state, step, transitionProviderConnect(step.connect, input), event.catalog)
}

function toPicker(state: ProviderState): ProviderDialogTransition {
  if (state.standalone) return unchanged(state)

  return {
    state: { ...meta(state), status: "picker", session: state.session + 1 },
    effects: [...leave(state), { type: "controller.sync", provider: undefined }],
  }
}

// Stops what the provider's step left running: its sign-in, the Console wait and the Claude check timer.
function leave(state: ProviderState): ProviderDialogEffect[] {
  const step = state.step

  if (!("connect" in step)) return []
  const result = transitionProviderConnect(step.connect, { type: "disposed" })

  return [
    ...stopClaude(step),
    ...settleCancel(step.connect, result.state),
    ...wrap(state.session, state.provider, result),
  ]
}

function stopClaude(step: ProviderDialogStep): ProviderDialogEffect[] {
  return step.kind === "claude" && step.phase.status !== "idle" ? [{ type: "claude.timer.stop" }] : []
}

// The Console wait belongs to one refresh; a sign-in that leaves it before it finished stops the polling.
function settleCancel(prev: ProviderConnectState, next: ProviderConnectState): ProviderDialogEffect[] {
  if (prev.status !== "refreshing" || next.status === "connected") return []

  if (next.status === "refreshing" && next.attempt === prev.attempt) return []

  return [{ type: "settle.cancel" }]
}

function wrap(session: number, provider: string, result: ProviderConnectTransition): ProviderDialogEffect[] {
  return result.effects.flatMap((effect) =>
    effect.type === "complete" ? [] : [{ type: "connect.effect", session, provider, effect } as const],
  )
}

function current(state: ProviderDialogState, session: number) {
  return state.status === "provider" && !state.closed && state.session === session
}

function meta(state: ProviderDialogState): DialogMeta {
  return {
    session: state.session,
    attempt: state.attempt,
    standalone: state.standalone,
    completed: state.completed,
    chatgptWelcome: state.chatgptWelcome,
  }
}

function unchanged(
  state: ProviderDialogState,
  effects: readonly ProviderDialogEffect[] = [],
): ProviderDialogTransition {
  return { state, effects }
}
