type Nav = {
  id: string
  dir?: string
  from?: string
  to: string
  trigger?: string
  start: number
  marks: Record<string, number>
  logged: boolean
  timer?: ReturnType<typeof setTimeout>
}

const dev = import.meta.env.DEV

const key = (dir: string | undefined, to: string) => `${dir ?? ""}:${to}`

const now = () => performance.now()

const uid = () => crypto.randomUUID?.() ?? Math.random().toString(16).slice(2)

const navs = new Map<string, Nav>()
const pending = new Map<string, string>()
const active = new Map<string, string>()

const required = [
  "session:params",
  "session:data-ready",
  "session:first-turn-mounted",
  "storage:prompt-ready",
  "storage:terminal-ready",
  "storage:file-view-ready",
]

function flush(id: string, reason: "complete" | "timeout") {
  if (!dev) return
  const nav = navs.get(id)
  if (!nav) return
  if (nav.logged) return

  nav.logged = true
  if (nav.timer) clearTimeout(nav.timer)

  const baseName = nav.marks["navigate:start"] !== undefined ? "navigate:start" : "session:params"
  const base = nav.marks[baseName] ?? nav.start

  const ms = Object.fromEntries(
    Object.entries(nav.marks)
      .slice()
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, t]) => [name, Math.round((t - base) * 100) / 100]),
  )

  console.log(
    "perf.session-nav " +
      JSON.stringify({
        type: "perf.session-nav.v0",
        id: nav.id,
        dir: nav.dir,
        from: nav.from,
        to: nav.to,
        trigger: nav.trigger,
        base: baseName,
        reason,
        ms,
      }),
  )

  navs.delete(id)
}

function maybeFlush(id: string) {
  if (!dev) return
  const nav = navs.get(id)
  if (!nav) return
  if (nav.logged) return
  if (!required.every((name) => nav.marks[name] !== undefined)) return
  flush(id, "complete")
}

function ensure(id: string, data: Omit<Nav, "marks" | "logged" | "timer">) {
  const existing = navs.get(id)
  if (existing) return existing

  const nav: Nav = {
    ...data,
    marks: {},
    logged: false,
  }
  nav.timer = setTimeout(() => flush(id, "timeout"), 5000)
  navs.set(id, nav)
  return nav
}

export function navStart(input: { dir?: string; from?: string; to: string; trigger?: string }) {
  if (!dev) return

  const id = uid()
  const start = now()
  const nav = ensure(id, { ...input, id, start })
  nav.marks["navigate:start"] = start

  pending.set(key(input.dir, input.to), id)
  return id
}

export function navParams(input: { dir?: string; from?: string; to: string }) {
  if (!dev) return

  const k = key(input.dir, input.to)
  const pendingId = pending.get(k)
  if (pendingId) pending.delete(k)
  const id = pendingId ?? uid()

  const start = now()
  const nav = ensure(id, { ...input, id, start, trigger: pendingId ? "key" : "route" })
  nav.marks["session:params"] = start

  active.set(k, id)
  maybeFlush(id)
  return id
}

export function navMark(input: { dir?: string; to: string; name: string }) {
  if (!dev) return

  const id = active.get(key(input.dir, input.to))
  if (!id) return

  const nav = navs.get(id)
  if (!nav) return
  if (nav.marks[input.name] !== undefined) return

  nav.marks[input.name] = now()
  maybeFlush(id)
}
