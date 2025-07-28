// This method is called when your extension is deactivated
export function deactivate() { }

import * as vscode from "vscode"

const TERMINAL_NAME = "opencode"
let registeredExternalPort: number | null = null

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
    const fileRef = getActiveFile()
    if (!fileRef) return

    await sendTextToTerminal(fileRef)
  })

  // Register command to connect to external terminal
  let registerTerminalDisposable = vscode.commands.registerCommand("opencode.registerTerminal", async () => {
    const port = await vscode.window.showInputBox({
      prompt: "Enter port number for external terminal",
      placeHolder: "e.g. 3000",
      validateInput: (value) => {
        const num = parseInt(value)
        if (isNaN(num) || num < 1 || num > 65535) {
          return "Please enter a valid port number (1-65535)"
        }
        return null
      }
    })

    if (!port) return

    const portNum = parseInt(port)

    try {
      const response = await fetch(`http://localhost:${portNum}/app`)
      if (response.ok) {
        registeredExternalPort = portNum
        vscode.window.showInformationMessage(`Successfully connected to external terminal on port ${portNum}`)

        const fileRef = getActiveFile()
        if (fileRef) {
          await sendTextToTerminal(`In ${fileRef}`)
        }
      } else {
        vscode.window.showErrorMessage(`Failed to connect to terminal on port ${portNum}`)
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Unable to connect to terminal on port ${portNum}. Make sure the terminal is running.`)
    }
  })

  let addProblemsDisposable = vscode.commands.registerCommand("opencode.addProblemsToTerminal", async () => {
    let problems = vscode.languages.getDiagnostics()
    if (!problems.length) {
      vscode.window.showInformationMessage("No problems found in the workspace.")
      return
    }

    let errors = []

    for (const [uri, diagnostics] of problems) {
      for (const diagnostic of diagnostics) {
        if (diagnostic.severity === vscode.DiagnosticSeverity.Error) {
          errors.push(diagnostic)
        }
      }
    }

    await sendTextToTerminal(JSON.stringify(errors));
  });

  context.subscriptions.push(
    openTerminalDisposable,
    addFilepathDisposable,
    registerTerminalDisposable,
    addProblemsDisposable
  )

  async function sendTextToTerminal(text: string) {
    const terminal = vscode.window.activeTerminal

    if (terminal && terminal.name === TERMINAL_NAME) {
      // @ts-ignore
      const port = terminal.creationOptions.env?.["_EXTENSION_OPENCODE_PORT"]
      port ? await appendPrompt(parseInt(port), text) : terminal.sendText(text)
      terminal.show()
    } else if (registeredExternalPort) {
      await appendPrompt(registeredExternalPort, text)
    } else {
      vscode.window.showWarningMessage("No opencode terminal or registered external terminal found")
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
      } catch (e) { }

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
}
