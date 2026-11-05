import { expect, test } from "bun:test"
import type { ProviderAccount } from "./accounts"
import {
  availableProviders,
  connectedProviders,
  createSettingsProvidersState,
  providerAccountView,
  providerRow,
  transitionSettingsProviders,
  type SettingsProvidersEffect,
  type SettingsProvidersEvent,
  type SettingsProvidersState,
} from "./machine"

type Item = { readonly id: string }

const openai = { id: "openai" }

const opencode = { id: "opencode" }

const consoleGoogle = { id: "console-google" }

const disconnectOpenAI: SettingsProvidersEvent<Item> = {
  type: "disconnect.requested",
  providerIDs: ["openai"],
  integrationID: "openai",
  providerName: "OpenAI",
}

const disconnectConsole: SettingsProvidersEvent<Item> = {
  type: "disconnect.requested",
  providerIDs: ["opencode", "console-google"],
  integrationID: "opencode",
  providerName: "OpenCode",
}

const work: ProviderAccount = { type: "credential", id: "cred_work", label: "Work", method: "oauth" }

const personal: ProviderAccount = { type: "credential", id: "cred_personal", label: "Personal", method: "oauth" }

// The Console list before a switch, and the transient catalog in which the workspace providers dropped.
const before = [opencode, consoleGoogle, openai]

const transient = [openai]

const activate = (catalog: readonly Item[], account = personal): SettingsProvidersEvent<Item> => ({
  type: "account.activate.requested",
  integrationID: "opencode",
  providerName: "OpenCode",
  account,
  activeCredentialID: work.id,
  catalog,
})

const remove = (catalog: readonly Item[]): SettingsProvidersEvent<Item> => ({
  type: "account.remove.requested",
  integrationID: "opencode",
  providerName: "OpenCode",
  account: work,
  final: false,
  catalog,
})

function replay(events: SettingsProvidersEvent<Item>[], state = createSettingsProvidersState<Item>()) {
  return events.reduce<{ state: SettingsProvidersState<Item>; effects: SettingsProvidersEffect[] }>(
    (current, event) => {
      const result = transitionSettingsProviders(current.state, event)

      return { state: result.state, effects: [...current.effects, ...result.effects] }
    },
    { state, effects: [] },
  )
}

test("a disconnect with no stored credentials returns the provider to the Connected list", () => {
  const removing = replay([disconnectOpenAI])

  expect(connectedProviders(removing.state, [openai])).toEqual([])
  expect(removing.effects).toEqual([{ type: "disconnect.run", attempt: 1, integrationID: "openai" }])

  const failed = replay([
    disconnectOpenAI,
    { type: "disconnect.failed", attempt: 1, reason: { kind: "no-credentials" } },
  ])

  expect(providerRow(failed.state, "openai")).toEqual({ status: "connected" })
  expect(connectedProviders(failed.state, [openai])).toEqual([openai])
  expect(failed.effects.at(-1)).toEqual({
    type: "toast.failed",
    providerName: "OpenAI",
    reason: { kind: "no-credentials" },
  })
})

test("a failed request restores every Console provider with one toast", () => {
  const error = new Error("offline")

  const result = replay([
    disconnectConsole,
    { type: "disconnect.failed", attempt: 1, reason: { kind: "request", error } },
  ])

  expect(connectedProviders(result.state, [opencode, consoleGoogle])).toEqual([opencode, consoleGoogle])
  expect(result.effects.filter((effect) => effect.type === "toast.failed")).toEqual([
    { type: "toast.failed", providerName: "OpenCode", reason: { kind: "request", error } },
  ])
})

test("a removed provider stays hidden until the catalog drops it, then shows again when it returns", () => {
  const removed = replay([disconnectOpenAI, { type: "disconnect.succeeded", attempt: 1 }])

  expect(providerRow(removed.state, "openai").status).toBe("removed")
  expect(connectedProviders(removed.state, [openai])).toEqual([])
  expect(removed.effects.at(-1)).toEqual({ type: "toast.disconnected", providerName: "OpenAI" })

  const dropped = transitionSettingsProviders(removed.state, { type: "catalog.synced", providerIDs: [] }).state

  expect(connectedProviders(dropped, [openai])).toEqual([openai])
})

test("a removal confirmed after the catalog already dropped the provider leaves no hidden row", () => {
  const result = replay([
    disconnectOpenAI,
    { type: "catalog.synced", providerIDs: [] },
    { type: "disconnect.succeeded", attempt: 1 },
  ])

  expect(providerRow(result.state, "openai")).toEqual({ status: "connected" })
  expect(result.effects.at(-1)).toEqual({ type: "toast.disconnected", providerName: "OpenAI" })
})

test("a result for a disconnect that a reconnect superseded is ignored", () => {
  const reconnected = replay([disconnectOpenAI, { type: "provider.reconnected", providerID: "openai" }]).state

  expect(transitionSettingsProviders(reconnected, { type: "disconnect.succeeded", attempt: 1 })).toEqual({
    state: reconnected,
    effects: [],
  })
  expect(
    transitionSettingsProviders(reconnected, {
      type: "disconnect.failed",
      attempt: 1,
      reason: { kind: "no-credentials" },
    }),
  ).toEqual({ state: reconnected, effects: [] })
})

test("reconnecting the Console clears its providers only", () => {
  const result = replay([
    disconnectConsole,
    { type: "disconnect.succeeded", attempt: 1 },
    disconnectOpenAI,
    { type: "provider.reconnected", providerID: "opencode" },
  ])

  expect(connectedProviders(result.state, [opencode, consoleGoogle, openai])).toEqual([opencode, consoleGoogle])
  expect(providerRow(result.state, "openai")).toMatchObject({ status: "removing", attempt: 2 })
})

test("a second disconnect while one is running starts no request", () => {
  const removing = replay([disconnectOpenAI]).state

  expect(transitionSettingsProviders(removing, disconnectOpenAI)).toEqual({ state: removing, effects: [] })
})

test("the dialog's late catalog refresh does not unfreeze the list while an account switch runs", () => {
  const switching = replay([
    { type: "dialog.opened", catalog: before },
    { type: "dialog.closed", attempt: 1 },
    activate(transient),
    { type: "dialog.refresh.settled", attempt: 1 },
  ])

  expect(switching.effects).toEqual([
    { type: "dialog.open", attempt: 1, provider: undefined },
    { type: "catalog.refresh", attempt: 1 },
    { type: "account.activate.run", attempt: 2, integrationID: "opencode", providerName: "OpenCode", account: personal },
  ])
  expect(availableProviders(switching.state, transient)).toEqual(before)
  expect(providerAccountView(switching.state).busy).toBe(true)

  const settled = transitionSettingsProviders(switching.state, { type: "account.settled", attempt: 2 }).state
  expect(availableProviders(settled, transient)).toEqual(transient)
  expect(providerAccountView(settled).busy).toBe(false)
})

test("a finished account action does not unfreeze the list behind an open connect dialog", () => {
  const open = replay([activate(before), { type: "dialog.opened", provider: "anthropic", catalog: transient }])

  expect(open.effects.at(-1)).toEqual({ type: "dialog.open", attempt: 2, provider: "anthropic" })

  const settled = replay([{ type: "account.settled", attempt: 1 }], open.state)
  expect(availableProviders(settled.state, transient)).toEqual(before)
  expect(providerAccountView(settled.state).busy).toBe(false)

  const closed = replay(
    [
      { type: "dialog.closed", attempt: 2 },
      { type: "dialog.refresh.settled", attempt: 2 },
    ],
    settled.state,
  )

  expect(closed.state.status).toBe("live")
  expect(availableProviders(closed.state, transient)).toEqual(transient)
})

test("a closed dialog's refresh does not release a dialog opened after it", () => {
  const second = replay([
    { type: "dialog.opened", catalog: before },
    { type: "dialog.closed", attempt: 1 },
    { type: "dialog.opened", catalog: transient },
  ]).state

  expect(transitionSettingsProviders(second, { type: "dialog.refresh.settled", attempt: 1 }).state).toBe(second)
  expect(transitionSettingsProviders(second, { type: "dialog.closed", attempt: 1 }).state).toBe(second)
  expect(availableProviders(second, transient)).toEqual(before)
})

test("an account action closes a rename and blocks renames and other account actions until it settles", () => {
  const renaming = replay([{ type: "account.rename.started", credentialID: work.id }]).state
  expect(providerAccountView(renaming)).toEqual({ busy: false, renaming: work.id })

  const busy = transitionSettingsProviders(renaming, activate(before)).state
  expect(providerAccountView(busy)).toEqual({ busy: true, renaming: undefined })

  for (const event of [
    { type: "account.rename.started", credentialID: work.id },
    activate(before),
    remove(before),
    { type: "account.settled", attempt: 99 },
  ] satisfies SettingsProvidersEvent<Item>[])
    expect(transitionSettingsProviders(busy, event)).toEqual({ state: busy, effects: [] })

  const done = transitionSettingsProviders(busy, { type: "account.settled", attempt: 1 }).state
  expect(done).toEqual({ status: "live", rows: {}, nextAttempt: 2, renaming: undefined })
  expect(transitionSettingsProviders(done, remove(before)).effects).toEqual([
    {
      type: "account.remove.run",
      attempt: 2,
      integrationID: "opencode",
      providerName: "OpenCode",
      account: work,
      final: false,
    },
  ])
})

test("switching to the account that is already active starts nothing", () => {
  const live = createSettingsProvidersState<Item>()

  expect(transitionSettingsProviders(live, activate(before, work))).toEqual({ state: live, effects: [] })
})

test("a disconnect toast still reports while the list is held", () => {
  const result = replay([
    { type: "dialog.opened", catalog: before },
    disconnectOpenAI,
    { type: "disconnect.succeeded", attempt: 2 },
  ])

  expect(result.state.status).toBe("holding")
  expect(result.effects.at(-1)).toEqual({ type: "toast.disconnected", providerName: "OpenAI" })
})
