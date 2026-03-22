// This method is called when your extension is deactivated
export function deactivate() {}

import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"
import * as crypto from "crypto"
import { createMcpServer } from "./mcp-server"
import { vscodeEditorState } from "./vscode-editor-state"

const TERMINAL_NAME = "opencode"

export async function activate(context: vscode.ExtensionContext) {
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

  context.subscriptions.push(openNewTerminalDisposable, openTerminalDisposable, addFilepathDisposable)

  // --- MCP Server for IDE Context Awareness ---
  // Wrapped in try/catch so that a failure to start the MCP server (e.g. socket
  // bind error, missing xdg-basedir) does not take down the terminal commands
  // registered above — those should keep working regardless.
  try {
    // The editor state function reads live state from
    // vscode.window.activeTextEditor each time it is called, so the
    // editor://context resource always returns up-to-date context.
    const editorState = vscodeEditorState

    // Generate a per-session secret so that only the opencode process that reads
    // the lock file can authenticate with the MCP server.
    const authToken = crypto.randomUUID()

    const version = context.extension.packageJSON.version ?? "0.0.0"

    // Use xdg-basedir (the same package the opencode CLI uses) so lock file paths
    // are always in the same location regardless of which process writes them.
    // Dynamic import is required because xdg-basedir is an ESM-only package;
    // TypeScript in Node16 module mode rejects static imports of ESM from CJS.
    const { xdgData } = await import("xdg-basedir")
    if (!xdgData) {
      console.error("opencode: xdg-basedir returned no data directory; MCP server not started")
      return
    }
    const ideDir = path.join(xdgData, "opencode", "ide")
    fs.mkdirSync(ideDir, { recursive: true })

    // Start the MCP HTTP server. It binds to 127.0.0.1 on an OS-assigned
    // ephemeral port so there is no risk of port conflicts.
    const mcpHandle = await createMcpServer(editorState, version, authToken)
    const lockFilePath = path.join(ideDir, `${mcpHandle.port}.lock`)

    // environmentVariableCollection persists across VS Code restarts, so terminals
    // opened before this activation would otherwise inherit a stale port from the
    // previous session. clear() ensures they get only the current port.
    const envCollection = context.environmentVariableCollection
    envCollection.clear()
    envCollection.replace("OPENCODE_MCP_PORT", mcpHandle.port.toString())

    // Write the lock file atomically: write to a .tmp file first, then rename
    // into place. This guarantees readers never observe a partially-written file.
    const lockContent = JSON.stringify({
      pid: process.pid,
      workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
      authToken,
    })
    const tmpPath = lockFilePath + ".tmp"
    // mode 0o600: owner-only read/write. The lock file contains the auth token,
    // so on shared machines we don't want other users to be able to read it.
    fs.writeFileSync(tmpPath, lockContent, { mode: 0o600 })
    fs.renameSync(tmpPath, lockFilePath)

    // --- Editor change notifications ---
    // Fire resource-updated notifications when the user switches files or
    // changes their selection. This lets the CLI update its UI in real time
    // without polling. Both listeners are debounced to avoid flooding the
    // MCP transport during rapid cursor movement or repeated file switches.

    // How long to wait after the last editor event before sending a notification.
    // Low enough to feel responsive, high enough to batch rapid cursor movement
    // (key repeat fires events every ~30ms).
    const EDITOR_NOTIFY_DEBOUNCE_MS = 150

    let debounceTimer: ReturnType<typeof setTimeout> | undefined
    function notifyDebounced() {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        mcpHandle.notifyContextChanged().catch(() => {})
      }, EDITOR_NOTIFY_DEBOUNCE_MS)
    }

    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() => notifyDebounced()),
      vscode.window.onDidChangeTextEditorSelection(() => notifyDebounced()),
      {
        dispose() {
          if (debounceTimer) clearTimeout(debounceTimer)
        },
      },
    )

    // Clean up the MCP server and its lock file when the extension deactivates
    // (e.g. VS Code is closed, the workspace changes, or the extension is
    // disabled). Without this the lock file would linger and mislead the CLI.
    context.subscriptions.push({
      dispose() {
        // close() is async but VS Code's dispose is sync. Attach .catch() to
        // prevent an unhandled rejection if shutdown fails.
        mcpHandle.close().catch(() => {})
        try {
          fs.unlinkSync(lockFilePath)
        } catch {}
      },
    })
  } catch (err) {
    console.error("opencode: MCP server failed to start", err)
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
      } catch (e) {}

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
