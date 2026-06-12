export * as PtyPreparation from "./pty-preparation"

import { Config } from "@/config/config"
import * as InstanceState from "@/effect/instance-state"
import { Plugin } from "@/plugin"
import { Shell } from "@/shell/shell"
import { Pty } from "@opencode-ai/core/pty"
import { Effect } from "effect"

export const prepareCreate = Effect.fn("PtyPreparation.prepareCreate")(function* (input: Pty.CreateInput) {
  const config = yield* Config.Service
  const plugin = yield* Plugin.Service
  const command = input.command || Shell.preferred((yield* config.get()).shell)
  const args = Shell.login(command) ? [...(input.args ?? []), "-l"] : [...(input.args ?? [])]
  const cwd = input.cwd || (yield* InstanceState.context).directory
  const shell = yield* plugin.trigger("shell.env", { cwd }, { env: {} })
  const env = {
    ...process.env,
    ...input.env,
    ...shell.env,
    TERM: "xterm-256color",
    OPENCODE_TERMINAL: "1",
  } as Record<string, string>
  if (process.platform === "win32") {
    env.LC_ALL = "C.UTF-8"
    env.LC_CTYPE = "C.UTF-8"
    env.LANG = "C.UTF-8"
  }
  return { command, args, cwd, title: input.title, env }
})
