import { expect, test } from "bun:test"
import {
  connectedProviders,
  createProviderDisconnectState,
  providerRow,
  transitionProviderDisconnect,
  type ProviderDisconnectEffect,
  type ProviderDisconnectEvent,
  type ProviderDisconnectState,
} from "./machine"

const openai = { id: "openai" }

const opencode = { id: "opencode" }

const consoleGoogle = { id: "console-google" }

const disconnectOpenAI: ProviderDisconnectEvent = {
  type: "disconnect.requested",
  providerIDs: ["openai"],
  integrationID: "openai",
  providerName: "OpenAI",
}

const disconnectConsole: ProviderDisconnectEvent = {
  type: "disconnect.requested",
  providerIDs: ["opencode", "console-google"],
  integrationID: "opencode",
  providerName: "OpenCode",
}

function replay(events: ProviderDisconnectEvent[]) {
  return events.reduce<{ state: ProviderDisconnectState; effects: ProviderDisconnectEffect[] }>(
    (current, event) => {
      const result = transitionProviderDisconnect(current.state, event)

      return { state: result.state, effects: [...current.effects, ...result.effects] }
    },
    { state: createProviderDisconnectState(), effects: [] },
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

  const dropped = transitionProviderDisconnect(removed.state, { type: "catalog.synced", providerIDs: [] }).state

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

  expect(transitionProviderDisconnect(reconnected, { type: "disconnect.succeeded", attempt: 1 })).toEqual({
    state: reconnected,
    effects: [],
  })
  expect(
    transitionProviderDisconnect(reconnected, {
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

  expect(transitionProviderDisconnect(removing, disconnectOpenAI)).toEqual({ state: removing, effects: [] })
})
