import "zod-openapi/extend"
import { Log } from "../util/log"
import { Context } from "../util/context"
import { Filesystem } from "../util/filesystem"
import { Global } from "../global"
import path from "path"
import os from "os"
import { z } from "zod"

export namespace App {
  const log = Log.create({ service: "app" })

  export const Info = z
    .object({
      user: z.string(),
      git: z.boolean(),
      path: z.object({
        config: z.string(),
        data: z.string(),
        root: z.string(),
        cwd: z.string(),
        state: z.string(),
      }),
      time: z.object({
        initialized: z.number().optional(),
      }),
    })
    .openapi({
      ref: "App.Info",
    })
  export type Info = z.infer<typeof Info>

  const ctx = Context.create<Awaited<ReturnType<typeof create>>>("app")

  const APP_JSON = "app.json"

  async function create(input: { cwd: string }) {
    log.info("creating", {
      cwd: input.cwd,
    })
    const git = await Filesystem.findUp(".git", input.cwd).then(([x]) =>
      x ? path.dirname(x) : undefined,
    )
    log.info("git", { git })

    const data = path.join(
      Global.Path.data,
      "project",
      git ? directory(git) : "global",
    )
    const stateFile = Bun.file(path.join(data, APP_JSON))
    const state = (await stateFile.json().catch(() => ({}))) as {
      initialized: number
    }
    await stateFile.write(JSON.stringify(state))

    const services = new Map<
      any,
      {
        state: any
        shutdown?: (input: any) => Promise<void>
      }
    >()

    const info: Info = {
      user: os.userInfo().username,
      time: {
        initialized: state.initialized,
      },
      git: git !== undefined,
      path: {
        config: Global.Path.config,
        state: Global.Path.state,
        data,
        root: git ?? input.cwd,
        cwd: input.cwd,
      },
    }
    const result = {
      services,
      info,
    }

    return result
  }

  export function state<State>(
    key: any,
    init: (app: Info) => State,
    shutdown?: (state: Awaited<State>) => Promise<void>,
  ) {
    return () => {
      const app = ctx.use()
      const services = app.services
      if (!services.has(key)) {
        log.info("registering service", { name: key })
        services.set(key, {
          state: init(app.info),
          shutdown,
        })
      }
      return services.get(key)?.state as State
    }
  }

  export function info() {
    return ctx.use().info
  }

  export async function provide<T>(
    input: { cwd: string },
    cb: (app: Info) => Promise<T>,
  ) {
    const app = await create(input)
    return ctx.provide(app, async () => {
      const result = await cb(app.info)
      for (const [key, entry] of app.services.entries()) {
        if (!entry.shutdown) continue
        log.info("shutdown", { name: key })
        await entry.shutdown?.(await entry.state)
      }
      return result
    })
  }

  export async function initialize() {
    const { info } = ctx.use()
    info.time.initialized = Date.now()
    await Bun.write(
      path.join(info.path.data, APP_JSON),
      JSON.stringify({
        initialized: Date.now(),
      }),
    )
  }

  function directory(input: string): string {
    return input
      .split(path.sep)
      .filter(Boolean)
      .join("-")
      .replace(/[^A-Za-z0-9_]/g, "-")
  }
}

