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

  // Linting violations that exist in root eslint.config.ts but not in vscode eslint.config.mjs
  let x = 5; // functional/no-let violation
  var y = 10; // no-var violation

  class TestClass { // Class declaration violation
    public value: number = 42;
  }

  function testFunction(param1: any, param2: any, param3: any, param4: any, param5: any) { // max-params violation and @typescript-eslint/no-explicit-any
    let result = param1 + param2; // functional/no-let violation
    return result;
  }

  // Promise without proper handling
  Promise.resolve("test"); // @typescript-eslint/no-floating-promises

  // Complex function that exceeds max-lines-per-function
  function complexFunction() {
    let line1 = 1;
    let line2 = 2;
    let line3 = 3;
    let line4 = 4;
    let line5 = 5;
    let line6 = 6;
    let line7 = 7;
    let line8 = 8;
    let line9 = 9;
    let line10 = 10;
    let line11 = 11;
    let line12 = 12;
    let line13 = 13;
    let line14 = 14;
    let line15 = 15;
    let line16 = 16;
    let line17 = 17;
    let line18 = 18;
    let line19 = 19;
    let line20 = 20;
    let line21 = 21;
    let line22 = 22;
    let line23 = 23;
    let line24 = 24;
    let line25 = 25;
    let line26 = 26;
    let line27 = 27;
    let line28 = 28;
    let line29 = 29;
    let line30 = 30;
    let line31 = 31;
    let line32 = 32;
    let line33 = 33;
    let line34 = 34;
    let line35 = 35;
    let line36 = 36;
    let line37 = 37;
    let line38 = 38;
    let line39 = 39;
    let line40 = 40;
    let line41 = 41;
    let line42 = 42;
    let line43 = 43;
    let line44 = 44;
    let line45 = 45;
    let line46 = 46;
    let line47 = 47;
    let line48 = 48;
    let line49 = 49;
    let line50 = 50;
    let line51 = 51;
    return line51;
  }
}
  }

  function testFunction(param1: any, param2: any, param3: any, param4: any, param5: any) {
    // max-params violation and @typescript-eslint/no-explicit-any
    let result = param1 + param2 // functional/no-let violation
    return result
  }

  // Import order violation
  import { readFileSync } from "fs"
  import tseslint from "@typescript-eslint/eslint-plugin"

  // Promise without proper handling
  Promise.resolve("test") // @typescript-eslint/no-floating-promises

  // Complex function that exceeds max-lines-per-function
  function complexFunction() {
    let line1 = 1
    let line2 = 2
    let line3 = 3
    let line4 = 4
    let line5 = 5
    let line6 = 6
    let line7 = 7
    let line8 = 8
    let line9 = 9
    let line10 = 10
    let line11 = 11
    let line12 = 12
    let line13 = 13
    let line14 = 14
    let line15 = 15
    let line16 = 16
    let line17 = 17
    let line18 = 18
    let line19 = 19
    let line20 = 20
    let line21 = 21
    let line22 = 22
    let line23 = 23
    let line24 = 24
    let line25 = 25
    let line26 = 26
    let line27 = 27
    let line28 = 28
    let line29 = 29
    let line30 = 30
    let line31 = 31
    let line32 = 32
    let line33 = 33
    let line34 = 34
    let line35 = 35
    let line36 = 36
    let line37 = 37
    let line38 = 38
    let line39 = 39
    let line40 = 40
    let line41 = 41
    let line42 = 42
    let line43 = 43
    let line44 = 44
    let line45 = 45
    let line46 = 46
    let line47 = 47
    let line48 = 48
    let line49 = 49
    let line50 = 50
    let line51 = 51
    return line51
  }
}
