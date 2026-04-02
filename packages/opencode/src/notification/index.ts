import { platform } from "os"
import { Process } from "@/util/process"
import { which } from "@/util/which"

const TERMINAL_APPS = [
  "terminal",
  "iterm",
  "iterm2",
  "warp",
  "alacritty",
  "kitty",
  "ghostty",
  "wezterm",
  "hyper",
  "tabby",
  "wave",
  "tmux",
  "zellij",
  "vscode",
  "code",
]

function escapeForOsascript(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

export namespace Notification {
  export async function terminalIsFocused(): Promise<boolean> {
    if (platform() !== "darwin") return false

    const result = await Process.text(
      [
        "osascript",
        "-e",
        'tell application "System Events" to get name of first application process whose frontmost is true',
      ],
      { nothrow: true },
    )
    const frontmost = result.text.trim().toLowerCase()
    return TERMINAL_APPS.some((app) => frontmost.includes(app))
  }

  export async function show(title: string, message: string): Promise<void> {
    const os = platform()

    if (os === "darwin") {
      const escaped = escapeForOsascript(message)
      const titleEscaped = escapeForOsascript(title)
      await Process.run(
        [
          "osascript",
          "-e",
          `tell application "Terminal" to display notification "${escaped}" with title "${titleEscaped}"`,
        ],
        { nothrow: true },
      )
      return
    }

    if (os === "linux") {
      if (which("notify-send")) {
        await Process.run(["notify-send", "--app-name=opencode", title, message], { nothrow: true })
        return
      }
      if (which("notify")) {
        await Process.run(["notify", title, message], { nothrow: true })
        return
      }
      return
    }

    if (os === "win32") {
      const script = [
        "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
        "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null",
        `$template = "<toast><visual><binding template='ToastText02'><text id='1'>${escapeXml(title)}</text><text id='2'>${escapeXml(message)}</text></binding></visual></toast>"`,
        "$xml = New-Object Windows.Data.Xml.Dom.XmlDocument",
        "$xml.LoadXml($template)",
        "$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)",
        '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("opencode").Show($toast)',
      ].join("; ")
      await Process.run(["powershell.exe", "-NonInteractive", "-NoProfile", "-Command", script], { nothrow: true })
      return
    }
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}
