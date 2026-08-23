// This method is called when your extension is deactivated
export function deactivate() {}

import * as vscode from "vscode"
import http from "http"

const TERMINAL_NAME = "opencode"
const SCHEME = "opencode-diff"

let opencodePort: number | undefined
let ipcServer: http.Server | undefined

type PendingDiff = {
  resolve: (content: string | null) => void
}

const pendingDiffs = new Map<string, PendingDiff>()

const output = vscode.window.createOutputChannel("opencode")

class MemFS implements vscode.FileSystemProvider {
  private files = new Map<string, Uint8Array>()
  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>()

  readonly onDidChangeFile = this._emitter.event

  stat(uri: vscode.Uri): vscode.FileStat {
    const data = this.files.get(uri.toString())
    if (!data) throw vscode.FileSystemError.FileNotFound(uri)
    return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: data.length }
  }

  readFile(uri: vscode.Uri): Uint8Array {
    const data = this.files.get(uri.toString())
    if (!data) throw vscode.FileSystemError.FileNotFound(uri)
    return data
  }

  writeFile(uri: vscode.Uri, content: Uint8Array, _options: { create: boolean; overwrite: boolean }): void {
    this.files.set(uri.toString(), content)
    this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }])
  }

  readDirectory(): [string, vscode.FileType][] {
    return []
  }

  createDirectory(): void {}

  rename(): void {}

  delete(uri: vscode.Uri): void {
    this.files.delete(uri.toString())
    this._emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }])
  }

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => {})
  }
}

const memfs = new MemFS()

export async function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(vscode.workspace.registerFileSystemProvider(SCHEME, memfs, { isCaseSensitive: true }))

  const ipcPort = await startIpcServer(context)
  if (!ipcPort) {
    output.appendLine("[opencode] failed to start IPC server")
    return
  }
  context.environmentVariableCollection.replace("OPENCODE_VSCODE_IPC_PORT", String(ipcPort))
  output.appendLine(`[opencode] extension activated, IPC_PORT=${ipcPort}`)

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
      opencodePort ? await appendPrompt(fileRef) : terminal.sendText(fileRef, false)
      terminal.show()
    }
  })

  const diffAcceptDisposable = vscode.commands.registerCommand(
    "opencode.diff.accept",
    async () => {
      const requestID = activeDiffRequestID()
      output.appendLine(`[opencode] accept clicked, requestID=${requestID ?? "none"}`)
      if (!requestID) return
      const pending = pendingDiffs.get(requestID)
      if (!pending) return
      pendingDiffs.delete(requestID)
      const edited = readNewDocument(requestID)
      if (opencodePort) {
        await fetch(`http://localhost:${opencodePort}/permission/${requestID}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reply: "once", content: edited }),
        }).catch((e) => output.appendLine(`[opencode] failed to reply: ${String(e)}`))
      }
      await cleanupDiff(requestID)
      pending.resolve(edited)
    },
  )

  const diffRejectDisposable = vscode.commands.registerCommand(
    "opencode.diff.reject",
    async () => {
      const requestID = activeDiffRequestID()
      output.appendLine(`[opencode] reject clicked, requestID=${requestID ?? "none"}`)
      if (!requestID) return
      const pending = pendingDiffs.get(requestID)
      if (!pending) return
      pendingDiffs.delete(requestID)
      await cleanupDiff(requestID)
      if (opencodePort) {
        await fetch(`http://localhost:${opencodePort}/permission/${requestID}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reply: "reject" }),
        }).catch((e) => output.appendLine(`[opencode] failed to reply: ${String(e)}`))
      }
      pending.resolve(null)
    },
  )

  const diffCloseDisposable = vscode.workspace.onDidCloseTextDocument((doc: vscode.TextDocument) => {
    const requestID = requestIDFromUri(doc.uri)
    if (!requestID) return
    const pending = pendingDiffs.get(requestID)
    if (!pending) return
    pendingDiffs.delete(requestID)
    if (opencodePort) {
      fetch(`http://localhost:${opencodePort}/permission/${requestID}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply: "reject" }),
      }).catch((e) => output.appendLine(`[opencode] failed to reply: ${String(e)}`))
    }
    pending.resolve(null)
  })

  context.subscriptions.push(
    openNewTerminalDisposable,
    openTerminalDisposable,
    addFilepathDisposable,
    diffAcceptDisposable,
    diffRejectDisposable,
    diffCloseDisposable,
  )

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
        OPENCODE_CALLER: "vscode",
      },
    })

    terminal.show()
    terminal.sendText(`opencode --port ${port}`)

    // Wait for opencode to start and connect to our IPC server
    let tries = 10
    while (tries > 0 && !opencodePort) {
      await new Promise((resolve) => setTimeout(resolve, 200))
      tries--
    }

    const fileRef = getActiveFile()
    if (!fileRef) {
      return
    }

    // If connected, append the prompt to the terminal
    if (opencodePort) {
      await appendPrompt(`In ${fileRef}`)
      terminal.show()
    }
  }

  async function appendPrompt(text: string) {
    if (!opencodePort) return
    try {
      await fetch(`http://localhost:${opencodePort}/tui/append-prompt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      })
    } catch {}
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

function startIpcServer(context: vscode.ExtensionContext): Promise<number | undefined> {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost")

    if (req.method === "POST" && url.pathname === "/register") {
      let body = ""
      req.on("data", (chunk) => (body += chunk))
      req.on("end", () => {
        try {
          const data = JSON.parse(body)
          opencodePort = data.port
          output.appendLine(`[opencode] registered with VS Code, opencode port = ${data.port}`)
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ ok: true }))
        } catch {
          res.writeHead(400)
          res.end()
        }
      })
      return
    }

    if (req.method === "POST" && url.pathname === "/diff") {
      let body = ""
      req.on("data", (chunk) => (body += chunk))
      req.on("end", async () => {
        try {
          const { requestID, filepath, oldText, newText } = JSON.parse(body)
          output.appendLine(`[opencode] received diff request for ${filepath}, showing diff`)
          await showDiff(requestID, filepath, oldText, newText)
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ ok: true }))
        } catch (e) {
          output.appendLine(`Failed to show diff: ${String(e)}`)
          res.writeHead(500)
          res.end()
        }
      })
      return
    }

    if (req.method === "GET" && url.pathname.startsWith("/diff-content/")) {
      const requestID = url.pathname.split("/")[2]
      try {
        const content = readNewDocument(requestID)
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ content }))
      } catch {
        res.writeHead(404)
        res.end()
      }
      return
    }

    if (req.method === "POST" && url.pathname === "/reply") {
      let body = ""
      req.on("data", (chunk) => (body += chunk))
      req.on("end", async () => {
        try {
          const { requestID } = JSON.parse(body)
          const pending = pendingDiffs.get(requestID)
          if (pending) {
            pendingDiffs.delete(requestID)
            await cleanupDiff(requestID)
            pending.resolve(null)
          }
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ ok: true }))
        } catch {
          res.writeHead(400)
          res.end()
        }
      })
      return
    }

    res.writeHead(404)
    res.end()
  })

  return new Promise((resolve) => {
    server.once("error", (e) => {
      output.appendLine(`[opencode] IPC server error: ${String(e)}`)
      resolve(undefined)
    })
    server.listen(0, () => {
      ipcServer = server
      const address = server.address()
      if (!address || typeof address === "string") {
        output.appendLine("[opencode] IPC server failed to resolve port")
        resolve(undefined)
        return
      }
      output.appendLine(`[opencode] IPC server listening on ${address.port}`)
      context.subscriptions.push({
        dispose: () => {
          server.close()
        },
      })
      resolve(address.port)
    })
  })
}

function requestIDFromUri(uri: vscode.Uri | undefined): string | undefined {
  if (!uri || uri.scheme !== SCHEME) return undefined
  return uri.authority
}

function activeDiffRequestID(): string | undefined {
  for (const doc of vscode.workspace.textDocuments) {
    const requestID = requestIDFromUri(doc.uri)
    if (requestID) return requestID
  }
  return undefined
}

function oldUri(requestID: string): vscode.Uri {
  return vscode.Uri.parse(`${SCHEME}://${requestID}/old`)
}

function newUri(requestID: string): vscode.Uri {
  return vscode.Uri.parse(`${SCHEME}://${requestID}/new`)
}

function readNewDocument(requestID: string): string {
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === newUri(requestID).toString())
  if (doc) return doc.getText()
  return Buffer.from(memfs.readFile(newUri(requestID))).toString()
}

async function showDiff(
  requestID: string,
  filepath: string,
  oldText: string,
  newText: string,
): Promise<void> {
  memfs.writeFile(oldUri(requestID), Buffer.from(oldText), { create: true, overwrite: true })
  memfs.writeFile(newUri(requestID), Buffer.from(newText), { create: true, overwrite: true })

  const viewColumn = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Beside

  await vscode.commands.executeCommand("vscode.diff", oldUri(requestID), newUri(requestID), `${filepath} (Diff)`, {
    viewColumn,
    preserveFocus: false,
  })

  await new Promise<string | null>((resolve) => {
    pendingDiffs.set(requestID, { resolve })
  })
}

async function cleanupDiff(requestID: string) {
  await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor")
  memfs.delete(oldUri(requestID))
  memfs.delete(newUri(requestID))
}
