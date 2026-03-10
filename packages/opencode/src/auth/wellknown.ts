import { text } from "node:stream/consumers"
import { Auth } from "."
import { Process } from "../util/process"
import { Log } from "../util/log"

export namespace WellknownAuth {
  const log = Log.create({ service: "auth.wellknown" })

  export async function login(url: string) {
    const response = await fetch(`${url}/.well-known/opencode`)
    if (!response.ok) throw new Error(`failed to fetch well-known from ${url}: ${response.status}`)

    const wellknown = (await response.json()) as any
    if (!wellknown?.auth?.command) throw new Error(`no auth command in well-known from ${url}`)

    log.info(`Running \`${wellknown.auth.command.join(" ")}\``)
    const proc = Process.spawn(wellknown.auth.command, { stdout: "pipe" })
    if (!proc.stdout) throw new Error(`failed to spawn auth command for ${url}`)

    const [exit, token] = await Promise.all([proc.exited, text(proc.stdout)])
    if (exit !== 0) throw new Error(`auth command failed for ${url} (exit ${exit})`)

    await Auth.set(url, {
      type: "wellknown",
      key: wellknown.auth.env,
      token: token.trim(),
    })
  }

  export async function refreshAll() {
    const auth = await Auth.all()
    for (const [url, entry] of Object.entries(auth)) {
      if (entry.type !== "wellknown") continue
      try {
        await login(url)
        log.info("refreshed wellknown auth", { url })
      } catch (e) {
        log.warn("failed to refresh wellknown auth", { url, error: e })
      }
    }
  }
}
