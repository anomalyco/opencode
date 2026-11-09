import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

/** How long a failed login1 or screensaver watcher waits before trying again. */
const RETRY_MS = 30_000

export type LinuxLockSource = "login1" | "screensaver"

/** The contribution of each Linux watcher. Undefined means that watcher is not running. */
export type LinuxLockSources = {
  readonly login1?: boolean
  readonly screensaver?: boolean
}

type Login1Changed = {
  locked?: boolean
  active?: boolean
}

export interface LinuxScreenLockHint {
  close(): void
}

/** The lock value the Linux watchers report together: a lock from either source wins, and undefined means neither knows. */
export function linuxBusLocked(sources: LinuxLockSources) {
  if (sources.login1 === true || sources.screensaver === true) return true

  if (sources.login1 === false || sources.screensaver === false) return false

  return undefined
}

export function setLinuxLockSource(
  sources: LinuxLockSources,
  source: LinuxLockSource,
  locked: boolean | undefined,
): LinuxLockSources {
  if (sources[source] === locked) return sources

  return { ...sources, [source]: locked }
}

/**
 * login1 exposes the lock as `LockedHint`, and an inactive session (another user at the console) as `Active=false`.
 * `LockedHint` is authoritative; when it is absent, report nothing so another watcher can answer.
 */
export function login1Locked(locked: boolean | undefined, active: boolean | undefined) {
  if (locked === true || active === false) return true

  if (locked === false) return false

  return undefined
}

/** Reads a gdbus PropertiesChanged line, deliberately line-scoped and limited to login1's session interface. */
export function parseLogin1Changed(line: string): Login1Changed {
  if (!line.includes("org.freedesktop.DBus.Properties.PropertiesChanged")) return {}

  if (!line.includes("org.freedesktop.login1.Session")) return {}

  const start = line.indexOf("{")
  const end = line.lastIndexOf("}")

  if (start < 0 || end <= start) return {}

  const dictionary = line.slice(start + 1, end)
  const values: Login1Changed = {}
  const pattern = /(["'])(LockedHint|Active)\1\s*:\s*<(true|false)>/g

  for (let match = pattern.exec(dictionary); match; match = pattern.exec(dictionary)) {
    const value = match[3] === "true"

    if (match[2] === "LockedHint") values.locked = value

    if (match[2] === "Active") values.active = value
  }

  return values
}

/** Reads the `(<true>,)` or `(<false>,)` gdbus Properties.Get reply. */
export function parseGdbusBoolean(output: string) {
  const value = output.match(/\b(true|false)\b/)?.[1]

  return value === undefined ? undefined : value === "true"
}

export function parseScreensaverLine(line: string) {
  if (/\bUNBLANK\b/.test(line)) return false

  if (/\bLOCK\b/.test(line)) return true

  return undefined
}

/**
 * Best-effort Linux lock detection. login1/elogind and xscreensaver watch independently, and each report is cleared
 * when its watcher stops, so a dead monitor cannot hold the screen locked. The caller keeps its idle fallback either way.
 */
export function watchLinuxScreenLock(onChange: (locked: boolean | undefined) => void): LinuxScreenLockHint {
  let sources: LinuxLockSources = {}
  let last: boolean | undefined
  let closed = false
  let login1Child: ReturnType<typeof spawn> | undefined
  let screensaverChild: ReturnType<typeof spawn> | undefined
  let login1Timer: ReturnType<typeof setTimeout> | undefined
  let screensaverTimer: ReturnType<typeof setTimeout> | undefined

  const publish = () => {
    const next = linuxBusLocked(sources)

    if (next === last) return
    last = next
    onChange(next)
  }

  const update = (source: LinuxLockSource, locked: boolean | undefined) => {
    sources = setLinuxLockSource(sources, source, locked)
    publish()
  }

  const schedule = (timer: "login1" | "screensaver") => {
    if (closed) return

    const run = () => (timer === "login1" ? void startLogin1() : startScreensaver())

    if (timer === "login1") login1Timer = setTimeout(run, RETRY_MS).unref()
    else screensaverTimer = setTimeout(run, RETRY_MS).unref()
  }

  const startLogin1 = async () => {
    if (closed) return
    const session = await login1Session()

    if (closed) return

    if (!session) return schedule("login1")
    const [locked, active] = await Promise.all([login1Property(session, "LockedHint"), login1Property(session, "Active")])

    if (closed) return

    if (locked === undefined && active === undefined) return schedule("login1")
    update("login1", login1Locked(locked, active))

    const child = spawn(
      "gdbus",
      ["monitor", "--system", "--dest", "org.freedesktop.login1", "--object-path", session],
      { stdio: ["ignore", "pipe", "ignore"] },
    )

    login1Child = child
    let buffer = ""
    let ended = false
    let lockedNow = locked
    let activeNow = active

    child.stdout?.setEncoding("utf8")
    child.stdout?.on("data", (chunk: string) => {
      buffer += chunk
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      lines.forEach((line) => {
        const changed = parseLogin1Changed(line)

        if (changed.locked === undefined && changed.active === undefined) return

        if (changed.locked !== undefined) lockedNow = changed.locked

        if (changed.active !== undefined) activeNow = changed.active
        update("login1", login1Locked(lockedNow, activeNow))
      })
    })

    const finish = () => {
      if (ended) return
      ended = true

      if (login1Child === child) login1Child = undefined
      update("login1", undefined)
      schedule("login1")
    }

    child.on("error", finish)
    child.on("exit", finish)
  }

  const startScreensaver = () => {
    if (closed) return
    const child = spawn("xscreensaver-command", ["-watch"], { stdio: ["ignore", "pipe", "ignore"] })
    screensaverChild = child
    let buffer = ""
    let ended = false

    child.stdout?.setEncoding("utf8")
    child.stdout?.on("data", (chunk: string) => {
      buffer += chunk
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      lines.forEach((line) => {
        const locked = parseScreensaverLine(line)

        if (locked !== undefined) update("screensaver", locked)
      })
    })

    const finish = () => {
      if (ended) return
      ended = true

      if (screensaverChild === child) screensaverChild = undefined
      update("screensaver", undefined)
      schedule("screensaver")
    }

    child.on("error", finish)
    child.on("exit", finish)
  }

  const close = () => {
    if (closed) return
    closed = true
    clearTimeout(login1Timer)
    clearTimeout(screensaverTimer)
    login1Child?.kill()
    screensaverChild?.kill()
    process.off("exit", close)
  }

  process.once("exit", close)
  void startLogin1()
  startScreensaver()

  return { close }
}

async function login1Session() {
  try {
    const { stdout } = await execFileAsync(
      "gdbus",
      [
        "call",
        "--system",
        "--dest",
        "org.freedesktop.login1",
        "--object-path",
        "/org/freedesktop/login1",
        "--method",
        "org.freedesktop.login1.Manager.GetSessionByPID",
        String(process.pid),
      ],
      { timeout: 1_000 },
    )

    const match = stdout.match(/\/org\/freedesktop\/login1\/session\/[^'",)\s]+/)

    return match?.[0]
  } catch {
    return undefined
  }
}

async function login1Property(session: string, property: string) {
  try {
    const { stdout } = await execFileAsync(
      "gdbus",
      [
        "call",
        "--system",
        "--dest",
        "org.freedesktop.login1",
        "--object-path",
        session,
        "--method",
        "org.freedesktop.DBus.Properties.Get",
        "org.freedesktop.login1.Session",
        property,
      ],
      { timeout: 1_000 },
    )

    return parseGdbusBoolean(stdout)
  } catch {
    return undefined
  }
}
