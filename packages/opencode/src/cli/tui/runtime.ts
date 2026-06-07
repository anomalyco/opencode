import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { InstallationChannel, InstallationVersion } from "@opencode-ai/core/installation/version"
import type { TuiConfig } from "@opencode-ai/tui/config"
import { createTuiBuildInfo, createTuiEnvironment } from "@opencode-ai/tui/runtime"
import path from "path"
import { isZedTerminal, resolveZedDbPath } from "./editor-zed"

export function resolveTuiRuntime(config: TuiConfig.Resolved) {
  return {
    environment: createTuiEnvironment({
      cwd: process.cwd(),
      platform: process.platform,
      initialRoute: parseInitialRoute(process.env.OPENCODE_ROUTE),
      paths: {
        home: Global.Path.home,
        state: Global.Path.state,
        worktree: path.join(Global.Path.data, "worktree"),
      },
      capabilities: {
        mouse: !Flag.OPENCODE_DISABLE_MOUSE && (config.mouse ?? true),
        copyOnSelect: !Flag.OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT,
        terminalTitle: !Flag.OPENCODE_DISABLE_TERMINAL_TITLE,
        terminalSuspend: process.platform !== "win32",
        workspaces: Flag.OPENCODE_EXPERIMENTAL_WORKSPACES,
        showTimeToFirstDraw: Flag.OPENCODE_SHOW_TTFD,
      },
      terminal: {
        multiplexer: process.env.TMUX ? "tmux" : process.env.STY ? "screen" : undefined,
        displayServer: process.env.WAYLAND_DISPLAY ? "wayland" : process.env.DISPLAY ? "x11" : undefined,
      },
      editor: {
        command: process.env.VISUAL || process.env.EDITOR,
        port: parsePort(process.env.CLAUDE_CODE_SSE_PORT || process.env.OPENCODE_EDITOR_SSE_PORT),
        zedTerminal: isZedTerminal(),
        zedDatabase: resolveZedDbPath(),
      },
      skipInitialLoading: Boolean(process.env.OPENCODE_FAST_BOOT),
    }),
    build: createTuiBuildInfo({
      version: InstallationVersion,
      channel: InstallationChannel,
    }),
  }
}

function parsePort(value: string | undefined) {
  if (!value) return
  const port = Number.parseInt(value, 10)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return
  return port
}

function parseInitialRoute(value: string | undefined) {
  if (!value) return
  return JSON.parse(value) as unknown
}
