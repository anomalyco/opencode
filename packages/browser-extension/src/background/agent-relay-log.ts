// A small structured debug log for the OpenCode Browser relay link: connects, closes, reconnect backoff,
// commands with their durations, and errors. The last entries stay in memory and in chrome.storage.session
// (so they survive a service worker restart), and the status page copies them as diagnostics for bug reports.

export type AgentRelayLogEntry = {
  /** Milliseconds since the epoch. */
  t: number
  event: string
  [field: string]: string | number | boolean | undefined
}

const KEY = "agentRelayLog"
const LIMIT = 500
const FLUSH_DELAY = 1_000

export function createAgentRelayLog() {
  let entries: AgentRelayLogEntry[] = []
  let flush: ReturnType<typeof setTimeout> | undefined
  // Entries from before a worker restart come first; anything logged while they load stays after them.
  const loaded = chrome.storage.session
    .get(KEY)
    .then((stored) => {
      const previous = (stored[KEY] ?? []) as AgentRelayLogEntry[]
      entries = [...previous, ...entries].slice(-LIMIT)
    })
    .catch(() => undefined)

  const persist = () => {
    flush = undefined
    void chrome.storage.session.set({ [KEY]: entries }).catch(() => undefined)
  }

  return {
    add(event: string, fields: Omit<AgentRelayLogEntry, "t" | "event"> = {}) {
      const entry: AgentRelayLogEntry = { t: Date.now(), event }
      for (const [key, value] of Object.entries(fields)) if (value !== undefined) entry[key] = value
      entries.push(entry)
      if (entries.length > LIMIT) entries.splice(0, entries.length - LIMIT)
      flush ??= setTimeout(persist, FLUSH_DELAY)
    },
    async entries() {
      await loaded
      return entries.slice()
    },
  }
}

export type AgentRelayLog = ReturnType<typeof createAgentRelayLog>

/** One line per entry: an ISO time, the event, then its fields as key=value. */
export function formatAgentRelayLog(entries: AgentRelayLogEntry[]) {
  return entries
    .map(({ t, event, ...fields }) =>
      [
        new Date(t).toISOString(),
        event,
        ...Object.entries(fields).map(([key, value]) =>
          typeof value === "string" && /[\s"=]/.test(value) ? `${key}=${JSON.stringify(value)}` : `${key}=${value}`,
        ),
      ].join(" "),
    )
    .join("\n")
}
