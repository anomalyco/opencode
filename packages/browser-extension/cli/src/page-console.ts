// Patchright never enables CDP's Runtime domain: a page can detect that domain (console arguments get inspected
// by the debugger), and bot checks do. Without it, a page's console messages and uncaught errors never reach
// execute. `pageConsole.start()` turns Runtime on for one page, through its own CDP session, when an agent needs
// those logs; that page can then tell it is being debugged, so it stays off by default.
export * as PageConsole from "./page-console.ts"
import type { CDPSession, Page } from "patchright-core"
import type { ExecuteLogEntry } from "./relay-schema.ts"

type Listener = (entry: ExecuteLogEntry) => void
type RemoteObject = { readonly type: string; readonly value?: unknown; readonly unserializableValue?: string; readonly description?: string }
type CallFrame = { readonly url: string; readonly lineNumber: number; readonly columnNumber: number }

const sessions = new WeakMap<Page, CDPSession>()
const listeners = new WeakMap<Page, Set<Listener>>()

/** Starts capturing a page's console messages and uncaught errors into execute's logs. */
export async function start(page: Page) {
  if (sessions.has(page)) return { capturing: true }
  const session = await page.context().newCDPSession(page)
  sessions.set(page, session)
  page.once("close", () => sessions.delete(page))
  // Enabling Runtime first replays what the page logged earlier; only what happens from now on is new.
  let live = false
  session.on("Runtime.consoleAPICalled", (event: { type: string; args: RemoteObject[]; stackTrace?: { callFrames: CallFrame[] } }) => {
    if (!live) return
    const frame = event.stackTrace?.callFrames[0]
    emit(page, {
      source: "page",
      type: event.type,
      text: event.args.map(describe).join(" "),
      ...(frame ? { location: { url: frame.url, lineNumber: frame.lineNumber, columnNumber: frame.columnNumber } } : {}),
    })
  })
  session.on("Runtime.exceptionThrown", (event: { exceptionDetails: { text: string; exception?: RemoteObject } }) => {
    if (!live) return
    emit(page, { source: "page", type: "pageerror", text: event.exceptionDetails.exception?.description ?? event.exceptionDetails.text })
  })
  await session.send("Runtime.enable")
  live = true
  return { capturing: true }
}

/** Stops capturing, so the page no longer sees a debugger. */
export async function stop(page: Page) {
  const session = sessions.get(page)
  sessions.delete(page)
  if (!session) return { capturing: false }
  await session.send("Runtime.disable").catch(() => undefined)
  await session.detach().catch(() => undefined)
  return { capturing: false }
}

export function capturing(page: Page) {
  return sessions.has(page)
}

/** Receives a page's captured entries while registered; registering doesn't start a capture. */
export function listen(page: Page, listener: Listener) {
  const set = listeners.get(page) ?? new Set<Listener>()
  listeners.set(page, set)
  set.add(listener)
  return () => set.delete(listener)
}

function emit(page: Page, entry: ExecuteLogEntry) {
  for (const listener of listeners.get(page) ?? []) listener(entry)
}

function describe(arg: RemoteObject) {
  if (arg.value !== undefined) return typeof arg.value === "string" ? arg.value : JSON.stringify(arg.value)
  return arg.unserializableValue ?? arg.description ?? arg.type
}
