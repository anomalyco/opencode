import { expect, test } from "bun:test"
import {
  createProviderDialogState,
  selectProviderDialogView,
  transitionProviderDialog,
  type ProviderAccounts,
  type ProviderCatalogSnapshot,
  type ProviderDialogEffect,
  type ProviderDialogEvent,
  type ProviderDialogState,
} from "./dialog-machine"
import type { ProviderAuthorization, ProviderConnectEvent, ProviderConnectMethod } from "./machine"

const key: ProviderConnectMethod = { type: "key", label: "API key" }

const oauth: ProviderConnectMethod = { id: "device", type: "oauth", label: "Sign in" }

const external: ProviderConnectMethod = { id: "claude-login", type: "external", label: "Claude Code login" }

const none: ProviderAccounts = { count: 0, activeID: undefined, problem: false }

const accounts = (count: number, problem = false): ProviderAccounts => ({
  count,
  activeID: count > 0 ? "cred_1" : undefined,
  problem,
})

const authorization = (attemptID: string): ProviderAuthorization => ({
  attemptID,
  url: `https://auth.example.test/device?user_code=${attemptID}`,
  instructions: "",
  mode: "auto",
  time: { created: 0, expires: 1 },
})

type Run = { state: ProviderDialogState; effects: ProviderDialogEffect[] }

function replay(
  events: ProviderDialogEvent[],
  from: ProviderDialogState = createProviderDialogState({ standalone: false }),
) {
  return events.reduce<Run>(
    (result, event) => {
      const next = transitionProviderDialog(result.state, event)

      return { state: next.state, effects: [...next.effects] }
    },
    { state: from, effects: [] },
  )
}

const selected = (provider: string, fromPicker: boolean, list = none): ProviderDialogEvent => ({
  type: "provider.selected",
  provider,
  fromPicker,
  accounts: list,
})

function provider(state: ProviderDialogState) {
  if (state.status !== "provider") throw new Error(`expected a provider step, got ${state.status}`)

  return state
}

// Builds a sign-in result the way the driver does: tagged with the session and provider of the effect that asked.
function result(state: ProviderDialogState, event: ProviderConnectEvent, catalog?: ProviderCatalogSnapshot) {
  const current = provider(state)

  return {
    type: "connect.result",
    session: current.session,
    provider: current.provider,
    event,
    catalog,
  } satisfies ProviderDialogEvent
}

const loaded = (state: ProviderDialogState, methods: ProviderConnectMethod[]) =>
  result(state, { type: "integration.loaded", attempt: 0, catalog: { methods }, manual: false })

type SignInEffect = Extract<ProviderDialogEffect, { type: "connect.effect" }>["effect"]

function connectEffect<K extends SignInEffect["type"]>(effects: readonly ProviderDialogEffect[], type: K) {
  const found = effects
    .flatMap((effect): SignInEffect[] => (effect.type === "connect.effect" ? [effect.effect] : []))
    .find((effect): effect is Extract<SignInEffect, { type: K }> => effect.type === type)

  if (!found) throw new Error(`expected a ${type} effect`)

  return found
}

const types = (effects: readonly ProviderDialogEffect[]) =>
  effects.map((effect) => (effect.type === "connect.effect" ? `connect.${effect.effect.type}` : effect.type))

// Picks `provider` with a lone OAuth method and waits on its browser sign-in.
function waitingOAuth(name: string, methods = [oauth]) {
  const picked = replay([selected(name, true)])
  const started = replay([loaded(picked.state, methods)], picked.state)
  const start = connectEffect(started.effects, "start")

  return replay(
    [result(started.state, { type: "oauth.started", attempt: start.attempt, authorization: authorization("att_1") })],
    started.state,
  )
}

// Signs in to the Console with OAuth until the catalogs refresh; returns the refresh attempt.
function refreshingConsole() {
  const opened = replay([selected("opencode", false)])
  const choosing = replay([loaded(opened.state, [oauth, key])], opened.state)
  const started = replay([{ type: "connect.input", event: { type: "method.selected", index: 0 } }], choosing.state)
  const start = connectEffect(started.effects, "start")

  const waiting = replay(
    [result(started.state, { type: "oauth.started", attempt: start.attempt, authorization: authorization("att_1") })],
    started.state,
  )

  const poll = connectEffect(waiting.effects, "poll")

  const refreshing = replay(
    [result(waiting.state, { type: "polled", attempt: poll.attempt, outcome: { status: "complete" } })],
    waiting.state,
  )

  return { ...refreshing, attempt: connectEffect(refreshing.effects, "refresh").attempt }
}

function consoleWithoutModels(pending: boolean) {
  const refreshing = refreshingConsole()

  return replay(
    [
      result(
        refreshing.state,
        { type: "refresh.succeeded", attempt: refreshing.attempt },
        { pending, firstModel: undefined },
      ),
    ],
    refreshing.state,
  )
}

// Opens a connected Claude Agent from the list and adds an account, which shows the setup.
function claudeSetup(list = accounts(1)) {
  const picked = replay([selected("claude-agent", true, list)])

  return replay([loaded(picked.state, [external]), { type: "account.add" }], picked.state)
}

// Runs a Claude Agent check until the server's check of `claude` is the only thing left.
function claudeChecking(from: Run) {
  const started = replay([{ type: "claude.check", replacing: ["cred_1"] }], from.state)
  const start = connectEffect(started.effects, "start")
  const saved = replay([result(started.state, { type: "external.saved", attempt: start.attempt })], started.state)
  const refresh = connectEffect(saved.effects, "refresh")

  return replay(
    [
      result(
        saved.state,
        { type: "refresh.succeeded", attempt: refresh.attempt },
        { pending: false, firstModel: undefined },
      ),
    ],
    saved.state,
  )
}

function claudeCheck(state: ProviderDialogState) {
  const step = provider(state).step

  if (step.kind !== "claude" || step.phase.status === "idle") throw new Error("expected a Claude check")

  return step.phase.check
}

test("Back from a pending OAuth sign-in to the provider list allows backdrop dismiss again and cancels the attempt", () => {
  const waiting = waitingOAuth("github-copilot")
  expect(selectProviderDialogView(waiting.state).preventBackdropDismiss).toBe(true)

  const back = replay([{ type: "back" }], waiting.state)

  expect(back.state.status).toBe("picker")
  expect(selectProviderDialogView(back.state).preventBackdropDismiss).toBe(false)
  expect(connectEffect(back.effects, "cancel")).toEqual({ type: "cancel", target: "oauth", attemptID: "att_1" })
  expect(back.effects).toContainEqual({ type: "controller.sync", provider: undefined })
})

test("Back from a Console connection without models returns to the sign-in methods", () => {
  const empty = consoleWithoutModels(false)
  expect(selectProviderDialogView(empty.state).body).toEqual({
    kind: "no-models",
    catalogPending: false,
    refreshing: false,
  })
  expect(types(empty.effects)).toEqual(["connected.notify", "models.reveal", "toast.connected"])

  const methods = replay([{ type: "back" }], empty.state)
  expect(selectProviderDialogView(methods.state).body).toEqual({ kind: "methods" })
  expect(selectProviderDialogView(methods.state).canBack).toBe(true)

  expect(replay([{ type: "back" }], methods.state).state.status).toBe("picker")
})

test("Back from a failed Console refresh returns to the sign-in methods", () => {
  const empty = consoleWithoutModels(true)
  const refreshing = replay([{ type: "connect.input", event: { type: "refresh" } }], empty.state)
  expect(selectProviderDialogView(refreshing.state).body).toEqual({
    kind: "no-models",
    catalogPending: true,
    refreshing: true,
  })
  const attempt = connectEffect(refreshing.effects, "refresh").attempt

  const failed = replay(
    [result(refreshing.state, { type: "refresh.failed", attempt, error: "Could not refresh" })],
    refreshing.state,
  )

  expect(selectProviderDialogView(failed.state).body).toEqual({ kind: "failed" })
  expect(selectProviderDialogView(failed.state).title).toBe("console-error")

  expect(selectProviderDialogView(replay([{ type: "back" }], failed.state).state).body).toEqual({ kind: "methods" })
})

test("Back during the Console workspace wait stops the wait", () => {
  const refreshing = refreshingConsole()
  const back = replay([{ type: "back" }], refreshing.state)

  expect(back.effects).toContainEqual({ type: "settle.cancel" })
  expect(selectProviderDialogView(back.state).body).toEqual({ kind: "methods" })
})

test("Back from a Claude Agent check started from Add account returns to the accounts", () => {
  const setup = claudeSetup()
  expect(selectProviderDialogView(setup.state).body.kind).toBe("claude")

  const started = replay([{ type: "claude.check", replacing: ["cred_1"] }], setup.state)
  const start = connectEffect(started.effects, "start")
  expect(selectProviderDialogView(started.state).canBack).toBe(true)

  const back = replay([{ type: "back" }], started.state)
  expect(selectProviderDialogView(back.state).frame).toBe("accounts")

  // The server still saves the connection, so its late result only reloads the catalogs.
  const late = replay([result(back.state, { type: "external.saved", attempt: start.attempt })], back.state)
  expect(late.state).toBe(back.state)
  expect(types(late.effects)).toEqual(["connect.sync"])
})

test("a Claude Agent check replaces the accounts it was started with", () => {
  const checking = claudeChecking(claudeSetup())

  expect(selectProviderDialogView(checking.state).body).toMatchObject({ kind: "claude", checking: true })
  expect(checking.effects).toContainEqual({ type: "claude.replace", credentialIDs: ["cred_1"] })
  expect(checking.effects).toContainEqual(
    expect.objectContaining({ type: "claude.timer.start", check: claudeCheck(checking.state), timeoutMs: 65_000 }),
  )
})

test("leaving a Claude Agent check ignores its late confirmation", () => {
  const checking = claudeChecking(claudeSetup(none))
  const confirming = replay([{ type: "claude.status.changed", hasProblem: false, hasModels: true }], checking.state)
  const check = claudeCheck(confirming.state)
  const session = provider(confirming.state).session
  expect(confirming.effects).toContainEqual({ type: "claude.confirm", session, check })

  const back = replay([{ type: "back" }], confirming.state)
  expect(back.state.status).toBe("picker")
  expect(back.effects).toContainEqual({ type: "claude.timer.stop" })

  const late = replay(
    [{ type: "claude.confirmed", session, check, hasProblem: false, firstModel: "claude-agent:sonnet" }],
    back.state,
  )

  expect(late.state).toBe(back.state)
  expect(late.effects).toEqual([])
})

test("a new Claude Agent check ignores the confirmation of the one it replaced", () => {
  const confirming = replay(
    [{ type: "claude.status.changed", hasProblem: false, hasModels: true }],
    claudeChecking(claudeSetup(none)).state,
  )

  const first = claudeCheck(confirming.state)
  const session = provider(confirming.state).session
  const idle = replay([{ type: "claude.status.changed", hasProblem: true, hasModels: true }], confirming.state)
  const again = replay([{ type: "claude.check", replacing: [] }], idle.state)
  expect(claudeCheck(again.state)).not.toBe(first)

  const late = replay(
    [{ type: "claude.confirmed", session, check: first, hasProblem: false, firstModel: "claude-agent:sonnet" }],
    again.state,
  )

  expect(late.state).toBe(again.state)
})

test("a Claude Agent check that outlives its timeout still finishes", () => {
  const checking = claudeChecking(claudeSetup(none))
  const check = claudeCheck(checking.state)
  const session = provider(checking.state).session
  const timedOut = replay([{ type: "claude.timed-out", session, check }], checking.state)
  expect(selectProviderDialogView(timedOut.state).body).toMatchObject({
    kind: "claude",
    checking: false,
    timedOut: true,
  })

  const done = replay(
    [
      { type: "claude.status.changed", hasProblem: false, hasModels: true },
      { type: "claude.confirmed", session, check, hasProblem: false, firstModel: "claude-agent:sonnet" },
    ],
    timedOut.state,
  )

  expect(selectProviderDialogView(done.state).body).toEqual({
    kind: "models",
    selectedModel: "claude-agent:sonnet",
    collapsed: {},
  })
  expect(types(done.effects)).toEqual(["models.reveal", "toast.connected"])
})

test("a second Remove click sends one request, and a late final removal after Back does not close the dialog", () => {
  const picked = replay([selected("openai", true, accounts(2))])
  const listed = replay([loaded(picked.state, [key])], picked.state)

  const removing = replay(
    [
      { type: "account.remove.prompted", accountID: "cred_2" },
      { type: "account.remove.confirmed", accountID: "cred_2" },
    ],
    listed.state,
  )

  const remove = removing.effects.find((effect) => effect.type === "account.remove")

  if (remove?.type !== "account.remove") throw new Error("expected an account.remove effect")
  expect(selectProviderDialogView(removing.state).body).toMatchObject({ kind: "accounts", busy: true, canAdd: false })

  const second = replay([{ type: "account.remove.confirmed", accountID: "cred_2" }], removing.state)
  expect(second.state).toBe(removing.state)
  expect(second.effects).toEqual([])

  const back = replay([{ type: "back" }], removing.state)

  const late = replay(
    [
      { type: "accounts.synced", accounts: none },
      { type: "account.remove.settled", session: remove.session, attempt: remove.attempt },
    ],
    back.state,
  )

  expect(late.state).toBe(back.state)
  expect(late.effects).toEqual([])
})

test("removing the last account closes the dialog once the removal settles", () => {
  const picked = replay([selected("openai", true, accounts(1))])

  const removing = replay(
    [
      loaded(picked.state, [key]),
      { type: "account.remove.prompted", accountID: "cred_1" },
      { type: "account.remove.confirmed", accountID: "cred_1" },
    ],
    picked.state,
  )

  const remove = removing.effects.find((effect) => effect.type === "account.remove")

  if (remove?.type !== "account.remove") throw new Error("expected an account.remove effect")
  expect(remove.final).toBe(true)

  // The refresh inside the removal lists no accounts before the removal settles; the list stays until then.
  const synced = replay([{ type: "accounts.synced", accounts: none }], removing.state)
  expect(selectProviderDialogView(synced.state).frame).toBe("accounts")

  const settled = replay(
    [{ type: "account.remove.settled", session: remove.session, attempt: remove.attempt }],
    synced.state,
  )

  expect(settled.effects).toEqual([{ type: "dialog.close" }])
  expect(replay([{ type: "back" }], settled.state).state).toBe(settled.state)
})

test("a switch that settles after another switch started is ignored", () => {
  const picked = replay([selected("openai", true, accounts(3))])

  const first = replay(
    [loaded(picked.state, [key]), { type: "account.activate.requested", accountID: "cred_2" }],
    picked.state,
  )

  const activate = first.effects.find((effect) => effect.type === "account.activate")

  if (activate?.type !== "account.activate") throw new Error("expected an account.activate effect")
  expect(selectProviderDialogView(first.state).body).toMatchObject({ activeID: "cred_2", busy: true })

  const stale = replay(
    [{ type: "account.activate.settled", session: activate.session, attempt: activate.attempt + 1 }],
    first.state,
  )

  expect(stale.state).toBe(first.state)

  const done = replay(
    [{ type: "account.activate.settled", session: activate.session, attempt: activate.attempt }],
    first.state,
  )

  expect(selectProviderDialogView(done.state).body).toMatchObject({ busy: false, activeID: "cred_1" })
})

test("a credential saved after the dialog moved to another provider only reloads the catalogs", () => {
  const picked = replay([selected("openrouter", true)])

  const submitting = replay(
    [loaded(picked.state, [key]), { type: "connect.input", event: { type: "entry.submitted", value: "sk-late" } }],
    picked.state,
  )

  const submit = connectEffect(submitting.effects, "submit")
  const session = provider(submitting.state).session

  const other = replay([{ type: "back" }, selected("anthropic", true)], submitting.state)

  const late = replay(
    [
      {
        type: "connect.result",
        session,
        provider: "openrouter",
        event: { type: "submit.succeeded", attempt: submit.attempt },
      },
    ],
    other.state,
  )

  expect(late.state).toBe(other.state)
  expect(late.effects).toEqual([{ type: "connect.effect", session, provider: "openrouter", effect: { type: "sync" } }])

  const opened = replay(
    [
      {
        type: "connect.result",
        session,
        provider: "openrouter",
        event: { type: "oauth.started", attempt: 1, authorization: authorization("att_late") },
      },
    ],
    other.state,
  )

  expect(opened.effects).toEqual([
    {
      type: "connect.effect",
      session,
      provider: "openrouter",
      effect: { type: "cancel", target: "oauth", attemptID: "att_late" },
    },
  ])
})

test("Refresh on a Console connection whose models were still loading continues to the models", () => {
  const empty = consoleWithoutModels(true)
  expect(types(empty.effects)).toEqual(["connected.notify", "models.reveal"])

  const refreshing = replay([{ type: "connect.input", event: { type: "refresh" } }], empty.state)
  const attempt = connectEffect(refreshing.effects, "refresh").attempt

  const models = replay(
    [
      result(
        refreshing.state,
        { type: "refresh.succeeded", attempt },
        { pending: false, firstModel: "console-google:gemini" },
      ),
    ],
    refreshing.state,
  )

  const view = selectProviderDialogView(models.state)
  expect(view.frame).toBe("models")
  expect(view.preventBackdropDismiss).toBe(false)
  expect(types(models.effects)).toEqual(["connected.notify", "models.reveal", "toast.connected"])
})

test("a connection without models closes the dialog", () => {
  const picked = replay([selected("openrouter", true)])

  const submitting = replay(
    [loaded(picked.state, [key]), { type: "connect.input", event: { type: "entry.submitted", value: "sk-1" } }],
    picked.state,
  )

  const refreshing = replay(
    [
      result(submitting.state, {
        type: "submit.succeeded",
        attempt: connectEffect(submitting.effects, "submit").attempt,
      }),
    ],
    submitting.state,
  )

  const done = replay(
    [
      result(
        refreshing.state,
        { type: "refresh.succeeded", attempt: connectEffect(refreshing.effects, "refresh").attempt },
        { pending: false, firstModel: undefined },
      ),
    ],
    refreshing.state,
  )

  expect(types(done.effects)).toEqual(["connected.notify", "models.reveal", "toast.connected", "dialog.close"])
  // The key form stays while the dialog animates out, and takes no more input.
  expect(selectProviderDialogView(done.state).body).toEqual({ kind: "key" })
  expect(replay([{ type: "back" }], done.state).state).toBe(done.state)
})

test("confirming a model closes once and keeps the outcome through disposal", () => {
  const empty = consoleWithoutModels(true)
  const refreshing = replay([{ type: "connect.input", event: { type: "refresh" } }], empty.state)

  const models = replay(
    [
      result(
        refreshing.state,
        { type: "refresh.succeeded", attempt: connectEffect(refreshing.effects, "refresh").attempt },
        { pending: false, firstModel: "opencode:big" },
      ),
      { type: "model.selected", modelKey: "opencode:small" },
    ],
    refreshing.state,
  )

  const selection = { providerID: "opencode", modelID: "small" }

  const confirmed = replay([{ type: "model.confirmed", selection }], models.state)
  expect(confirmed.effects).toEqual([{ type: "dialog.close" }, { type: "model.apply", selection }])
  expect(replay([{ type: "model.confirmed", selection }], confirmed.state).effects).toEqual([])

  const disposed = replay([{ type: "disposed" }], confirmed.state)
  expect(disposed.state).toMatchObject({ status: "disposed", completed: true })
})

test("closing the dialog during a sign-in cancels it", () => {
  const waiting = waitingOAuth("github-copilot")
  const disposed = replay([{ type: "disposed" }], waiting.state)

  expect(disposed.state.status).toBe("disposed")
  expect(types(disposed.effects)).toEqual(["connect.poll.stop", "connect.cancel"])
  expect(replay([selected("openai", true)], disposed.state).state).toBe(disposed.state)
})

test("a ChatGPT token sharing sign-in shows the welcome on close", () => {
  const sharing: ProviderConnectMethod = { id: "chatgpt-token-sharing", type: "oauth", label: "ChatGPT" }
  const waiting = waitingOAuth("openai", [sharing])
  const poll = connectEffect(waiting.effects, "poll")

  const refreshing = replay(
    [result(waiting.state, { type: "polled", attempt: poll.attempt, outcome: { status: "complete" } })],
    waiting.state,
  )

  const done = replay(
    [
      result(
        refreshing.state,
        { type: "refresh.succeeded", attempt: connectEffect(refreshing.effects, "refresh").attempt },
        { pending: false, firstModel: "openai:gpt" },
      ),
    ],
    refreshing.state,
  )

  expect(selectProviderDialogView(done.state).chatgptWelcome).toBe(true)
})

test("a lone method waits on the accounts list and starts once Add account is chosen", () => {
  const picked = replay([selected("github-copilot", true, accounts(1))])
  const listed = replay([loaded(picked.state, [oauth])], picked.state)
  expect(types(listed.effects)).toEqual([])
  expect(selectProviderDialogView(listed.state).body).toMatchObject({ kind: "accounts", canAdd: true })

  const added = replay([{ type: "account.add" }], listed.state)
  expect(types(added.effects)).toEqual(["connect.start"])

  // Back from the lone method goes straight to the accounts list.
  expect(selectProviderDialogView(replay([{ type: "back" }], added.state).state).frame).toBe("accounts")
})

test("a standalone dialog has no way back to the provider list", () => {
  const opened = replay([selected("opencode-go", false)], createProviderDialogState({ standalone: true }))
  const entering = replay([loaded(opened.state, [key])], opened.state)

  expect(selectProviderDialogView(entering.state).canBack).toBe(false)
  expect(replay([{ type: "back" }], entering.state).state).toBe(entering.state)
})

test("the Console sign-in link copy result belongs to its attempt", () => {
  const opened = replay([selected("opencode", false)])
  const choosing = replay([loaded(opened.state, [oauth, key])], opened.state)
  const started = replay([{ type: "connect.input", event: { type: "method.selected", index: 0 } }], choosing.state)

  const waiting = replay(
    [
      result(started.state, {
        type: "oauth.started",
        attempt: connectEffect(started.effects, "start").attempt,
        authorization: authorization("att_1"),
      }),
    ],
    started.state,
  )

  const session = provider(waiting.state).session

  const copied = replay([{ type: "link.copied", session, attemptID: "att_1", copied: true }], waiting.state)
  expect(selectProviderDialogView(copied.state).body).toEqual({ kind: "console-sign-in", copy: "copied" })

  const stale = replay([{ type: "link.copied", session, attemptID: "att_0", copied: false }], copied.state)
  expect(stale.state).toBe(copied.state)
})
