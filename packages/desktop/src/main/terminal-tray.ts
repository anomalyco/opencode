import { app, Menu, shell } from "electron"
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/service"
import { TerminalTray } from "@opencode/schema/terminal-tray"
import { Schema } from "effect"
import { readFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { createTrayIcons } from "./native/tray-icons"
import { getTrayEnabled, initializeTray, setTrayEnabled, setTraySessions, startTray } from "./native/tray"
import { loadTraySessions, type TraySession } from "./native/tray-sessions"
import { trayTabs } from "./native/tray-tabs"

const decodeConnection = Schema.decodeUnknownSync(Schema.fromJsonString(TerminalTray.Connection))
const decodeSnapshot = Schema.decodeUnknownSync(TerminalTray.Snapshot)

type Terminal = {
  owner: number
  connection: TerminalTray.Connection
  snapshot?: TerminalTray.Snapshot
  rows: TraySession[]
  loaded: number
  signature?: string
  changed: number
  offline: boolean
}

export async function runTerminalTray() {
  app.setName("OpenCode")
  app.setPath(
    "userData",
    process.env.OPENCODE_DESKTOP_TEST_ROOT
      ? join(process.env.OPENCODE_DESKTOP_TEST_ROOT, "terminal-tray")
      : join(app.getPath("appData"), app.isPackaged ? "ai.opencode.terminal-tray" : "ai.opencode.terminal-tray.dev"),
  )
  await mkdir(app.getPath("userData"), { recursive: true })
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }
  const terminals = new Map<string, Terminal>()
  const controller = new AbortController()
  const runtime = { owner: -1, timer: undefined as ReturnType<typeof setTimeout> | undefined }
  const attach = async (argv: string[]) => {
    const file = argv.find((arg) => arg.startsWith("--terminal-tray="))?.slice("--terminal-tray=".length)
    if (!file) return
    const connection = decodeConnection(await readFile(file, "utf8"))
    if (terminals.has(connection.id)) return
    terminals.set(connection.id, {
      owner: runtime.owner--,
      connection,
      rows: [],
      loaded: 0,
      changed: Date.now(),
      offline: false,
    })
  }
  app.on("second-instance", (_event, argv) => {
    void attach(argv).catch(() => console.warn("Could not attach terminal tray connection"))
  })
  await attach(process.argv)
  if (!terminals.size) {
    app.quit()
    return
  }
  await app.whenReady()
  if (process.platform === "darwin") app.dock?.hide()
  Menu.setApplicationMenu(null)
  // The terminal's tray.enabled preference owns opt-out in this mode.
  setTrayEnabled(true)
  const stopInitial = initializeTray()
  const icons = await createTrayIcons()
  const active = () =>
    [...terminals.values()]
      .filter((terminal) => terminal.snapshot?.enabled)
      .sort((a, b) => Number(b.snapshot?.focused) - Number(a.snapshot?.focused) || b.changed - a.changed)
  const send = (command: TerminalTray.Command, terminal = active()[0]) => {
    if (!terminal) return
    void fetch(`${terminal.connection.url}/command`, {
      method: "POST",
      headers: { authorization: `Bearer ${terminal.connection.token}`, "content-type": "application/json" },
      body: JSON.stringify(command),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]),
    }).catch(() => console.warn("Could not deliver terminal tray action"))
  }
  const stop = startTray(
    {
      open: () => send({ type: "focus" }),
      trigger: (id) => send({ type: id === "tab.new" ? "new" : "settings" }),
      session: (key) => {
        const terminal = active().find((terminal) => terminal.rows.some((row) => row.id === key))
        if (!terminal?.snapshot) return
        send({ type: "session", sessionID: key.slice(terminal.snapshot.server.url.length + 1) }, terminal)
      },
      docs: () => {
        void shell.openExternal("https://opencode.ai/v2/docs/")
      },
      quit: () => app.quit(),
    },
    icons,
  )
  app.on("before-quit", () => {
    controller.abort()
    clearTimeout(runtime.timer)
    stop()
    stopInitial()
  })
  const poll = async () => {
    await Promise.all(
      [...terminals].map(async ([id, terminal]) => {
        const snapshot = await fetch(`${terminal.connection.url}/state`, {
          headers: { authorization: `Bearer ${terminal.connection.token}` },
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]),
        })
          .then(async (response) => {
            if (!response.ok) throw new Error("Terminal unavailable")
            return decodeSnapshot(await response.json())
          })
          .catch(() => undefined)
        if (!snapshot) {
          terminals.delete(id)
          trayTabs.remove(terminal.owner)
          return
        }
        if (snapshot.current !== terminal.snapshot?.current || snapshot.focused !== terminal.snapshot?.focused)
          terminal.changed = Date.now()
        terminal.snapshot = snapshot
        const keys = snapshot.enabled ? snapshot.sessions.map((id) => `${snapshot.server.url}\n${id}`) : []
        trayTabs.set(terminal.owner, keys)
        terminal.rows = terminal.rows.filter((row) => keys.includes(row.id))
        if (!snapshot.enabled) return
        const signature = JSON.stringify([snapshot.server, snapshot.sessions])
        if (signature === terminal.signature && Date.now() - terminal.loaded < 10_000) return
        terminal.signature = signature
        terminal.loaded = Date.now()
        const client = OpenCode.make({ baseUrl: snapshot.server.url, headers: Service.headers(snapshot.server) })
        const result = await loadTraySessions(
          client,
          snapshot.sessions,
          AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        ).catch(() => undefined)
        terminal.offline = !result
        if (result)
          terminal.rows = result.sessions.map((session) => ({
            ...session,
            id: `${snapshot.server.url}\n${session.id}`,
          }))
      }),
    )
    if (controller.signal.aborted) return
    if (!terminals.size) {
      app.quit()
      return
    }
    const enabled = active()
    if (!enabled.length) {
      app.quit()
      return
    }
    if (getTrayEnabled() !== !!enabled.length) setTrayEnabled(!!enabled.length)
    const sessions = [...new Map(enabled.flatMap((terminal) => terminal.rows).map((row) => [row.id, row])).values()]
    sessions.sort(
      (a, b) =>
        Number(b.status === "permission" || b.status === "question") -
        Number(a.status === "permission" || a.status === "question"),
    )
    await icons.prepare(sessions, AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]))
    if (controller.signal.aborted) return
    setTraySessions({
      state: enabled.some((terminal) => terminal.offline) ? "offline" : "ready",
      sessions,
      attention: 0,
      working: 0,
      more: false,
    })
  }
  const refresh = () => {
    void poll()
      .catch(() => console.warn("Could not refresh terminal tray"))
      .finally(() => {
        if (!controller.signal.aborted) runtime.timer = setTimeout(refresh, 1000)
      })
  }
  refresh()
}
