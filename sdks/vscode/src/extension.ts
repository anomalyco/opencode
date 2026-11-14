// This method is called when your extension is deactivated
export function deactivate() {}

import * as vscode from "vscode"
import { createSidebarProvider, SIDEBAR_VIEW_ID } from "./sidebar"

const TERMINAL_NAME = "OpenCode"

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SIDEBAR_VIEW_ID, createSidebarProvider(context), {
      // Rebuilding the app on every reveal would drop its streams and scroll position.
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("opencode.openSettings", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", `@ext:${context.extension.id}`),
    ),
  )

  const openNewTerminalDisposable = vscode.commands.registerCommand("opencode.openNewTerminal", async () => {
    await openTerminal()
  })

  const openTerminalDisposable = vscode.commands.registerCommand("opencode.openTerminal", async () => {
    // An OpenCode terminal already exists => focus it
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
      terminal.sendText(fileRef, false)
      terminal.show()
    }
  })

  context.subscriptions.push(openNewTerminalDisposable, openTerminalDisposable, addFilepathDisposable)

  async function openTerminal() {
    // Create a new terminal in split screen
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
    terminal.sendText("opencode")
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
        filepathWithAt += `#${startLine}`
      } else {
        // Multi-line selection
        filepathWithAt += `#${startLine}-${endLine}`
      }
    }

    return filepathWithAt
  }
}
