import { createTuiBuildInfo, createTuiEnvironment, createTuiRenderer, run, type TuiHost } from "@opencode-ai/tui"
import { TuiConfig } from "@opencode-ai/tui/config"
import type { TuiPlatform } from "@opencode-ai/tui/platform"
import os from "node:os"
import path from "node:path"

declare const OPENCODE_VERSION: string | undefined
declare const OPENCODE_CHANNEL: string | undefined

export async function runTui(transport: { url: string; headers: RequestInit["headers"] }) {
  const config = TuiConfig.resolve({}, { terminalSuspend: false })
  const state = path.join(os.homedir(), ".local", "state", "opencode")
  const environment = createTuiEnvironment({
    cwd: process.cwd(),
    platform: process.platform,
    paths: {
      home: os.homedir(),
      state,
      worktree: path.join(state, "worktree"),
    },
    capabilities: {
      mouse: config.mouse,
      copyOnSelect: true,
      terminalTitle: true,
      terminalSuspend: false,
      workspaces: false,
      showTimeToFirstDraw: false,
    },
    terminal: {
      multiplexer: process.env.TMUX ? "tmux" : process.env.STY ? "screen" : undefined,
      displayServer: process.env.WAYLAND_DISPLAY ? "wayland" : process.env.DISPLAY ? "x11" : undefined,
    },
    editor: { zedTerminal: false },
    skipInitialLoading: false,
  })
  const build = createTuiBuildInfo({
    version: typeof OPENCODE_VERSION === "string" ? OPENCODE_VERSION : "local",
    channel: typeof OPENCODE_CHANNEL === "string" ? OPENCODE_CHANNEL : "local",
  })
  const renderer = await createTuiRenderer(config, { environment, build })
  const handle = run({
    ...transport,
    args: {},
    config,
    environment,
    build,
    renderer,
    fetch: gracefulFetch,
    pluginHost: {
      async start() {},
      async dispose() {},
    },
    host: createHost(),
  })
  await handle.done
}

function createHost(): TuiHost {
  return {
    platform,
    attention() {
      return {
        async notify() {
          return { ok: false, notification: false, sound: false, skipped: "attention_disabled" }
        },
        soundboard: {
          registerPack: () => () => {},
          activate: () => false,
          current: () => "",
          list: () => [],
        },
        dispose() {},
      }
    },
    logger: { error: (message, extra) => console.error(message, extra ?? "") },
    lifecycle: {
      onSighup(handler) {
        process.on("SIGHUP", handler)
        return () => process.off("SIGHUP", handler)
      },
      writeStdout: (text) => process.stdout.write(text),
      writeStderr: (text) => process.stderr.write(text),
    },
    formatError: () => undefined,
    formatUnknownError(error) {
      if (error instanceof Error) return error.message
      return String(error)
    },
  }
}

const platform: TuiPlatform = {
  files: {
    readText: (file) => Bun.file(file).text(),
    readBytes: async (file) => new Uint8Array(await Bun.file(file).arrayBuffer()),
    async mime(file) {
      return Bun.file(file).type || "application/octet-stream"
    },
  },
}

const legacyDefaults: Record<string, unknown> = {
  "/config/providers": { providers: [], default: {} },
  "/provider": { all: [], default: {}, connected: [] },
  "/agent": [],
  "/config": {},
}

const gracefulFetch = Object.assign(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetch(input, init)
    if (response.status !== 404) return response
    const fallback = legacyDefaults[new URL(input instanceof Request ? input.url : input).pathname]
    if (fallback === undefined) return response
    return Response.json(fallback)
  },
  { preconnect: fetch.preconnect },
)
