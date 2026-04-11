import "../../src/server/projectors"
import { Database } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { MessageV2 } from "../../src/session/message-v2"
import { Session } from "../../src/session"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { ProjectID } from "../../src/project/schema"
import { ProjectTable } from "../../src/project/project.sql"
import { Installation } from "../../src/installation"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { SyncEvent } from "../../src/sync"
import { Instance } from "../../src/project/instance"
import path from "path"

type Msg = {
  mode: "sharded" | "global"
  idx: number
  dir: string
  file: string
  msgs: number
  updates: number
}

type Out = {
  idx: number
  mode: "sharded" | "global"
  session: SessionID
  started: number
  ended: number
  global: number[]
  shard: number[]
  errors: string[]
  counts: {
    created: number
    updated: number
    messages: number
    parts: number
  }
}

await Log.init({ print: false })

const input = JSON.parse(process.argv[2] ?? "{}") as Msg
const out: Out = {
  idx: input.idx,
  mode: input.mode,
  session: SessionID.descending(),
  started: Date.now(),
  ended: 0,
  global: [],
  shard: [],
  errors: [],
  counts: {
    created: 0,
    updated: 0,
    messages: 0,
    parts: 0,
  },
}

function fail(err: unknown) {
  if (err instanceof Error) {
    const code = "code" in err && typeof err.code === "string" ? ` ${err.code}` : ""
    return `${err.name}${code}: ${err.message}`
  }
  return String(err)
}

function time<T>(list: number[], fn: () => T) {
  const at = performance.now()
  const result = fn()
  list.push(Number((performance.now() - at).toFixed(3)))
  return result
}

function info(id: SessionID, pid: ProjectID) {
  const now = Date.now()
  return {
    id,
    slug: `load-${input.idx}`,
    projectID: pid,
    directory: path.join(input.dir, `session-${input.idx}`),
    title: `load-${input.idx}`,
    version: Installation.VERSION,
    time: {
      created: now,
      updated: now,
    },
  } satisfies Session.Info
}

function msg(id: SessionID, n: number) {
  const mid = MessageID.ascending()
  const now = Date.now()
  const info: MessageV2.User = {
    id: mid,
    sessionID: id,
    role: "user",
    time: { created: now },
    agent: `worker-${input.idx}`,
    model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
    tools: {},
  }
  const part: MessageV2.TextPart = {
    id: PartID.ascending(),
    sessionID: id,
    messageID: mid,
    type: "text",
    text: `load-${input.idx}-${n}`,
  }
  return { info, part, now }
}

function patch(n: number) {
  return {
    title: `load-${input.idx}-${n}`,
    time: {
      updated: Date.now(),
    },
  }
}

try {
  await Instance.provide({
    directory: input.dir,
    fn: async () => {
      const pid = ProjectID.make(`project-load-${input.idx}`)
      const session = SessionID.make(out.session)
      const row = info(session, pid)

      const now = Date.now()
      Database.transaction((tx) => {
        tx.insert(ProjectTable)
          .values({
            id: pid,
            worktree: row.directory,
            time_created: now,
            time_updated: now,
            sandboxes: [],
          })
          .onConflictDoNothing()
          .run()
      })

      time(out.global, () => {
        SyncEvent.run(Session.Event.Created, {
          sessionID: session,
          info: row,
        })
      })
      out.counts.created += 1

      if (input.mode === "sharded") {
        Database.session(session)
        for (let i = 0; i < input.msgs; i++) {
          const item = msg(session, i)
          time(out.shard, () => {
            SyncEvent.run(MessageV2.Event.Updated, {
              sessionID: session,
              info: item.info,
            })
            SyncEvent.run(MessageV2.Event.PartUpdated, {
              sessionID: session,
              part: item.part,
              time: item.now,
            })
          })
          out.counts.messages += 1
          out.counts.parts += 1
        }
      }

      for (let i = 0; i < input.updates; i++) {
        time(out.global, () => {
          SyncEvent.run(Session.Event.Updated, {
            sessionID: session,
            info: patch(i),
          })
        })
        out.counts.updated += 1
      }
    },
  })
} catch (err) {
  out.errors.push(fail(err))
} finally {
  out.ended = Date.now()
  try {
    Database.close()
  } catch {}
}

await Bun.write(Bun.stdout, JSON.stringify(out))

process.exit(out.errors.length ? 1 : 0)
