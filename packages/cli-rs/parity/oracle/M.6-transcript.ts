// Differential oracle for mini's transcript: runs each case through TypeScript's createSessionTransport and prints
// the commits it appends and the footer state after each event. Usage: bun M.6-transcript.ts <cases.json>
// A case is { thinking, tools, active, history, inbox, events }; the output is one { commits, states } per case.
import { createSessionTransport } from "../../../tui/src/mini/stream-v2.transport"

type Case = {
  thinking: boolean
  tools: boolean
  active: boolean
  history: unknown[]
  inbox: unknown[]
  events: any[]
}

function feed() {
  const values: any[] = []
  let closed = false
  let wake: (() => void) | undefined
  const stream = (async function* () {
    while (!closed || values.length > 0) {
      if (values.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve
        })
        continue
      }
      yield values.shift()
    }
  })()
  const poke = () => {
    wake?.()
    wake = undefined
  }
  return {
    stream,
    push(value: unknown) {
      values.push(value)
      poke()
    },
    close() {
      closed = true
      poke()
    },
  }
}

// The transport waits 250 ms before it reconnects; the oracle does not.
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = ((fn: () => void, ms?: number, ...rest: unknown[]) =>
  realSetTimeout(fn, ms === 250 ? 0 : ms, ...rest)) as typeof setTimeout

const ok = <T>(data: T) => Promise.resolve(data)

function client(input: Case, list: () => unknown[], inbox: () => unknown[], subscribe: () => AsyncGenerator) {
  const location = { directory: "/tmp", project: { id: "proj_1", directory: "/tmp" } }
  return {
    event: { subscribe },
    message: {
      list: (request: any) => ok({ data: request.sessionID === "ses_1" ? list().toReversed() : [], cursor: {} }),
    },
    permission: { list: () => ok([]) },
    form: { list: () => ok({ location, data: [] }) },
    experimental: { session: { wait: () => ok(undefined) } },
    model: { default: () => ok({ location, data: undefined }) },
    session: {
      active: () => ok(input.active ? { ses_1: { type: "running" } } : {}),
      inbox: { list: (request: any) => ok(request.sessionID === "ses_1" ? inbox() : []) },
      form: { list: () => ok([]) },
      message: { get: () => Promise.reject(new Error("no message")) },
      get: () => Promise.reject(new Error("no session")),
      list: () => ok({ location, data: [] }),
      interrupt: () => ok(undefined),
    },
  }
}

const strip = (commit: any) => ({
  kind: commit.kind,
  source: commit.source,
  phase: commit.phase,
  text: commit.text.toWellFormed(),
  messageID: commit.messageID ?? null,
  partID: commit.partID ?? null,
  tool: commit.tool ?? null,
  toolState: commit.toolState ?? null,
  toolError: commit.toolError ?? null,
  shell: commit.shell?.command ?? null,
  image: commit.image ?? null,
  compaction: commit.compaction === true,
})

async function run(input: Case) {
  const feeds = [feed()]
  let subscription = 0
  let history = input.history
  let inbox = input.inbox
  const commits: any[] = []
  const states: any[] = []
  const rows: any[] = []
  let state: { phase: string; status: string; usage: unknown } = { phase: "idle", status: "", usage: null }
  let wake: (() => void) | undefined
  const api = {
    isClosed: false,
    onPrompt: () => () => {},
    onClose: () => () => {},
    event(next: any) {
      if (next.type !== "stream.patch") return
      const patch = next.patch
      state = {
        phase: patch.phase ?? state.phase,
        status: typeof patch.status === "string" ? patch.status : state.status,
        usage: "usage" in patch ? (patch.usage ?? null) : state.usage,
      }
    },
    append(commit: any) {
      commits.push(strip(commit))
    },
    idle: () => Promise.resolve(),
    close() {},
    destroy() {},
  }
  // The runtime's rememberLocal.
  const remember = (commit: any) => {
    const last = rows.at(-1)
    if (
      last &&
      (commit.kind === "assistant" || commit.kind === "reasoning") &&
      last.commit.kind === commit.kind &&
      last.commit.source === commit.source &&
      last.commit.messageID === commit.messageID &&
      last.commit.partID === commit.partID &&
      last.commit.tool === commit.tool
    ) {
      rows[rows.length - 1] = { commit }
      return
    }
    rows.push({ commit })
    if (rows.length > 100) rows.shift()
  }
  let sentinels = 0
  const sentinel = () => ({
    id: `evt_sentinel${sentinels++}`,
    created: 0,
    type: "session.renamed",
    durable: { aggregateID: "ses_1", seq: 0, version: 1 },
    data: { sessionID: "ses_1", title: "\u0000sentinel" },
  })
  // Waits until the transport applied everything pushed before a sentinel.
  const settle = async (push: (value: unknown) => void) => {
    const done = new Promise<void>((resolve) => (wake = resolve))
    push(sentinel())
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([done, new Promise((resolve) => (timer = realSetTimeout(resolve, 2000)))])
    clearTimeout(timer)
  }
  const snapshot = () => states.push({ commits: commits.length, ...state })
  feeds[0]!.push({ id: "evt_connected", type: "server.connected", data: {} })
  const current = () => feeds.at(-1)!
  const ready = settle((value) => current().push(value))
  const transport = await createSessionTransport({
    sdk: client(
      input,
      () => history,
      () => inbox,
      () => feeds[subscription++]!.stream,
    ) as never,
    sessionID: "ses_1",
    thinking: input.thinking,
    tools: input.tools,
    replay: true,
    footer: api as never,
    onCommit: remember,
    onSessionTitle: (title) => {
      if (title === "\u0000sentinel") wake?.()
    },
  })
  await ready
  snapshot()
  for (const event of input.events) {
    if (event.type === "@resize") {
      history = event.history
      inbox = event.inbox
      await transport.replayOnResize({ localRows: () => rows, reset: async () => {} })
      snapshot()
      continue
    }
    if (event.type === "@reconnect") {
      history = event.history
      inbox = event.inbox
      const previous = current()
      feeds.push(feed())
      current().push({ id: "evt_connected", type: "server.connected", data: {} })
      const done = settle((value) => current().push(value))
      previous.close()
      await done
      snapshot()
      continue
    }
    current().push(event)
    await settle((value) => current().push(value))
    snapshot()
  }
  await transport.close()
  return { commits, states }
}

const cases: Case[] = await Bun.file(process.argv[2]!).json()
const results = []
for (const input of cases) {
  try {
    results.push(await run(input))
  } catch (error) {
    results.push({ error: String(error) })
  }
}
process.stdout.write(JSON.stringify(results))
