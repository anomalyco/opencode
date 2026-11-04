---
title: "REPL"
description: "An interactive JavaScript and TypeScript REPL with syntax highlighting, history, and tab completion"
---

`bun repl` starts an interactive Read-Eval-Print Loop (REPL) for evaluating JavaScript and TypeScript expressions. Use it to test code snippets, explore APIs, and debug.

```sh terminal icon="terminal"
bun repl
```

```txt
Welcome to Bun v1.3.3
Type .copy [code] to copy to clipboard. .help for more info.

> 1 + 1
2
> const greeting = "Hello, Bun!"
undefined
> greeting
'Hello, Bun!'
```

---

## Features

- **TypeScript & JSX** — Write TypeScript and JSX directly. Bun transpiles everything on the fly.
- **Top-level `await`** — Await promises directly at the prompt without wrapping in an async function.
- **Syntax highlighting** — Input is highlighted as you type.
- **Persistent history** — History is saved to `~/.bun_repl_history` and persists across sessions.
- **Tab completion** — Press `Tab` to complete property names and REPL commands.
- **Multi-line input** — Unclosed brackets, braces, and parentheses automatically continue on the next line.
- **Node.js globals** — `require`, `module`, `__dirname`, and `__filename` are available, resolved relative to your current working directory.

---

## Special variables

The REPL exposes two special variables that update after each evaluation.

| Variable | Description                       |
| -------- | --------------------------------- |
| `_`      | The result of the last expression |
| `_error` | The last error that was thrown    |

```txt
> 2 + 2
4
> _ * 10
40
> JSON.parse("oops")
SyntaxError: JSON Parse error: Unexpected identifier "oops"
> _error
SyntaxError: JSON Parse error: Unexpected identifier "oops"
```

---

## Top-level `await`

Promises are automatically awaited. You can `await` any expression directly at the prompt.

```txt
> await fetch("https://api.github.com/repos/oven-sh/bun").then(r => r.json()).then(r => r.stargazers_count)
81234
> const response = await fetch("https://example.com")
undefined
> response.status
200
```

---

## Importing modules

Just like Bun's runtime, you can use either `require` or `import` in the REPL and it Just Works — mix ESM and CommonJS freely at the prompt. Module resolution uses the same rules as `bun run`, so you can import from `node_modules`, relative paths, or `node:` builtins.

```txt
> import { z } from "zod"
undefined
> const path = require("path")
undefined
> z.string().parse(path.join("/tmp", "file.txt"))
'/tmp/file.txt'
```

Declarations persist for the rest of the session, and `const`/`let` can be redeclared across evaluations (unlike in regular scripts) so you can re-run `import` and `require` statements while iterating.

---

## Multi-line input

When you press `Enter` on a line with unclosed brackets, braces, or parentheses, the REPL automatically continues on the next line. The prompt changes to `...` to indicate continuation.

```txt
> function add(a, b) {
...   return a + b;
... }
undefined
> add(2, 3)
5
```

For longer multi-line entries, use `.editor` to enter editor mode, which buffers all input until you press `Ctrl+D`.

---

## REPL commands

Type `.help` at the prompt to see all available REPL commands.

| Command    | Description                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------ |
| `.help`    | Print the help message listing commands and keybindings                                          |
| `.exit`    | Exit the REPL                                                                                    |
| `.clear`   | Clear the screen                                                                                 |
| `.copy`    | Copy the last result to the clipboard. Pass an expression to evaluate and copy it: `.copy 1 + 1` |
| `.load`    | Load a file into the REPL session: `.load ./script.ts`                                           |
| `.save`    | Save the current REPL history to a file: `.save ./session.txt`                                   |
| `.editor`  | Enter multi-line editor mode (press `Ctrl+D` to evaluate, `Ctrl+C` to cancel)                    |
| `.break`   | Cancel the current multi-line input                                                              |
| `.history` | Print the command history                                                                        |

---

## Keybindings

The REPL supports Emacs-style line editing.

| Keybinding          | Action                                                   |
| ------------------- | -------------------------------------------------------- |
| `Ctrl+A`            | Move to start of line                                    |
| `Ctrl+E`            | Move to end of line                                      |
| `Ctrl+B` / `Ctrl+F` | Move backward/forward one character                      |
| `Alt+B` / `Alt+F`   | Move backward/forward one word                           |
| `Ctrl+U`            | Delete to start of line                                  |
| `Ctrl+K`            | Delete to end of line                                    |
| `Ctrl+W`            | Delete word backward                                     |
| `Ctrl+D`            | Delete character (or exit if line is empty)              |
| `Ctrl+L`            | Clear screen                                             |
| `Ctrl+T`            | Swap the two characters before the cursor                |
| `Up` / `Down`       | Navigate history                                         |
| `Tab`               | Auto-complete                                            |
| `Ctrl+C`            | Cancel current input (press twice on empty line to exit) |

---

## History

REPL history is automatically saved to `~/.bun_repl_history` (up to 1000 entries) and loaded at the start of each session. Use `Up`/`Down` to navigate.

To export your history to a different file, use `.save`:

```txt
> .save ./my-session.txt
```

---

## Non-interactive mode

Use `-e` / `--eval` to evaluate a script with REPL semantics and exit. Use `-p` / `--print` to additionally print the result.

```sh terminal icon="terminal"
bun repl -e "const x: number = 42; console.log(x)"
# 42

bun repl -p "await fetch('https://example.com').then(r => r.status)"
# 200

bun repl -p "{ a: 1, b: 2 }"
# { a: 1, b: 2 }
```

This uses the same transforms as the interactive REPL, so a bare object literal like `{ a: 1 }` is treated as an object expression instead of a block statement. The process exits after the event loop drains (pending timers and I/O complete first). On error, the process exits with code `1`.
