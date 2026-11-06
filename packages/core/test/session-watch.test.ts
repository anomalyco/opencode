import { expect } from "bun:test"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { KV } from "@opencode/core/kv"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionTeam } from "@opencode/core/session/team"
import { SessionWatch } from "@opencode/core/session/watch"
import { promptLocationNode } from "./fixture/prompt-location"
import { globalProjectNode } from "./lib/project"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      SessionWatch.node,
      SessionTeam.node,
      Session.node,
      SessionInbox.node,
      KV.node,
      Database.node,
    ]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      Project.node.replace(globalProjectNode),
      LocationServiceMap.node.replace(promptLocationNode),
      SessionExecution.node.replace(SessionExecution.noopLayer),
    ],
  ),
)

it.live("watch notifies target with member name and stopped ID", () =>
  Effect.gen(function* () {
    const watches = yield* SessionWatch.Service
    const sessions = yield* Session.Service
    const inbox = yield* SessionInbox.Service
    const directory = AbsolutePath.make("/project")
    const target = yield* sessions.create({ location: { directory } })
    const member = yield* sessions.create({ location: { directory } })
    yield* watches.save(target.id, {
      members: [member.id],
      text: "{member} stopped",
      enabled: true,
    })
    const targets = yield* watches.stopped(member.id)
    expect(targets).toEqual([target.id])
    const pending = yield* inbox.list(target.id)
    expect(pending).toHaveLength(1)
    expect(pending[0]?.delivery).toBe("steer")
    expect(pending[0]?.payload).toMatchObject({
      text: expect.stringContaining("stopped"),
      metadata: { stoppedMemberID: member.id },
    })
  }),
)
