import type { Hooks, Plugin as PluginInstance } from "@opencode-ai/plugin"
import { App } from "../app/app"
import { Config } from "../config/config"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { Server } from "../server/server"
import { pathOr } from "remeda"

export namespace Plugin {
  const log = Log.create({ service: "plugin" })

  const state = App.state("plugin", async (app) => {
    const client = createOpencodeClient({
      baseUrl: "http://localhost:4096",
      fetch: async (...args) => Server.app().fetch(...args),
    })
    const config = await Config.get()
    const hooks = []
    for (const plugin of config.plugin ?? []) {
      log.info("loading plugin", { path: plugin })
      const mod = await import(plugin)
      for (const [_name, fn] of Object.entries<PluginInstance>(mod)) {
        const init = await fn({
          client,
          app,
          $: Bun.$,
        })
        hooks.push(init)
      }
    }

    return {
      hooks,
    }
  })

  type Path<T, Prefix extends string = ""> = T extends object
    ? {
        [K in keyof T]: K extends string
          ? T[K] extends Function | undefined
            ? `${Prefix}${K}`
            : Path<T[K], `${Prefix}${K}.`>
          : never
      }[keyof T]
    : never

  export type FunctionFromKey<T, P extends Path<T>> = P extends `${infer K}.${infer R}`
    ? K extends keyof T
      ? R extends Path<T[K]>
        ? FunctionFromKey<T[K], R>
        : never
      : never
    : P extends keyof T
      ? T[P]
      : never

  export async function trigger<
    Name extends Path<Required<Hooks>>,
    Input = Parameters<FunctionFromKey<Required<Hooks>, Name>>[0],
    Output = Parameters<FunctionFromKey<Required<Hooks>, Name>>[1],
  >(fn: Name, input: Input, output: Output): Promise<Output> {
    if (!fn) return output
    const path = fn.split(".")
    for (const hook of await state().then((x) => x.hooks)) {
      const fn = pathOr(hook, path, undefined)
      if (!fn) continue
      await fn(input, output)
    }
    return output
  }

  export function init() {
    Bus.subscribeAll(async (input) => {
      const hooks = await state().then((x) => x.hooks)
      for (const hook of hooks) {
        hook["event"]?.({
          event: input,
        })
      }
    })
  }
}
