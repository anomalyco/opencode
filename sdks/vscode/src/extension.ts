// This method is called when your extension is deactivated
export function deactivate() {}

import * as vscode from "vscode"
import WebSocket from "ws"
import { exec } from "child_process"

const TERMINAL_NAME = "opencode"
// Keep in sync with packages/opencode/src/server/shared/pty-ticket.ts
const PTY_CONNECT_TOKEN_HEADER = "x-opencode-ticket"
const PTY_CONNECT_TOKEN_HEADER_VALUE = "1"
const PTY_CONNECT_TICKET_QUERY = "ticket"

// Ports of opencode servers started by this extension, most recent first.
const opencodePorts: number[] = []

// PTY sessions this extension already auto-attached, so we don't re-open them.
const autoOpened = new Set<string>()

const POLL_MS = 2000
let pollTimer: ReturnType<typeof setInterval> | undefined

type PtySession = {
  id: string
  title: string
  command: string
  status: "running" | "exited"
}

/**
 * Bridges a server-side PTY session (the `terminal` tool the agent opens) into a
 * real VS Code terminal. Output is streamed from the server WebSocket into the
 * terminal; keystrokes the user types (e.g. an ssh password) are forwarded back.
 */
class PtyProxy implements vscode.Pseudoterminal {
  private readonly writeEmitter = new vscode.EventEmitter<string>()
  private readonly closeEmitter = new vscode.EventEmitter<number | void>()
  private socket: WebSocket | undefined

  readonly onDidWrite = this.writeEmitter.event
  readonly onDidClose = this.closeEmitter.event

  constructor(
    private readonly base: string,
    private readonly ptyID: string,
  ) {}

  open() {
    void this.connect()
  }

  private async connect() {
    try {
      const token = await fetch(`${this.base}/pty/${this.ptyID}/connect-token`, {
        method: "POST",
        headers: { [PTY_CONNECT_TOKEN_HEADER]: PTY_CONNECT_TOKEN_HEADER_VALUE },
      })
      if (!token.ok) {
        this.writeEmitter.fire(`Failed to open interactive terminal (HTTP ${token.status})\r\n`)
        this.close()
        return
      }
      const { ticket } = (await token.json()) as { ticket: string }
      const wsUrl =
        this.base.replace(/^http/, "ws") +
        `/pty/${this.ptyID}/connect?${PTY_CONNECT_TICKET_QUERY}=${encodeURIComponent(ticket)}&cursor=-1`
      const socket = new WebSocket(wsUrl)
      this.socket = socket
      socket.on("message", (data) => this.onMessage(data))
      socket.on("close", () => this.closeEmitter.fire())
      socket.on("error", () => this.closeEmitter.fire())
    } catch (error) {
      this.writeEmitter.fire(`Failed to connect to interactive terminal: ${String(error)}\r\n`)
      this.close()
    }
  }

  private onMessage(data: WebSocket.RawData) {
    // The first control frame is a 0x00 byte followed by UTF-8 JSON holding the
    // absolute output cursor; it mirrors no output, so skip it.
    const buffer = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data)
    if (buffer.length > 0 && buffer[0] === 0) return
    this.writeEmitter.fire(buffer.toString("utf-8"))
  }

  handleInput(data: string) {
    this.socket?.send(data)
  }

  setDimensions({ columns, rows }: vscode.TerminalDimensions) {
    // Resize travels over the REST API, not the WS input channel (input frames
    // are raw keystrokes only).
    void fetch(`${this.base}/pty/${this.ptyID}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ size: { cols: columns, rows: rows } }),
    })
  }

  close() {
    try {
      this.socket?.close()
    } catch {}
    this.socket = undefined
    this.closeEmitter.fire()
  }
}

export function activate(context: vscode.ExtensionContext) {
  // Interactive terminal sessions we have already surfaced to the user, so we
  // only auto-attach each PTY once.
  const attachedPtyIDs = new Set<string>()
  const watchers = new Map<number, ReturnType<typeof setInterval>>()

  const openNewTerminalDisposable = vscode.commands.registerCommand("opencode.openNewTerminal", async () => {
    await openTerminal()
  })

  const openTerminalDisposable = vscode.commands.registerCommand("opencode.openTerminal", async () => {
    // An opencode terminal already exists => focus it
    const existingTerminal = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME)
    if (existingTerminal) {
      existingTerminal.show()
      return
    }

    await openTerminal()
  })

  const addFilepathDisposable = vscode.commands.registerCommand("opencode.addFilepathToTerminal", async () => {
    const fileRef = getActiveFile()
    if (!fileRef) {
      return
    }

    const terminal = vscode.window.activeTerminal
    if (!terminal) {
      return
    }

    if (terminal.name === TERMINAL_NAME) {
      // @ts-ignore
      const port = terminal.creationOptions.env?.["_EXTENSION_OPENCODE_PORT"]
      port ? await appendPrompt(parseInt(port), fileRef) : terminal.sendText(fileRef, false)
      terminal.show()
    }
  })

  const attachInteractiveDisposable = vscode.commands.registerCommand("opencode.attachInteractiveTerminal", async () => {
    await attachInteractiveTerminal()
  })

  context.subscriptions.push(
    openNewTerminalDisposable,
    openTerminalDisposable,
    addFilepathDisposable,
    attachInteractiveDisposable,
  )

  // Continuously discover any local opencode server (regardless of how it was
  // started) and watch its PTYs, so agent-created interactive terminals
  // auto-attach without the user doing anything.
  const discoverTimer = setInterval(async () => {
    for (const port of await discoverOpenCodePorts()) registerPort(port)
  }, 3_000)
  context.subscriptions.push(new vscode.Disposable(() => clearInterval(discoverTimer)))

  function registerPort(port: number) {
    const existing = opencodePorts.indexOf(port)
    if (existing !== -1) opencodePorts.splice(existing, 1)
    opencodePorts.unshift(port)
    startPtyWatcher(port)
  }

  // Auto-attach new PTY sessions created by the agent (e.g. the `terminal`
  // tool) into a real VS Code terminal as soon as they appear.
  function startPtyWatcher(port: number) {
    if (watchers.has(port)) return
    watchers.set(
      port,
      setInterval(() => {
        void watchOnce(port)
      }, 2000),
    )
    void watchOnce(port)
  }

  async function watchOnce(port: number) {
    const base = `http://localhost:${port}`
    let sessions: PtySession[]
    try {
      const res = await fetch(`${base}/pty`)
      if (!res.ok) return
      sessions = (await res.json()) as PtySession[]
    } catch {
      return
    }
    for (const session of sessions) {
      if (session.status !== "running" || attachedPtyIDs.has(session.id)) continue
      attachedPtyIDs.add(session.id)
      const terminal = vscode.window.createTerminal({
        name: `opencode PTY ${session.id.slice(-4)}`,
        iconPath: {
          light: vscode.Uri.file(context.asAbsolutePath("images/button-dark.svg")),
          dark: vscode.Uri.file(context.asAbsolutePath("images/button-light.svg")),
        },
        pty: new PtyProxy(base, session.id),
        location: {
          viewColumn: vscode.ViewColumn.Beside,
          preserveFocus: false,
        },
      })
      terminal.show()
    }
  }

  async function openTerminal() {
    // Create a new terminal in split screen
    const port = Math.floor(Math.random() * (65535 - 16384 + 1)) + 16384
    const terminal = vscode.window.createTerminal({
      name: TERMINAL_NAME,
      iconPath: {
        light: vscode.Uri.file(context.asAbsolutePath("images/button-dark.svg")),
        dark: vscode.Uri.file(context.asAbsolutePath("images/button-light.svg")),
      },
      location: {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: false,
      },
      env: {
        _EXTENSION_OPENCODE_PORT: port.toString(),
        OPENCODE_CALLER: "vscode",
      },
    })

    terminal.show()
    terminal.sendText(`opencode --port ${port}`)

    const fileRef = getActiveFile()
    if (!fileRef) {
      return
    }

    // Wait for the terminal to be ready
    let tries = 10
    let connected = false
    do {
      await new Promise((resolve) => setTimeout(resolve, 200))
      try {
        await fetch(`http://localhost:${port}/app`)
        connected = true
        break
      } catch {}

      tries--
    } while (tries > 0)

    if (connected) registerPort(port)

    // If connected, append the prompt to the terminal
    if (connected) {
      await appendPrompt(port, `In ${fileRef}`)
      terminal.show()
    }
  }

  async function attachInteractiveTerminal() {
    const known = opencodePorts[0]
    const port = known !== undefined ? known : (await discoverOpenCodePorts())[0]
    if (port === undefined) {
      vscode.window.showErrorMessage(
        "No opencode server found. Open opencode (Ctrl+Esc / command palette 'Open opencode') first.",
      )
      return
    }
    registerPort(port)
    const base = `http://localhost:${port}`
    let sessions: PtySession[]
    try {
      const res = await fetch(`${base}/pty`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      sessions = (await res.json()) as PtySession[]
    } catch (error) {
      vscode.window.showErrorMessage(`Could not list interactive terminals: ${String(error)}`)
      return
    }
    const running = sessions.filter((session) => session.status === "running")
    if (running.length === 0) {
      vscode.window.showInformationMessage(
        "No interactive terminal is running. Ask the agent to open one with the terminal tool first.",
      )
      return
    }

    let ptyID: string
    if (running.length === 1) {
      ptyID = running[0].id
    } else {
      const picked = await vscode.window.showQuickPick(
        running.map((session) => ({
          label: session.title,
          description: session.command,
          detail: session.id,
        })),
        { placeHolder: "Which interactive terminal to attach?" },
      )
      if (!picked) return
      ptyID = picked.detail!
    }

    const session = running.find((s) => s.id === ptyID)
    const terminal = vscode.window.createTerminal({
      name: `opencode PTY ${ptyID.slice(-4)}`,
      iconPath: {
        light: vscode.Uri.file(context.asAbsolutePath("images/button-dark.svg")),
        dark: vscode.Uri.file(context.asAbsolutePath("images/button-light.svg")),
      },
      pty: new PtyProxy(base, ptyID),
      location: {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: false,
      },
    })
    if (session) terminal.sendText(`\u001b]0;${session.command}\u0007`, false)
    terminal.show()
  }
}

async function appendPrompt(port: number, text: string) {
  await fetch(`http://localhost:${port}/tui/append-prompt`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  })
}

// Discover which local opencode server a PTY belongs to without relying on
// extension-created terminals: scan listening ports for a /pty that answers JSON.
function listListeningPorts(): Promise<number[]> {
  return new Promise((resolve) => {
    exec("netstat -ano -p tcp", { encoding: "utf8" }, (error, stdout) => {
      if (error) return resolve([])
      const ports = new Set<number>()
      for (const line of stdout.split(/\r?\n/)) {
        const match = /TCP\s+\S+:(\d+)\s+\S+\s+LISTENING/i.exec(line)
        if (match) {
          const parsed = Number(match[1])
          if (parsed > 16384) ports.add(parsed)
        }
      }
      resolve([...ports])
    })
  })
}

async function discoverOpenCodePorts(): Promise<number[]> {
  const ports = await listListeningPorts()
  // Probe all candidates concurrently with a short timeout so discovery stays
  // within a second instead of serializing across dozens of ports.
  const results = await Promise.allSettled(
    ports.map(async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/pty`, { signal: AbortSignal.timeout(600) })
      if (!res.ok) throw new Error(String(res.status))
      const contentType = res.headers.get("content-type") ?? ""
      if (!contentType.includes("application/json")) throw new Error("not opencode")
      return port
    }),
  )
  return results.filter((result) => result.status === "fulfilled").map((result) => result.value)
}

function getActiveFile() {
  const activeEditor = vscode.window.activeTextEditor
  if (!activeEditor) {
    return
  }

  const document = activeEditor.document
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
  if (!workspaceFolder) {
    return
  }

  // Get the relative path from workspace root
  const relativePath = vscode.workspace.asRelativePath(document.uri)
  let filepathWithAt = `@${relativePath}`

  // Check if there's a selection and add line numbers
  const selection = activeEditor.selection
  if (!selection.isEmpty) {
    // Convert to 1-based line numbers
    const startLine = selection.start.line + 1
    const endLine = selection.end.line + 1

    if (startLine === endLine) {
      // Single line selection
      filepathWithAt += `#L${startLine}`
    } else {
      // Multi-line selection
      filepathWithAt += `#L${startLine}-${endLine}`
    }
  }

  return filepathWithAt
}
