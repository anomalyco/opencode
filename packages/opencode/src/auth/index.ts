import path from "path"
import { Global } from "../global"
import fs from "fs/promises"
import { z } from "zod"
import { Log } from "../util/log"
import { App } from "../app/app"

export namespace Auth {
  const log = Log.create({ service: "auth" })

  export const Oauth = z
    .object({
      type: z.literal("oauth"),
      refresh: z.string(),
      access: z.string(),
      expires: z.number(),
    })
    .openapi({ ref: "OAuth" })

  export const Api = z
    .object({
      type: z.literal("api"),
      key: z.string(),
    })
    .openapi({ ref: "ApiAuth" })

  export const WellKnown = z
    .object({
      type: z.literal("wellknown"),
      key: z.string(),
      token: z.string(),
    })
    .openapi({ ref: "WellKnownAuth" })

  export const Helper = z.object({
    type: z.literal("helper"),
    command: z.array(z.string()),
    refreshInterval: z.number().default(3600), // 1 hour default
    timeout: z.number().default(5000), // 5 seconds default
    lastFetched: z.number().optional(),
    cachedKey: z.string().optional(),
  })

  export const Info = z.discriminatedUnion("type", [Oauth, Api, WellKnown, Helper]).openapi({ ref: "Auth" })
  export type Info = z.infer<typeof Info>

  const filepath = path.join(Global.Path.data, "auth.json")

  const helperCache = new Map<string, { key: string; expires: number }>()

  export async function get(providerID: string) {
    const file = Bun.file(filepath)
    return file
      .json()
      .catch(() => ({}))
      .then((x) => x[providerID] as Info | undefined)
  }

  export async function all(): Promise<Record<string, Info>> {
    const file = Bun.file(filepath)
    return file.json().catch(() => ({}))
  }

  export async function set(key: string, info: Info) {
    const file = Bun.file(filepath)
    const data = await all()
    await Bun.write(file, JSON.stringify({ ...data, [key]: info }, null, 2))
    await fs.chmod(file.name!, 0o600)
  }

  export async function remove(key: string) {
    const file = Bun.file(filepath)
    const data = await all()
    delete data[key]
    await Bun.write(file, JSON.stringify(data, null, 2))
    await fs.chmod(file.name!, 0o600)
  }

  export async function executeHelper(providerID: string, helper: z.infer<typeof Helper>): Promise<string | undefined> {
    const now = Date.now()
    const cacheKey = `${providerID}-${JSON.stringify(helper.command)}`

    const cached = helperCache.get(cacheKey)
    if (cached && cached.expires > now) {
      log.debug("using cached helper result", { providerID })
      return cached.key
    }

    if (helper.cachedKey && helper.lastFetched && now - helper.lastFetched < helper.refreshInterval * 1000) {
      log.debug("using stored helper result", { providerID })
      helperCache.set(cacheKey, {
        key: helper.cachedKey,
        expires: helper.lastFetched + helper.refreshInterval * 1000,
      })
      return helper.cachedKey
    }

    try {
      log.info("executing helper command", { providerID, command: helper.command })

      const process = Bun.spawn({
        cmd: helper.command,
        cwd: App.info().path.cwd,
        timeout: helper.timeout,
        stdout: "pipe",
        stderr: "pipe",
      })

      await process.exited

      if (process.exitCode !== 0) {
        const stderr = await new Response(process.stderr).text()
        log.error("helper command failed", { providerID, exitCode: process.exitCode, stderr })
        return undefined
      }

      const stdout = await new Response(process.stdout).text()
      const apiKey = stdout.trim()

      if (!apiKey) {
        log.error("helper command returned empty result", { providerID })
        return undefined
      }

      const updatedHelper: z.infer<typeof Helper> = {
        ...helper,
        cachedKey: apiKey,
        lastFetched: now,
      }

      await set(providerID, updatedHelper)

      helperCache.set(cacheKey, {
        key: apiKey,
        expires: now + helper.refreshInterval * 1000,
      })

      log.info("helper command executed successfully", { providerID })
      return apiKey
    } catch (error) {
      log.error("helper command execution failed", {
        providerID,
        error: error instanceof Error ? error.message : String(error),
      })
      return undefined
    }
  }
}
