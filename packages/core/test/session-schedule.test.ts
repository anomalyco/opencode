import { expect } from "bun:test"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { KV } from "@opencode/core/kv"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionSchedule } from "@opencode/core/session/schedule"
import { promptLocationNode } from "./fixture/prompt-location"
import { globalProjectNode } from "./lib/project"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([SessionSchedule.node, Session.node, SessionInbox.node, KV.node]), [
    Bus.node.replace(Bus.configured({ persist: true })),
    Project.node.replace(globalProjectNode),
    LocationServiceMap.node.replace(promptLocationNode),
    SessionExecution.node.replace(SessionExecution.noopLayer),
  ]),
)

it.live("scheduled messages persist, send as steer, and support edit, pause, resume and deletion", () =>
  Effect.gen(function* () {
    const schedules = yield* SessionSchedule.Service
    const sessions = yield* Session.Service
    const inbox = yield* SessionInbox.Service
    const kv = yield* KV.Service
    const session = yield* sessions.create({ location: { directory: AbsolutePath.make("/project") } })
    const entry = yield* schedules.save(session.id, { text: "Continue working", intervalMinutes: 5, enabled: true })
    expect(yield* schedules.list(session.id)).toEqual([entry])
    expect(yield* kv.get("session.schedules")).toEqual([entry])
    const due = entry.nextAt!
    yield* schedules.sendDue(due - 1)
    expect(yield* inbox.list(session.id)).toEqual([])
    yield* schedules.sendDue(due)
    const pending = yield* inbox.list(session.id)
    expect(pending).toHaveLength(1)
    expect(pending[0]?.delivery).toBe("steer")
    expect(pending[0]?.payload).toMatchObject({ text: "Continue working", metadata: { scheduleID: entry.id } })
    expect((yield* schedules.list(session.id))[0]?.nextAt).toBe(due + 5 * 60_000)
    yield* schedules.sendDue(due)
    expect(yield* inbox.list(session.id)).toHaveLength(1)

    const paused = yield* schedules.save(
      session.id,
      { text: "Check tests", intervalMinutes: 2, enabled: false },
      entry.id,
    )
    expect(paused.nextAt).toBeNull()
    yield* schedules.sendDue(due + 60 * 60_000)
    expect(yield* inbox.list(session.id)).toHaveLength(1)
    const resumed = yield* schedules.save(
      session.id,
      { text: paused.text, intervalMinutes: paused.intervalMinutes, enabled: true },
      entry.id,
    )
    yield* schedules.sendDue(resumed.nextAt! + 60 * 60_000)
    expect(yield* inbox.list(session.id)).toHaveLength(2)
    expect((yield* inbox.list(session.id))[1]?.payload).toMatchObject({ text: "Check tests" })
    yield* schedules.remove(session.id, entry.id)
    expect(yield* schedules.list(session.id)).toEqual([])
    yield* schedules.sendDue(due + 24 * 60 * 60_000)
    expect(yield* inbox.list(session.id)).toHaveLength(2)
  }),
)
