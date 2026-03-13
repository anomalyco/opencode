import { BusEvent } from "@/bus/bus-event"
import path from "path"
import z from "zod"
import { NamedError } from "@opencode-ai/util/error"
import { Log } from "../util/log"
import { iife } from "@/util/iife"
import { Flag } from "../flag/flag"
import { Process } from "@/util/process"
import { buffer } from "node:stream/consumers"

declare global {
  const OPENCODE_VERSION: string
  const OPENCODE_CHANNEL: string
}

export namespace Installation {
  const log = Log.create({ service: "installation" })

  async function text(cmd: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
    return Process.text(cmd, {
      cwd: opts.cwd,
      env: opts.env,
      nothrow: true,
    }).then((x) => x.text)
  }

  async function upgradeCurl(target: string) {
    const body = await fetch("https://opencode.ai/install").then((res) => {
      if (!res.ok) throw new Error(res.statusText)
      return res.text()
    })
    const proc = Process.spawn(["bash"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        VERSION: target,
      },
    })
    if (!proc.stdin || !proc.stdout || !proc.stderr) throw new Error("Process output not available")
    proc.stdin.end(body)
    const [code, stdout, stderr] = await Promise.all([proc.exited, buffer(proc.stdout), buffer(proc.stderr)])
    return {
      code,
      stdout,
      stderr,
    }
  }

  export type Method = Awaited<ReturnType<typeof method>>

  export const Event = {
    Updated: BusEvent.define(
      "installation.updated",
      z.object({
        version: z.string(),
      }),
    ),
    UpdateAvailable: BusEvent.define(
      "installation.update-available",
      z.object({
        version: z.string(),
      }),
    ),
  }

  export const Info = z
    .object({
      version: z.string(),
      latest: z.string(),
    })
    .meta({
      ref: "InstallationInfo",
    })
  export type Info = z.infer<typeof Info>

  export async function info() {
    return {
      version: VERSION,
      latest: await latest(),
    }
  }

  export function isPreview() {
    return CHANNEL !== "latest"
  }

  export function isLocal() {
    return CHANNEL === "local"
  }

  export async function method() {
    if (process.execPath.includes(path.join(".opencode", "bin"))) return "curl"
    if (process.execPath.includes(path.join(".local", "bin"))) return "curl"
    const exec = process.execPath.toLowerCase()

    const checks = [
      {
        name: "npm" as const,
        command: () => text(["npm", "list", "-g", "--depth=0"]),
      },
      {
        name: "yarn" as const,
        command: () => text(["yarn", "global", "list"]),
      },
      {
        name: "pnpm" as const,
        command: () => text(["pnpm", "list", "-g", "--depth=0"]),
      },
      {
        name: "bun" as const,
        command: () => text(["bun", "pm", "ls", "-g"]),
      },
      {
        name: "brew" as const,
        command: () => text(["brew", "list", "--formula", "opencode"]),
      },
      {
        name: "scoop" as const,
        command: () => text(["scoop", "list", "opencode"]),
      },
      {
        name: "choco" as const,
        command: () => text(["choco", "list", "--limit-output", "opencode"]),
      },
    ]

    checks.sort((a, b) => {
      const aMatches = exec.includes(a.name)
      const bMatches = exec.includes(b.name)
      if (aMatches && !bMatches) return -1
      if (!aMatches && bMatches) return 1
      return 0
    })

    for (const check of checks) {
      const output = await check.command()
      const installedName =
        check.name === "brew" || check.name === "choco" || check.name === "scoop" ? "opencode" : "opencode-ai"
      if (output.includes(installedName)) {
        return check.name
      }
    }

    return "unknown"
  }

  export const UpgradeFailedError = NamedError.create(
    "UpgradeFailedError",
    z.object({
      stderr: z.string(),
    }),
  )

  async function getBrewFormula() {
    const tapFormula = await text(["brew", "list", "--formula", "anomalyco/tap/opencode"])
    if (tapFormula.includes("opencode")) return "anomalyco/tap/opencode"
    const coreFormula = await text(["brew", "list", "--formula", "opencode"])
    if (coreFormula.includes("opencode")) return "opencode"
    return "opencode"
  }

  export async function upgrade(method: Method, target: string) {
    let result: Awaited<ReturnType<typeof upgradeCurl>> | undefined
    switch (method) {
      case "curl":
        result = await upgradeCurl(target)
        break
      case "npm":
        result = await Process.run(["npm", "install", "-g", `opencode-ai@${target}`], { nothrow: true })
        break
      case "pnpm":
        result = await Process.run(["pnpm", "install", "-g", `opencode-ai@${target}`], { nothrow: true })
        break
      case "bun":
        result = await Process.run(["bun", "install", "-g", `opencode-ai@${target}`], { nothrow: true })
        break
      case "brew": {
        const formula = await getBrewFormula()
        const env = {
          HOMEBREW_NO_AUTO_UPDATE: "1",
          ...process.env,
        }
        if (formula.includes("/")) {
          const tap = await Process.run(["brew", "tap", "anomalyco/tap"], { env, nothrow: true })
          if (tap.code !== 0) {
            result = tap
            break
          }
          const repo = await Process.text(["brew", "--repo", "anomalyco/tap"], { env, nothrow: true })
          if (repo.code !== 0) {
            result = repo
            break
          }
          const dir = repo.text.trim()
          if (dir) {
            const pull = await Process.run(["git", "pull", "--ff-only"], { cwd: dir, env, nothrow: true })
            if (pull.code !== 0) {
              result = pull
              break
            }
          }
        }
        result = await Process.run(["brew", "upgrade", formula], { env, nothrow: true })
        break
      }

      case "choco":
        result = await Process.run(["choco", "upgrade", "opencode", `--version=${target}`, "-y"], { nothrow: true })
        break
      case "scoop":
        result = await Process.run(["scoop", "install", `opencode@${target}`], { nothrow: true })
        break
      default:
        throw new Error(`Unknown method: ${method}`)
    }
    if (!result || result.code !== 0) {
      const stderr =
        method === "choco" ? "not running from an elevated command shell" : result?.stderr.toString("utf8") || ""
      throw new UpgradeFailedError({
        stderr: stderr,
      })
    }
    log.info("upgraded", {
      method,
      target,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    })
    await Process.text([process.execPath, "--version"], { nothrow: true })
  }

  export const VERSION = typeof OPENCODE_VERSION === "string" ? OPENCODE_VERSION : "local"
  export const CHANNEL = typeof OPENCODE_CHANNEL === "string" ? OPENCODE_CHANNEL : "local"
  export const USER_AGENT = `opencode/${CHANNEL}/${VERSION}/${Flag.OPENCODE_CLIENT}`

  export async function latest(installMethod?: Method) {
    const detectedMethod = installMethod || (await method())

    if (detectedMethod === "brew") {
      const formula = await getBrewFormula()
      if (formula.includes("/")) {
        const infoJson = await text(["brew", "info", "--json=v2", formula])
        const info = JSON.parse(infoJson)
        const version = info.formulae?.[0]?.versions?.stable
        if (!version) throw new Error(`Could not detect version for tap formula: ${formula}`)
        return version
      }
      return fetch("https://formulae.brew.sh/api/formula/opencode.json")
        .then((res) => {
          if (!res.ok) throw new Error(res.statusText)
          return res.json()
        })
        .then((data: any) => data.versions.stable)
    }

    if (detectedMethod === "npm" || detectedMethod === "bun" || detectedMethod === "pnpm") {
      const registry = await iife(async () => {
        const r = (await text(["npm", "config", "get", "registry"])).trim()
        const reg = r || "https://registry.npmjs.org"
        return reg.endsWith("/") ? reg.slice(0, -1) : reg
      })
      const channel = CHANNEL
      return fetch(`${registry}/opencode-ai/${channel}`)
        .then((res) => {
          if (!res.ok) throw new Error(res.statusText)
          return res.json()
        })
        .then((data: any) => data.version)
    }

    if (detectedMethod === "choco") {
      return fetch(
        "https://community.chocolatey.org/api/v2/Packages?$filter=Id%20eq%20%27opencode%27%20and%20IsLatestVersion&$select=Version",
        { headers: { Accept: "application/json;odata=verbose" } },
      )
        .then((res) => {
          if (!res.ok) throw new Error(res.statusText)
          return res.json()
        })
        .then((data: any) => data.d.results[0].Version)
    }

    if (detectedMethod === "scoop") {
      return fetch("https://raw.githubusercontent.com/ScoopInstaller/Main/master/bucket/opencode.json", {
        headers: { Accept: "application/json" },
      })
        .then((res) => {
          if (!res.ok) throw new Error(res.statusText)
          return res.json()
        })
        .then((data: any) => data.version)
    }

    return fetch("https://api.github.com/repos/anomalyco/opencode/releases/latest")
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText)
        return res.json()
      })
      .then((data: any) => data.tag_name.replace(/^v/, ""))
  }
}
