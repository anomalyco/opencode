// This method is called when your extension is deactivated
export function deactivate() {}

import * as vscode from "vscode"

const TERMINAL_NAME = "opencode"

export function activate(context: vscode.ExtensionContext) {
  let openNewTerminalDisposable = vscode.commands.registerCommand("opencode.openNewTerminal", async () => {
    await openTerminal()
  })

  let openTerminalDisposable = vscode.commands.registerCommand("opencode.openTerminal", async () => {
    // An opencode terminal already exists => focus it
    const existingTerminal = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME)
    if (existingTerminal) {
      existingTerminal.show()
      return
    }

    await openTerminal()
  })

  let addFilepathDisposable = vscode.commands.registerCommand("opencode.addFilepathToTerminal", async () => {
    // Step 1: Active terminal is a native opencode terminal
    const active = vscode.window.activeTerminal
    if (active) {
      const port = terminalPort(active)
      if (port) {
        const fileRef = getActiveFile()
        if (!fileRef) return
        try {
          await appendPrompt(port, fileRef)
        } catch {
          active.sendText(fileRef, false)
        }
        active.show()
        return
      }
    }

    // Step 2: Any opencode terminal in VS Code
    for (const t of vscode.window.terminals) {
      const port = terminalPort(t)
      if (!port) continue
      const fileRef = getActiveFile()
      if (!fileRef) return
      try {
        await appendPrompt(port, fileRef)
      } catch {
        t.sendText(fileRef, false)
      }
      t.show()
      return
    }

    // Step 3: External opencode instance (e.g. tmux) with same CWD
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (folder) {
      const port = await discover(folder)
      if (port) {
        const fileRef = getActiveFile(true)
        if (!fileRef) return
        await appendPrompt(port, fileRef)
        return
      }
    }

    // Step 4: No opencode found — spawn new terminal
    await openTerminal()
  })

  context.subscriptions.push(openTerminalDisposable, addFilepathDisposable)

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

  function terminalPort(t: vscode.Terminal) {
    const raw = (t.creationOptions as { env?: Record<string, string> }).env?.["_EXTENSION_OPENCODE_PORT"]
    return raw ? parseInt(raw) : undefined
  }

  async function discover(workspace: string) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 1000)
      const res = await fetch("http://localhost:4096/path", { signal: controller.signal })
      clearTimeout(timeout)
      const data = (await res.json()) as { directory: string; worktree: string }
      if (data.directory === workspace || data.worktree === workspace) return 4096
    } catch {}
    return undefined
  }

  function getActiveFile(absolute: boolean = false) {
    const activeEditor = vscode.window.activeTextEditor
    if (!activeEditor) {
      return
    }

    const document = activeEditor.document

    // Get the path based on absolute flag
    let path: string
    if (absolute) {
      path = document.uri.fsPath
    } else {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
      if (!workspaceFolder) {
        return
      }
      path = vscode.workspace.asRelativePath(document.uri)
    }

    let filepathWithAt = `@${path}`

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
