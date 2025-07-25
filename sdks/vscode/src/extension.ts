// This method is called when your extension is deactivated
export function deactivate() {}

import * as vscode from "vscode"

export function activate(context: vscode.ExtensionContext) {
  const TERMINAL_NAME = "opencode"

  // Register command to open terminal in split screen and run opencode
  let openTerminalDisposable = vscode.commands.registerCommand("opencode.openTerminal", async () => {
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
      },
    })

    terminal.show()
    terminal.sendText(`OPENCODE_THEME=system OPENCODE_CALLER=vscode opencode --port ${port}`)

    const fileRef = getActiveFile()
    if (!fileRef) return

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
  })

  // Register command to add filepath to terminal
  let addFilepathDisposable = vscode.commands.registerCommand("opencode.addFilepathToTerminal", async () => {
    const fileRef = getActiveFile()
    if (!fileRef) return

    const terminal = vscode.window.activeTerminal
    if (!terminal) return

    if (terminal.name === TERMINAL_NAME) {
      // @ts-ignore
      const port = terminal.creationOptions.env?.["_EXTENSION_OPENCODE_PORT"]
      port ? await appendPrompt(parseInt(port), fileRef) : terminal.sendText(fileRef)
      terminal.show()
    }
  })

  context.subscriptions.push(openTerminalDisposable, addFilepathDisposable)
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
  if (!activeEditor) return

  const document = activeEditor.document
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
  if (!workspaceFolder) return

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
