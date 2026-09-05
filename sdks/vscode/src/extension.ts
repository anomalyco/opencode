// This method is called when your extension is deactivated
export function deactivate() {
  editorContextServer?.dispose()
  editorContextServer = undefined
}
import * as vscode from "vscode"
import { WebSocketServer, WebSocket } from "ws"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import * as crypto from "crypto"

const TERMINAL_NAME = "opencode"
const MCP_PROTOCOL_VERSION = "2025-11-25"

let editorContextServer: EditorContextServer | undefined



export function activate(context: vscode.ExtensionContext) {
  // Start a WebSocket server so opencode can receive real-time editor context
  editorContextServer = new EditorContextServer(context)

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

  let addFilepathDisposable = vscode.commands.registerCommand("opencode.addFilepathToTerminal", async () => {
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

  context.subscriptions.push(openNewTerminalDisposable, openTerminalDisposable, addFilepathDisposable, editorContextServer)

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

    // If connected, append the prompt to the terminal
    if (connected) {
      await appendPrompt(port, `In ${fileRef}`)
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
}

// WebSocket server that pushes the active editor selection to opencode
// via the Claude Code IDE lock file protocol (same as Cursor / Windsurf)
class EditorContextServer implements vscode.Disposable {
  private wss: WebSocketServer | undefined
  private port: number | undefined
  private lockFilePath: string | undefined
  private authToken: string
  private clients = new Set<WebSocket>()
  private initializedClients = new Set<WebSocket>()
  private disposables: vscode.Disposable[] = []
  private lastSelectionKey = ""

  constructor(context: vscode.ExtensionContext) {
    this.authToken = crypto.randomBytes(16).toString("hex")
    this.start()
  }

  private start() {
    // Listen on a random port so opencode can discover the server via lock file
    this.wss = new WebSocketServer({ port: 0, host: "127.0.0.1" })

    this.wss.on("listening", () => {
      const address = this.wss?.address()
      if (typeof address === "object" && address) {
        this.port = address.port
        this.writeLockFile()
      }
    })

    this.wss.on("connection", (ws, req) => {
      // Validate the auth token to prevent unauthorized connections
      const authHeader = req.headers["x-claude-code-ide-authorization"]
      if (this.authToken && authHeader !== this.authToken) {
        ws.close(1008, "Unauthorized")
        return
      }

      this.clients.add(ws)

      ws.on("message", (data) => {
        this.handleMessage(ws, data.toString())
      })

      ws.on("close", () => {
        this.clients.delete(ws)
        this.initializedClients.delete(ws)
      })

      ws.on("error", () => {
        this.clients.delete(ws)
        this.initializedClients.delete(ws)
      })
    })

    this.wss.on("error", () => {})

    // Push a selection whenever the active editor or text selection changes
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.pushSelection()
      }),
      vscode.window.onDidChangeTextEditorSelection(() => {
        this.pushSelection()
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.writeLockFile()
      }),
    )

    this.pushSelection()
  }

  // Write a lock file so opencode's TUI can discover and connect to this server
  private writeLockFile() {
    const ideDir = path.join(os.homedir(), ".claude", "ide")
    try {
      if (!fs.existsSync(ideDir)) {
        fs.mkdirSync(ideDir, { recursive: true })
      }
    } catch {
      return
    }

    if (!this.port) {
      return
    }

    this.lockFilePath = path.join(ideDir, `${this.port}.lock`)

    const workspaceFolders = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath)

    const lockContent = JSON.stringify({
      authToken: this.authToken,
      transport: "ws",
      workspaceFolders,
    })

    try {
      fs.writeFileSync(this.lockFilePath, lockContent, "utf-8")
    } catch {}
  }

  // Handle JSON-RPC messages from the opencode TUI
  private handleMessage(ws: WebSocket, raw: string) {
    let message: any
    try {
      message = JSON.parse(raw)
    } catch {
      return
    }

    // Respond to the MCP initialize handshake
    if (message.method === "initialize") {
      const response = {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          serverInfo: {
            name: "vscode",
            version: "1.0.0",
          },
        },
      }
      ws.send(JSON.stringify(response))
    }

    // Mark the client as initialized so it can receive selection push events
    if (message.method === "notifications/initialized") {
      this.initializedClients.add(ws)
    }
  }

  // Push the current active editor selection to all initialized clients
  private pushSelection() {
    const activeEditor = vscode.window.activeTextEditor
    if (!activeEditor) {
      return
    }

    const document = activeEditor.document
    const filePath = document.uri.fsPath
    const selection = activeEditor.selection

    let text: string
    let startLine: number
    let startChar: number
    let endLine: number
    let endChar: number

    if (!selection.isEmpty) {
      text = document.getText(selection)
      startLine = selection.start.line + 1
      startChar = selection.start.character + 1
      endLine = selection.end.line + 1
      endChar = selection.end.character + 1
    } else {
      text = ""
      startLine = selection.start.line + 1
      startChar = selection.start.character + 1
      endLine = selection.start.line + 1
      endChar = selection.start.character + 1
    }

    // Skip if the selection hasn't changed since the last push
    const key = `${filePath}\0${startLine}\0${startChar}\0${endLine}\0${endChar}\0${text}`
    if (key === this.lastSelectionKey) {
      return
    }
    this.lastSelectionKey = key

    const notification = {
      jsonrpc: "2.0",
      method: "selection_changed",
      params: {
        filePath,
        text,
        selection: {
          start: { line: startLine, character: startChar },
          end: { line: endLine, character: endChar },
        },
      },
    }

    const payload = JSON.stringify(notification)
    for (const client of this.initializedClients) {
      if (client.readyState === 1) {
        client.send(payload)
      }
    }
  }

  dispose() {
    for (const d of this.disposables) {
      d.dispose()
    }
    this.disposables = []

    for (const client of this.clients) {
      client.close()
    }
    this.clients.clear()
    this.initializedClients.clear()

    if (this.wss) {
      this.wss.close()
      this.wss = undefined
    }

    // Clean up the lock file so opencode doesn't try to connect after deactivation
    if (this.lockFilePath) {
      try {
        fs.unlinkSync(this.lockFilePath)
      } catch {}
      this.lockFilePath = undefined
    }

    this.port = undefined
  }
}
