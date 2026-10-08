// This method is called when your extension is deactivated
export function deactivate() {}

import { execFile } from "node:child_process"
import * as vscode from "vscode"
import { promisify } from "node:util"

const TERMINAL_NAME = "opencode"
const execFileAsync = promisify(execFile)

export function getOpenCodeLaunchCommand(majorVersion: number, port: number) {
  return majorVersion >= 2 ? "opencode" : `opencode --port ${port}`
}

export function activate(context: vscode.ExtensionContext) {
  const terminalPorts = new WeakMap<vscode.Terminal, number>()

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
      const port = terminalPorts.get(terminal)
      port ? await appendPrompt(port, fileRef) : terminal.sendText(fileRef, false)
      terminal.show()
    }
  })

  context.subscriptions.push(openNewTerminalDisposable, openTerminalDisposable, addFilepathDisposable)

  async function openTerminal() {
    let majorVersion: number
    try {
      const { stdout } = await execFileAsync("opencode", ["--version"], { timeout: 5000 })
      const version = stdout.match(/\bv?(\d+)\.\d+\.\d+\b/)
      if (!version) {
        throw new Error(`Could not parse OpenCode version from: ${stdout.trim()}`)
      }
      majorVersion = Number(version[1])
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await vscode.window.showErrorMessage(`Unable to detect the OpenCode CLI version: ${message}`)
      return
    }

    if (majorVersion >= 2) {
      openModernTerminal()
      return
    }

    await openLegacyTerminal()
  }

  function createTerminal() {
    return vscode.window.createTerminal({
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
  }

  function openModernTerminal() {
    const terminal = createTerminal()
    terminal.show()
    terminal.sendText(getOpenCodeLaunchCommand(2, 0))
  }

  async function openLegacyTerminal() {
    // Create a new terminal in split screen
    const port = Math.floor(Math.random() * (65535 - 16384 + 1)) + 16384
    const terminal = createTerminal()
    terminalPorts.set(terminal, port)

    terminal.show()
    terminal.sendText(getOpenCodeLaunchCommand(1, port))

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
