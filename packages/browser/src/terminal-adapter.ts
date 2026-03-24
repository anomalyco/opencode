// xterm.js ↔ OpenCode agent bridge
// Handles line-buffered input, agent response streaming, and ANSI formatting

import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"

export interface TerminalAdapterOptions {
  container: HTMLElement
  onMessage: (message: string) => void
  onCancel: () => void
}

const ANSI = {
  RESET: "\x1b[0m",
  BOLD: "\x1b[1m",
  DIM: "\x1b[2m",
  ITALIC: "\x1b[3m",
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  BLUE: "\x1b[34m",
  MAGENTA: "\x1b[35m",
  CYAN: "\x1b[36m",
  WHITE: "\x1b[37m",
  GRAY: "\x1b[90m",
  BG_DARK: "\x1b[48;5;235m",
}

export class TerminalAdapter {
  terminal: Terminal
  fitAddon: FitAddon
  private lineBuffer = ""
  private onMessage: (message: string) => void
  private onCancel: () => void
  private isWaitingForInput = false
  private history: string[] = []
  private historyIndex = -1

  constructor(opts: TerminalAdapterOptions) {
    this.onMessage = opts.onMessage
    this.onCancel = opts.onCancel

    this.terminal = new Terminal({
      theme: {
        background: "#1a1a2e",
        foreground: "#e0e0e0",
        cursor: "#e94560",
        cursorAccent: "#1a1a2e",
        selectionBackground: "#0f346080",
        black: "#1a1a2e",
        red: "#e94560",
        green: "#4ecca3",
        yellow: "#f0c040",
        blue: "#4a90d9",
        magenta: "#c850c0",
        cyan: "#00cec9",
        white: "#e0e0e0",
        brightBlack: "#666688",
        brightRed: "#ff6b81",
        brightGreen: "#7deca3",
        brightYellow: "#ffd866",
        brightBlue: "#74b9ff",
        brightMagenta: "#e882e8",
        brightCyan: "#55efc4",
        brightWhite: "#ffffff",
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 14,
      lineHeight: 1.3,
      cursorBlink: true,
      cursorStyle: "bar",
      scrollback: 10000,
      allowProposedApi: true,
    })

    this.fitAddon = new FitAddon()
    this.terminal.loadAddon(this.fitAddon)

    this.terminal.open(opts.container)
    this.fitAddon.fit()

    // Handle resize
    const observer = new ResizeObserver(() => {
      this.fitAddon.fit()
    })
    observer.observe(opts.container)

    // Handle key input
    this.terminal.onData((data) => this.handleInput(data))

    // Welcome message
    this.writeln(`${ANSI.CYAN}${ANSI.BOLD}OpenCode Browser${ANSI.RESET}`)
    this.writeln(`${ANSI.DIM}AI-powered development in your browser${ANSI.RESET}`)
    this.writeln("")
  }

  private handleInput(data: string) {
    if (!this.isWaitingForInput) return

    for (const char of data) {
      const code = char.charCodeAt(0)

      // Ctrl+C
      if (code === 3) {
        this.terminal.write("^C\r\n")
        this.lineBuffer = ""
        this.onCancel()
        this.showPrompt()
        return
      }

      // Ctrl+D (EOF)
      if (code === 4) {
        if (this.lineBuffer.length === 0) {
          this.writeln("\r\n[exit]")
        }
        return
      }

      // Enter
      if (code === 13) {
        this.terminal.write("\r\n")
        const message = this.lineBuffer.trim()
        this.lineBuffer = ""
        this.historyIndex = -1

        if (message.length > 0) {
          this.history.unshift(message)
          if (this.history.length > 100) this.history.pop()
          this.isWaitingForInput = false
          this.onMessage(message)
        } else {
          this.showPrompt()
        }
        return
      }

      // Backspace
      if (code === 127 || code === 8) {
        if (this.lineBuffer.length > 0) {
          this.lineBuffer = this.lineBuffer.slice(0, -1)
          this.terminal.write("\b \b")
        }
        return
      }

      // Escape sequences (arrows, etc.)
      if (char === "\x1b[A") {
        // Up arrow - history
        if (this.historyIndex < this.history.length - 1) {
          this.historyIndex++
          this.replaceInput(this.history[this.historyIndex])
        }
        return
      }
      if (char === "\x1b[B") {
        // Down arrow - history
        if (this.historyIndex > 0) {
          this.historyIndex--
          this.replaceInput(this.history[this.historyIndex])
        } else if (this.historyIndex === 0) {
          this.historyIndex = -1
          this.replaceInput("")
        }
        return
      }

      // Skip other escape sequences
      if (code === 27) return

      // Regular character
      if (code >= 32) {
        this.lineBuffer += char
        this.terminal.write(char)
      }
    }
  }

  private replaceInput(text: string) {
    // Clear current line input
    const clearLen = this.lineBuffer.length
    this.terminal.write("\b".repeat(clearLen) + " ".repeat(clearLen) + "\b".repeat(clearLen))
    this.lineBuffer = text
    this.terminal.write(text)
  }

  showPrompt() {
    this.isWaitingForInput = true
    this.terminal.write(`${ANSI.GREEN}${ANSI.BOLD}> ${ANSI.RESET}`)
  }

  writeln(text: string) {
    this.terminal.writeln(text)
  }

  write(text: string) {
    this.terminal.write(text)
  }

  writeToolResult(icon: string, title: string, description?: string, output?: string) {
    let line = `${ANSI.CYAN}${icon}${ANSI.RESET} ${ANSI.WHITE}${title}${ANSI.RESET}`
    if (description) {
      line += ` ${ANSI.DIM}${description}${ANSI.RESET}`
    }
    this.writeln(line)

    if (output?.trim()) {
      const lines = output.trim().split("\n")
      for (const l of lines.slice(0, 20)) {
        this.writeln(`  ${ANSI.DIM}${l}${ANSI.RESET}`)
      }
      if (lines.length > 20) {
        this.writeln(`  ${ANSI.DIM}... (${lines.length - 20} more lines)${ANSI.RESET}`)
      }
    }
  }

  writeAgentHeader(agent: string, model: string) {
    this.writeln("")
    this.writeln(`${ANSI.BLUE}${ANSI.BOLD}> ${agent}${ANSI.RESET} ${ANSI.DIM}· ${model}${ANSI.RESET}`)
    this.writeln("")
  }

  writeText(text: string) {
    if (!text.trim()) return
    this.writeln("")
    // Word wrap at terminal width
    const maxWidth = this.terminal.cols - 2
    const lines = text.split("\n")
    for (const line of lines) {
      if (line.length <= maxWidth) {
        this.writeln(line)
      } else {
        // Simple word wrap
        let remaining = line
        while (remaining.length > maxWidth) {
          let breakPoint = remaining.lastIndexOf(" ", maxWidth)
          if (breakPoint === -1) breakPoint = maxWidth
          this.writeln(remaining.slice(0, breakPoint))
          remaining = remaining.slice(breakPoint).trimStart()
        }
        if (remaining) this.writeln(remaining)
      }
    }
    this.writeln("")
  }

  writeError(message: string) {
    this.writeln(`${ANSI.RED}${ANSI.BOLD}Error:${ANSI.RESET} ${ANSI.RED}${message}${ANSI.RESET}`)
  }

  writeInfo(message: string) {
    this.writeln(`${ANSI.BLUE}${message}${ANSI.RESET}`)
  }

  writeStreaming(text: string) {
    // For streaming text, write without newline
    this.terminal.write(text)
  }

  clear() {
    this.terminal.clear()
  }
}
