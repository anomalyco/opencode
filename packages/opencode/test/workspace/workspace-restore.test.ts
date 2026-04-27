import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { GlobalBus } from "../../src/bus/global"
import { registerAdaptor } from "../../src/control-plane/adaptors"
import type { WorkspaceAdaptor } from "../../src/control-plane/types"
import { Workspace } from "../../src/control-plane/workspace"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Flag } from "@opencode-ai/core/flag/flag"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Instance } from "../../src/project/instance"
import { Session as SessionNs } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { Database, asc, eq } from "../../src/storage"
import { SyncEvent } from "../../src/sync"
import { EventTable } from "../../src/sync/event.sql"
import { Log } from "../../src/util"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const original = Flag.OPENCODE_EXPERIMENTAL_WORKSPACES

beforeEach(() => {
  Database.close()
  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
})

afterEach(async () => {
  mock.restore()
  await Instance.disposeAll()
  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = original
  await resetDatabase()
})

function create(input?: SessionNs.CreateInput) {
  return AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.create(input)))
}

function get(id: SessionID) {
  return AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.get(id)))
}

function updateMessage<T extends MessageV2.Info>(msg: T) {
  return AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.updateMessage(msg)))
}

function updatePart<T extends MessageV2.Part>(part: T) {
  return AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.updatePart(part)))
}

async function user(sessionID: SessionID, text: string) {
  const msg = await updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
    time: { created: Date.now() },
  })
  await updatePart({
    id: PartID.ascending(),
    sessionID,
    messageID: msg.id,
    type: "text",
    text,
  })
}

function remote(dir: string, url: string): WorkspaceAdaptor {
  return {
    name: "remote",
    description: "remote",
    configure(info) {
      return {
        ...info,
        directory: dir,
      }
    },
    async create() {
      await fs.mkdir(dir, { recursive: true })
    },
    async remove() {},
    target() {
      return {
        type: "remote" as const,
        url,
      }
    },
  }
}

function local(dir: string): WorkspaceAdaptor {
  return {
    name: "local",
    description: "local",
    configure(info) {
      return {
        ...info,
        directory: dir,
      }
    },
    async create() {
      await fs.mkdir(dir, { recursive: true })
    },
    async remove() {},
    target() {
      return {
        type: "local" as const,
        directory: dir,
      }
    },
  }
}

function eventStreamResponse() {
  return new Response(new ReadableStream({ start() {} }), {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
    },
  })
}

describe("Workspace.sessionRestore", () => {
  test("replays session events in batches of 10 and emits progress", async () => {
    await using tmp = await tmpdir({ git: true })
    const dir = path.join(tmp.path, ".restore")
    const seen: any[] = []
    const posts: Array<{
      path: string
      body: { directory: string; events: Array<{ seq: number; aggregateID: string }> }
    }> = []
    const on = (evt: any) => seen.push(evt)
    GlobalBus.on("event", on)

    const raw = globalThis.fetch
    spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: URL | RequestInfo, init?: BunFetchRequestInit | RequestInit) => {
          const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url)
          if (url.pathname === "/base/global/event") {
            return eventStreamResponse()
          }
          if (url.pathname === "/base/sync/history") {
            return Response.json([])
          }
          const body = JSON.parse(String(init?.body))
          posts.push({
            path: url.pathname,
            body,
          })
          return Response.json({ sessionID: body.events[0].aggregateID })
        },
        {
          preconnect: raw.preconnect?.bind(raw),
        },
      ) as typeof globalThis.fetch,
    )

    try {
      const setup = await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          registerAdaptor(Instance.project.id, "worktree", remote(dir, "https://workspace.test/base"))
          const space = await Workspace.create({
            type: "worktree",
            branch: null,
            extra: null,
            projectID: Instance.project.id,
          })
          const session = await create({})
          for (let i = 0; i < 6; i++) {
            await user(session.id, `msg ${i}`)
          }
          const rows = Database.use((db) =>
            db
              .select({ seq: EventTable.seq })
              .from(EventTable)
              .where(eq(EventTable.aggregate_id, session.id))
              .orderBy(asc(EventTable.seq))
              .all(),
          )
          const result = await Workspace.sessionRestore({
            workspaceID: space.id,
            sessionID: session.id,
          })
          return { space, session, rows, result }
        },
      })

      expect(setup.rows).toHaveLength(13)
      expect(setup.result).toEqual({ total: 2 })
      expect(posts).toHaveLength(2)
      expect(posts[0]?.path).toBe("/base/sync/replay")
      expect(posts[1]?.path).toBe("/base/sync/replay")
      expect(posts[0]?.body.directory).toBe(dir)
      expect(posts[1]?.body.directory).toBe(dir)
      expect(posts[0]?.body.events).toHaveLength(10)
      expect(posts[1]?.body.events).toHaveLength(4)
      expect(posts.flatMap((item) => item.body.events.map((event) => event.seq))).toEqual([
        ...setup.rows.map((row) => row.seq),
        setup.rows.at(-1)!.seq + 1,
      ])
      expect(posts[1]?.body.events.at(-1)).toMatchObject({
        aggregateID: setup.session.id,
        seq: setup.rows.at(-1)!.seq + 1,
        type: SyncEvent.versionedType(SessionNs.Event.Updated.type, SessionNs.Event.Updated.version),
        data: {
          sessionID: setup.session.id,
          info: {
            workspaceID: setup.space.id,
          },
        },
      })

      const restore = seen.filter(
        (evt) => evt.workspace === setup.space.id && evt.payload.type === Workspace.Event.Restore.type,
      )
      expect(restore.map((evt) => evt.payload.properties.step)).toEqual([0, 1, 2])
      expect(restore.map((evt) => evt.payload.properties.total)).toEqual([2, 2, 2])
      expect(restore.map((evt) => evt.payload.properties.sessionID)).toEqual([
        setup.session.id,
        setup.session.id,
        setup.session.id,
      ])
    } finally {
      GlobalBus.off("event", on)
    }
  })

  test("replays locally without posting to a server", async () => {
    await using tmp = await tmpdir({ git: true })
    const dir = path.join(tmp.path, ".restore-local")
    const seen: any[] = []
    const on = (evt: any) => seen.push(evt)
    GlobalBus.on("event", on)

    const fetch = spyOn(globalThis, "fetch")
    const replayAll = spyOn(SyncEvent, "replayAll")

    try {
      const setup = await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          registerAdaptor(Instance.project.id, "local-restore", local(dir))
          const space = await Workspace.create({
            type: "local-restore",
            branch: null,
            extra: null,
            projectID: Instance.project.id,
          })
          const session = await create({})
          for (let i = 0; i < 6; i++) {
            await user(session.id, `msg ${i}`)
          }
          const result = await Workspace.sessionRestore({
            workspaceID: space.id,
            sessionID: session.id,
          })
          const updated = await get(session.id)
          return { space, session, result, updated }
        },
      })

      expect(setup.result).toEqual({ total: 2 })
      expect(fetch).not.toHaveBeenCalled()
      expect(replayAll).toHaveBeenCalledTimes(2)
      expect(setup.updated.workspaceID).toBe(setup.space.id)

      const restore = seen.filter(
        (evt) => evt.workspace === setup.space.id && evt.payload.type === Workspace.Event.Restore.type,
      )
      expect(restore.map((evt) => evt.payload.properties.step)).toEqual([0, 1, 2])
    } finally {
      GlobalBus.off("event", on)
    }
  })
})
