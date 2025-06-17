import path from "path"
import { $ } from "bun"
import { z } from "zod"
import { NamedError } from "../util/error"

export namespace Installation {
  export type Method = Awaited<ReturnType<typeof method>>

  export const Info = z
    .object({
      version: z.string(),
      latest: z.string(),
    })
    .openapi({
      ref: "InstallationInfo",
    })
  export type Info = z.infer<typeof Info>

  export async function info() {
    return {
      version: VERSION,
      latest: await latest(),
    }
  }

  export async function method() {
    if (process.execPath.includes(path.join(".opencode", "bin"))) return "curl"
    const exec = process.execPath.toLowerCase()

    const checks = [
      {
        name: "npm" as const,
        command: () => $`npm list -g --depth=0`.throws(false).text(),
      },
      {
        name: "yarn" as const,
        command: () => $`yarn global list`.throws(false).text(),
      },
      {
        name: "pnpm" as const,
        command: () => $`pnpm list -g --depth=0`.throws(false).text(),
      },
      {
        name: "bun" as const,
        command: () => $`bun pm ls -g`.throws(false).text(),
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
      if (output.includes("opencode-ai")) {
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

  export async function upgrade(method: Method, target: string) {
    const cmd = (() => {
      switch (method) {
        case "curl":
          return $`curl -fsSL https://opencode.ai/install | bash`
        case "npm":
          return $`npm install -g opencode-ai@${target}`
        case "pnpm":
          return $`pnpm install -g opencode-ai@${target}`
        case "bun":
          return $`bun install -g opencode-ai@${target}`
        default:
          throw new Error(`Unknown method: ${method}`)
      }
    })()
    const result = await cmd.quiet().throws(false)
    if (result.exitCode !== 0)
      throw new UpgradeFailedError({
        stderr: result.stderr.toString("utf8"),
      })
  }

  export const VERSION =
    typeof OPENCODE_VERSION === "string" ? OPENCODE_VERSION : "dev"

  export async function latest() {
    return fetch("https://api.github.com/repos/sst/opencode/releases/latest")
      .then((res) => res.json())
      .then((data) => data.tag_name.slice(1))
  }
}
