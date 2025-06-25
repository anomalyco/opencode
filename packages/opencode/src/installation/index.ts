import path from "path"
import { $ } from "bun"
import { z } from "zod"
import { Bus } from "../bus"

declare global {
  const OPENCODE_VERSION: string
}

export namespace Installation {
  export type Method = Awaited<ReturnType<typeof method>>

  export const Event = {
    Updated: Bus.event(
      "installation.updated",
      z.object({
        version: z.string(),
      }),
    ),
  }

  export const Info = z
    .object({
      version: z.string(),
    })
    .openapi({
      ref: "InstallationInfo",
    })
  export type Info = z.infer<typeof Info>

  export async function info() {
    return {
      version: VERSION,
    }
  }

  export function isSnapshot() {
    return VERSION.startsWith("0.0.0")
  }

  export function isDev() {
    return VERSION === "dev"
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
      {
        name: "brew" as const,
        command: () => $`brew list --formula opencode-ai`.throws(false).text(),
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



  export const VERSION =
    typeof OPENCODE_VERSION === "string" ? OPENCODE_VERSION : "dev"
}
