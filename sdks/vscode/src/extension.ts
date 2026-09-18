// This method is called when your extension is deactivated
export function deactivate() {}

import * as vscode from "vscode"

const TERMINAL_NAME = "opencode"

export function activate(context: vscode.ExtensionContext) {
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

  const sidebarProvider: vscode.WebviewViewProvider = {
    resolveWebviewView(view) {
      view.webview.options = { enableScripts: true }
      view.webview.html = getSidebarHtml(view.webview)
      view.webview.onDidReceiveMessage(async (message) => {
        if (message.command === "open") {
          await vscode.commands.executeCommand("opencode.openTerminal")
        }
        if (message.command === "openNew") {
          await vscode.commands.executeCommand("opencode.openNewTerminal")
        }
      })
    },
  }

  const sidebarDisposable = vscode.window.registerWebviewViewProvider("opencode.sidebar", sidebarProvider)
  context.subscriptions.push(openNewTerminalDisposable, openTerminalDisposable, addFilepathDisposable, sidebarDisposable)

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

  function getSidebarHtml(_webview: vscode.Webview) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body { padding: 16px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); }
h3 { margin: 0 0 8px; font-size: 13px; }
p { margin: 0 0 12px; font-size: 12px; opacity: 0.9; }
button { display: block; width: 100%; margin: 6px 0; padding: 6px 10px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; cursor: pointer; }
button:hover { background: var(--vscode-button-hoverBackground); }
button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
.hint { margin-top: 12px; font-size: 11px; opacity: 0.7; }
</style>
</head>
<body>
<h3>OpenCode</h3>
<p>Run OpenCode in the integrated terminal. The sidebar delegates to the same terminal workflow.</p>
<button id="open">Open OpenCode</button>
<button id="openNew" class="secondary">Open in New Tab</button>
<p class="hint">Also available via editor title button and Cmd+Esc / Ctrl+Esc.</p>
<script>
const vscode = acquireVsCodeApi();
document.getElementById('open').addEventListener('click', () => vscode.postMessage({ command: 'open' }));
document.getElementById('openNew').addEventListener('click', () => vscode.postMessage({ command: 'openNew' }));
</script>
</body>
</html>`
  }
}
