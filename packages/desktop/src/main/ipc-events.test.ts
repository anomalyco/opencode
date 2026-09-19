import { expect, test } from "bun:test"
import { Effect } from "effect"
import { DeepLinksOpened } from "../shared/ipc-rpc/events"
import { bindIpcEvents, emitIpcEvent } from "./ipc-events"

test("reports whether a renderer can receive an event", async () => {
  const sender = { id: 42 }
  const event = new DeepLinksOpened({ urls: ["opencode://session/123"] })

  expect(emitIpcEvent(sender, event)).toBe(false)
  const unbind = await Effect.runPromise(bindIpcEvents(sender.id))
  expect(emitIpcEvent(sender, event)).toBe(true)
  await Effect.runPromise(unbind)
  expect(emitIpcEvent(sender, event)).toBe(false)
})
