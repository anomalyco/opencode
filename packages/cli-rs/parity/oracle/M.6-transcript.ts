// Runs each case of mini's transcript property test through TypeScript's createSessionTransport and prints the
// commits it appends and the footer's phase, status and usage after the hydration and each event.
// Usage: bun M.6-transcript.ts <cases.json>
import { createSessionTransport } from "../../../tui/src/mini/stream-v2.transport"

const realSetTimeout = globalThis.setTimeout
// The transport waits 250 ms before it reconnects; the oracle does not.
globalThis.setTimeout = ((fn: () => void, ms?: number) => realSetTimeout(fn, ms === 250 ? 0 : ms)) as typeof setTimeout

function feed() {
  const values: unknown[] = []
  let closed = false
  let wake = () => {}
  const stream = (async function* () {
    while (!closed || values.length > 0) {
      if (values.length === 0) await new Promise<void>((resolve) => (wake = resolve))
      else yield values.shift()
    }
  })()
  return {
    stream,
    push: (value: unknown) => (values.push(value), wake()),
    close: () => ((closed = true), wake()),
  }
}

async function run(input: any) {
  const feeds = [feed()]
  const list = { history: input.history, inbox: input.inbox }
  const commits: unknown[] = []
  const states: unknown[] = []
  let footer: any = { phase: "idle", status: "", usage: null }
  let settled = () => {}
  const ok = (data: unknown) => Promise.resolve(data)
  const location = { directory: "/tmp", project: { id: "proj_1", directory: "/tmp" } }
  const sdk = {
    event: { subscribe: () => feeds.at(-1)!.stream },
    message: { list: () => ok({ data: list.history.toReversed(), cursor: {} }) },
    permission: { list: () => ok([]) },
    form: { list: () => ok({ location, data: [] }) },
    session: {
      active: () => ok(input.active ? { ses_1: { type: "running" } } : {}),
      inbox: { list: () => ok(list.inbox) },
      form: { list: () => ok([]) },
      message: { get: () => Promise.reject(new Error("no message")) },
      list: () => ok({ location, data: [] }),
    },
  }
  const footerApi = {
    isClosed: false,
    onPrompt: () => () => {},
    onClose: () => () => {},
    event(next: any) {
      if (next.type !== "stream.patch") return
      footer = {
        phase: next.patch.phase ?? footer.phase,
        status: typeof next.patch.status === "string" ? next.patch.status : footer.status,
        usage: "usage" in next.patch ? (next.patch.usage ?? null) : footer.usage,
      }
    },
    append(commit: any) {
      commits.push({
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
    },
    idle: () => Promise.resolve(),
    close() {},
    destroy() {},
  }
  // A rename that marks where the events pushed before it have been applied.
  const sentinel = { id: "evt_sentinel", type: "session.renamed", data: { sessionID: "ses_1", title: "\u0000" } }
  const settle = async () => {
    const done = new Promise<void>((resolve) => (settled = resolve))
    feeds.at(-1)!.push(sentinel)
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([done, new Promise((resolve) => (timer = realSetTimeout(resolve, 2000)))])
    clearTimeout(timer)
    states.push({ commits: commits.length, ...footer })
  }
  feeds[0]!.push({ id: "evt_connected", type: "server.connected", data: {} })
  const ready = settle()
  const transport = await createSessionTransport({
    sdk: sdk as never,
    sessionID: "ses_1",
    thinking: input.thinking,
    tools: input.tools,
    replay: true,
    footer: footerApi as never,
    onSessionTitle: (title) => title === "\u0000" && settled(),
  })
  await ready
  for (const event of input.events) {
    if (event.type !== "@reconnect") {
      feeds.at(-1)!.push(event)
      await settle()
      continue
    }
    list.history = event.history
    const previous = feeds.at(-1)!
    feeds.push(feed())
    feeds.at(-1)!.push({ id: "evt_connected", type: "server.connected", data: {} })
    const done = settle()
    previous.close()
    await done
  }
  await transport.close()
  return { commits, states }
}

const results = []
for (const input of await Bun.file(process.argv[2]!).json()) results.push(await run(input))
process.stdout.write(JSON.stringify(results))
