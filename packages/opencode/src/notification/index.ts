import { Bus } from "@/bus"
import { SessionStatus } from "@/session/status"
import { Session } from "@/session"
import { SessionID } from "@/session/schema"
import { Log } from "@/util/log"
import { Config } from "@/config/config"

const log = Log.create({ name: "notification" })

export namespace Notification {
  let initialized = false

  export async function init() {
    if (initialized) return
    initialized = true

    Bus.subscribe(SessionStatus.Event.Idle, async (event) => {
      const config = await Config.get()
      // Default to true if not explicitly set to false
      if (Reflect.get(config, "notifications") === false) return

      try {
        await sendCompletionNotification(event.properties.sessionID)
      } catch (err) {
        log.error("failed to send notification", { error: err })
      }
    })
  }

  async function sendCompletionNotification(sessionID: string) {
    const id = SessionID.make(sessionID)
    const session = await Session.get(id)
    if (!session) return

    const messagesWithParts = await Session.messages({ sessionID: id, limit: 10 })
    const lastAssistant = messagesWithParts.filter((m) => m.info.role === "assistant").pop()

    // Build notification content
    const title = session.title || "OpenCode"
    let message = "Session completed"

    if (lastAssistant) {
      // Get a summary from the last assistant message
      const textPart = lastAssistant.parts.find((p) => p.type === "text")
      if (textPart && textPart.type === "text") {
        // Truncate to first 100 chars
        const text = textPart.text.slice(0, 100)
        message = text.length < textPart.text.length ? text + "..." : text
      }
    }

    // Get tmux info if available
    const tmux = await getTmuxInfo()
    if (tmux?.windowName) {
      message = `[${tmux.windowName}] ${message}`
    }

    // Build URL if share is available
    const url = session.share?.url

    await sendMacOSNotification({
      title,
      message,
      url,
      sessionID,
      tmux,
    })
  }

  interface TmuxInfo {
    windowName?: string
    pane?: string // e.g., "%123"
    sessionName?: string
    windowIndex?: string
  }

  async function getTmuxInfo(): Promise<TmuxInfo | undefined> {
    if (!process.env["TMUX"]) return undefined

    try {
      // Get window name, session name, window index, and pane ID
      const proc = Bun.spawn(
        ["tmux", "display-message", "-p", "#{window_name}\t#{session_name}\t#{window_index}\t#{pane_id}"],
        {
          stdout: "pipe",
          stderr: "ignore",
        },
      )
      const output = await new Response(proc.stdout).text()
      await proc.exited
      const [windowName, sessionName, windowIndex, pane] = output.trim().split("\t")
      return {
        windowName: windowName || undefined,
        sessionName: sessionName || undefined,
        windowIndex: windowIndex || undefined,
        pane: pane || process.env["TMUX_PANE"],
      }
    } catch {
      return undefined
    }
  }

  async function getTerminalBundleId(): Promise<string> {
    // Check common terminal emulators by looking at parent process or known env vars
    const termProgram = process.env["TERM_PROGRAM"]

    switch (termProgram) {
      case "ghostty":
        return "com.mitchellh.ghostty"
      case "iTerm.app":
        return "com.googlecode.iterm2"
      case "Apple_Terminal":
        return "com.apple.Terminal"
      case "WezTerm":
        return "com.github.wez.wezterm"
      case "Alacritty":
        return "org.alacritty"
      case "kitty":
        return "net.kovidgoyal.kitty"
      default:
        // Fallback: try to detect from TERM_PROGRAM_VERSION or default to Terminal
        if (process.env["GHOSTTY_RESOURCES_DIR"]) return "com.mitchellh.ghostty"
        if (process.env["ITERM_SESSION_ID"]) return "com.googlecode.iterm2"
        if (process.env["KITTY_WINDOW_ID"]) return "net.kovidgoyal.kitty"
        if (process.env["WEZTERM_PANE"]) return "com.github.wez.wezterm"
        return "com.apple.Terminal"
    }
  }

  async function sendMacOSNotification(opts: {
    title: string
    message: string
    url?: string
    sessionID: string
    tmux?: TmuxInfo
  }) {
    if (process.platform !== "darwin") return

    const terminalBundleId = await getTerminalBundleId()

    // Try terminal-notifier first (better UX with click actions)
    const terminalNotifierArgs = [
      "-title",
      opts.title,
      "-message",
      opts.message,
      "-group",
      `opencode-${opts.sessionID}`,
    ]

    // Build click action: activate terminal and optionally switch tmux window
    if (opts.tmux?.sessionName && opts.tmux?.windowIndex) {
      // Use -execute to run tmux select-window, then activate terminal
      const tmuxCmd = `tmux select-window -t '${opts.tmux.sessionName}:${opts.tmux.windowIndex}' 2>/dev/null; open -a '${terminalBundleId}'`
      terminalNotifierArgs.push("-execute", tmuxCmd)
    } else {
      // Just activate the terminal
      terminalNotifierArgs.push("-activate", terminalBundleId)
    }

    // Add subtitle with share URL if available
    if (opts.url) {
      terminalNotifierArgs.push("-subtitle", opts.url)
    }

    try {
      const proc = Bun.spawn(["terminal-notifier", ...terminalNotifierArgs], {
        stdout: "ignore",
        stderr: "pipe",
      })
      await proc.exited
      if (proc.exitCode === 0) return
    } catch {
      // terminal-notifier not available, fall back to osascript
    }

    // Fallback to osascript (no click action support)
    const escapedTitle = opts.title.replace(/"/g, '\\"')
    const escapedMessage = opts.message.replace(/"/g, '\\"')
    const script = `display notification "${escapedMessage}" with title "${escapedTitle}"`

    try {
      const proc = Bun.spawn(["osascript", "-e", script], {
        stdout: "ignore",
        stderr: "ignore",
      })
      await proc.exited
    } catch (err) {
      log.error("osascript notification failed", { error: err })
    }
  }
}
