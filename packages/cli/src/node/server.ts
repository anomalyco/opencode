import "./plugin-runtime.promise"
import "./plugin-runtime.effect"

import { NodeServices } from "@effect/platform-node"
import type { BrowserControl } from "@opencode-ai/core/browser-control"
import { BrowserHost } from "@opencode-ai/core/browser-host"
import { ServerProcess } from "@opencode-ai/server/process"
import { Effect, Exit, ManagedRuntime, Scope } from "effect"
import { OPENCODE_CHANNEL, OPENCODE_VERSION } from "../version"

type ListenOptions = {
  readonly hostname: string
  readonly port: number
  readonly password: string
  readonly browserControl?: BrowserControl.Interface
}

export type Listener = { readonly stop: (close?: boolean) => Promise<void> }

/** Local desktop utility-process host. Remote and WSL browser brokers are intentionally future work. */
async function listen(options: ListenOptions): Promise<Listener> {
  const uninstall = options.browserControl ? BrowserHost.install(options.browserControl) : () => undefined
  const runtime = ManagedRuntime.make(NodeServices.layer)
  const scope = await runtime.runPromise(Scope.make())
  await runtime.runPromise(
    ServerProcess.start<never, never>({
      app: {
        name: process.env.OPENCODE_CLIENT ?? "desktop",
        version: OPENCODE_VERSION,
        channel: OPENCODE_CHANNEL,
      },
      hostname: options.hostname,
      port: options.port,
      password: options.password,
      database: {
        path:
          process.env.OPENCODE_DB ??
          (["latest", "beta", "prod"].includes(OPENCODE_CHANNEL) ||
          process.env.OPENCODE_DISABLE_CHANNEL_DB === "1" ||
          process.env.OPENCODE_DISABLE_CHANNEL_DB === "true"
            ? "opencode.db"
            : `opencode-${OPENCODE_CHANNEL.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`),
      },
      models: {
        url: process.env.OPENCODE_MODELS_URL,
        file: process.env.OPENCODE_MODELS_PATH,
        fetch: process.env.OPENCODE_DISABLE_MODELS_FETCH !== "1",
      },
      config: {
        directory: process.env.OPENCODE_CONFIG_DIR,
        project: process.env.OPENCODE_DISABLE_PROJECT_CONFIG !== "1",
        file: process.env.OPENCODE_CONFIG,
        content: process.env.OPENCODE_CONFIG_CONTENT,
      },
      windows: { gitbash: process.env.OPENCODE_GIT_BASH_PATH },
      fs: {
        filewatcher: !truthy(process.env.OPENCODE_FILEWATCHER_DISABLE ?? process.env.OPENCODE_DISABLE_FILEWATCHER),
        fff:
          process.env.OPENCODE_DISABLE_FFF === undefined
            ? process.platform !== "win32"
            : !truthy(process.env.OPENCODE_DISABLE_FFF),
      },
    }).pipe(Effect.provideService(Scope.Scope, scope)),
  )
  let stopped = false
  return {
    stop: async () => {
      if (stopped) return
      stopped = true
      await runtime.runPromise(Scope.close(scope, Exit.void))
      uninstall()
      await Effect.runPromise(runtime.disposeEffect)
    },
  }
}

export const Server = { listen }

function truthy(value?: string) {
  return value === "1" || value?.toLowerCase() === "true"
}
