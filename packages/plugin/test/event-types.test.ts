import { expect, test } from "bun:test"
import type { Context as EffectContext } from "../src/effect/plugin.js"
import type { Context as PromiseContext } from "../src/promise/plugin.js"

function effectSubscriptions(ctx: EffectContext) {
  ctx.event.subscribe()
  ctx.event.subscribe("config.updated")
  // @ts-expect-error server.connected is a network-only marker
  ctx.event.subscribe("server.connected")
  // @ts-expect-error plugin subscriptions select at most one event type
  ctx.event.subscribe(["config.updated"])
}

function promiseSubscriptions(ctx: PromiseContext) {
  ctx.event.subscribe()
  ctx.event.subscribe("config.updated")
  // @ts-expect-error server.connected is a network-only marker
  ctx.event.subscribe("server.connected")
  // @ts-expect-error plugin subscriptions select at most one event type
  ctx.event.subscribe(["config.updated"])
}

test("event subscription types support wildcard and one public event", () => {
  expect(effectSubscriptions).toBeFunction()
  expect(promiseSubscriptions).toBeFunction()
})
