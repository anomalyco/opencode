// This method is called when your extension is deactivated
export function deactivate() {}

import * as vscode from "vscode"

const TERMINAL_NAME = "opencode"

/**
 * Checks if vscode-mcp-server extension is installed and gets its configured port
 * @returns Configuration object with port, or null if not installed/configured
 */
function getVscodeMcpServerConfig(): { installed: boolean; port: number } | null {
  const ext = vscode.extensions.getExtension("JuehangQin.vscode-mcp-server")
  if (!ext) {
    return null
  }

  // Read the port from vscode-mcp-server's actual configuration
  const config = vscode.workspace.getConfiguration("vscode-mcp-server")
  const port = config.get<number>("port")

  if (port === undefined) {
    return null
  }

  return {
    installed: true,
    port: port,
  }
}

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

    // If connected, try to register vscode-mcp-server if available
    if (connected) {
      const opencodeConfig = vscode.workspace.getConfiguration("opencode")
      const autoDetect = opencodeConfig.get<boolean>("autoDetectMcpServer") ?? true

      if (autoDetect) {
        const mcpServerConfig = getVscodeMcpServerConfig()

        if (mcpServerConfig?.installed) {
          try {
            // Register the MCP server with opencode directly
            // opencode will handle the connection to the MCP server
            await fetch(`http://localhost:${port}/mcp`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: "vscode",
                config: {
                  type: "remote",
                  url: `http://localhost:${mcpServerConfig.port}/mcp`,
                },
              }),
            })
          } catch (e) {
            // MCP server registration failed silently
          }
        }
      }

      // Append the file reference to the prompt if there's an active file
      const fileRef = getActiveFile()
      if (fileRef) {
        await appendPrompt(port, `In ${fileRef}`)
      }
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
