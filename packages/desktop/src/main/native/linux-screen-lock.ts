import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

/**
 * A Linux lock hint from logind/elogind, or the X11 screensaver watcher. It reports only changes; the caller keeps its
 * own fallback idle probe. `undefined` means neither is available, not that the screen is unlocked.
 */
export interface LinuxScreenLockHint {
  close(): void
}

/** Best-effort Linux lock detection for desktops whose idle state does not expose the lock. */
export async function watchLinuxScreenLock(onChange: (locked: boolean) => void): Promise<LinuxScreenLockHint | undefined> {
  const session = await login1Session()

  if (session) {
    const hint = await login1Hint(session, onChange)

    if (hint) return hint
  }

  return screensaver(onChange)
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

async function login1Hint(session: string, onChange: (locked: boolean) => void) {
  const query = (property: string) =>
    execFileAsync(
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

  const [locked, active] = await Promise.all([
    query("LockedHint")
      .then((result) => readBoolean(result.stdout))
      .catch(() => undefined),
    query("Active")
      .then((result) => readBoolean(result.stdout))
      .catch(() => undefined),
  ])

  if (locked === undefined && active === undefined) return undefined
  let lockedHint = locked ?? false
  let activeSession = active ?? true
  onChange(!activeSession || lockedHint)

  const child = spawn(
    "dbus-monitor",
    [
      "--system",
      `type='signal',interface='org.freedesktop.DBus.Properties',member='PropertiesChanged',path='${session}'`,
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  )

  let buffer = ""
  let property: string | undefined

  child.stdout?.setEncoding("utf8")
  child.stdout?.on("data", (chunk: string) => {
    buffer += chunk
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    lines.forEach((line) => {
      const name = line.match(/string "(LockedHint|Active)"/)?.[1]

      if (name) {
        property = name

        return
      }

      if (!property) return

      const value = line.match(/boolean (true|false)/)?.[1]

      if (!value) return

      const next = value === "true"

      if (property === "LockedHint") lockedHint = next

      if (property === "Active") activeSession = next
      property = undefined
      onChange(!activeSession || lockedHint)
    })
  })

  child.on("error", () => child.kill())
  const stop = () => child.kill()
  process.once("exit", stop)

  return {
    close() {
      process.off("exit", stop)
      child.kill()
    },
  }
}

function readBoolean(output: string) {
  const value = output.match(/boolean (true|false)/)?.[1]

  return value === undefined ? undefined : value === "true"
}

function screensaver(onChange: (locked: boolean) => void) {
  const child = spawn("xscreensaver-command", ["-watch"], { stdio: ["ignore", "pipe", "ignore"] })
  let buffer = ""

  child.stdout?.setEncoding("utf8")
  child.stdout?.on("data", (chunk: string) => {
    buffer += chunk
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    lines.forEach((line) => {
      if (/\bLOCK\b/.test(line)) onChange(true)

      if (/\bUNLOCK\b/.test(line)) onChange(false)
    })
  })

  child.on("error", () => child.kill())
  const stop = () => child.kill()
  process.once("exit", stop)

  return {
    close() {
      process.off("exit", stop)
      child.kill()
    },
  }
}
