import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

/** How long a transient login1 lookup failure waits before trying again. */
const RETRY_MS = 30_000

type Login1Changed = {
  locked?: boolean
  active?: boolean
}

export interface LinuxScreenLockHint {
  close(): void
}

/**
 * login1 exposes the lock as `LockedHint`, and an inactive session (another user at the console) as `Active=false`.
 * `LockedHint` is authoritative; when it is absent, report nothing so the idle fallback can answer.
 */
export function login1Locked(locked: boolean | undefined, active: boolean | undefined) {
  if (locked === true || active === false) return true

  if (locked === false) return false

  return undefined
}

/** Reads a session object path from a gdbus `objectpath` reply. */
export function parseLogin1SessionPath(output: string) {
  const match = output.match(/\/org\/freedesktop\/login1\/session\/[^'",)\s]+/)

  return match?.[0]
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

/**
 * Best-effort Linux lock detection through login1/elogind. Electron's idle probe remains the fallback for desktops
 * without logind or when the bus watcher is unavailable. A watcher that stops clears its own contribution.
 */
export function watchLinuxScreenLock(onChange: (locked: boolean | undefined) => void): LinuxScreenLockHint {
  let last: boolean | undefined
  let closed = false
  let child: ReturnType<typeof spawn> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const publish = (next: boolean | undefined) => {
    if (next === last) return
    last = next
    onChange(next)
  }

  const schedule = () => {
    if (closed) return

    timer = setTimeout(() => void start(), RETRY_MS).unref()
  }

  const start = async () => {
    if (closed) return
    const session = await login1Session()

    if (closed) return

    if (session.missing) return

    if (!session.path) return schedule()

    const [locked, active] = await Promise.all([
      login1Property(session.path, "LockedHint"),
      login1Property(session.path, "Active"),
    ])

    if (closed) return

    if (locked === undefined && active === undefined) return schedule()
    publish(login1Locked(locked, active))

    const monitor = spawn(
      "gdbus",
      ["monitor", "--system", "--dest", "org.freedesktop.login1", "--object-path", session.path],
      { stdio: ["ignore", "pipe", "ignore"] },
    )

    child = monitor
    let buffer = ""
    let ended = false
    let lockedNow = locked
    let activeNow = active

    monitor.stdout?.setEncoding("utf8")
    monitor.stdout?.on("data", (chunk: string) => {
      buffer += chunk
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      lines.forEach((line) => {
        const changed = parseLogin1Changed(line)

        if (changed.locked === undefined && changed.active === undefined) return

        if (changed.locked !== undefined) lockedNow = changed.locked

        if (changed.active !== undefined) activeNow = changed.active
        publish(login1Locked(lockedNow, activeNow))
      })
    })

    const finish = () => {
      if (ended) return
      ended = true

      if (child === monitor) child = undefined
      publish(undefined)
      schedule()
    }

    monitor.on("error", finish)
    monitor.on("exit", finish)
  }

  const close = () => {
    if (closed) return
    closed = true
    clearTimeout(timer)
    child?.kill()
    process.off("exit", close)
  }

  process.once("exit", close)
  void start()

  return { close }
}

async function login1Session(): Promise<{ path?: string; missing?: boolean }> {
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

    const path = parseLogin1SessionPath(stdout)

    if (path) return { path }
  } catch (cause) {
    if (missingExecutable(cause)) return { missing: true }
  }

  // `user/self` is this same user, but its Display is one seat's graphical session. On multi-seat machines this is
  // deliberately a best-effort fallback for launches whose PID lookup (systemd user@UID/app.slice) has no session.
  try {
    const { stdout } = await execFileAsync(
      "gdbus",
      [
        "call",
        "--system",
        "--dest",
        "org.freedesktop.login1",
        "--object-path",
        "/org/freedesktop/login1/user/self",
        "--method",
        "org.freedesktop.DBus.Properties.Get",
        "org.freedesktop.login1.User",
        "Display",
      ],
      { timeout: 1_000 },
    )

    return { path: parseLogin1SessionPath(stdout) }
  } catch (cause) {
    return missingExecutable(cause) ? { missing: true } : {}
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

function missingExecutable(cause: unknown) {
  return cause instanceof Error && "code" in cause && cause.code === "ENOENT"
}
