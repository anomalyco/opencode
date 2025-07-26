import { $ } from "bun"
import { z } from "zod"
import { NamedError } from "../util/error"
import { Log } from "../util/log"
import { Bus } from "../bus"

const SUPPORTED_IDES = ["Windsurf", "Visual Studio Code", "Cursor", "VSCodium"] as const

export namespace Ide {
  const log = Log.create({ service: "ide" })

  export const Event = {
    Installed: Bus.event(
      "ide.installed",
      z.object({
        ide: z.string(),
      }),
    ),
  }

  export type Ide = Awaited<ReturnType<typeof ide>>

  export const AlreadyInstalledError = NamedError.create("AlreadyInstalledError", z.object({}))

  export const InstallFailedError = NamedError.create(
    "InstallFailedError",
    z.object({
      stderr: z.string(),
    }),
  )

  export async function ide() {
    if (process.env["TERM_PROGRAM"] === "vscode") {
      const v = process.env["GIT_ASKPASS"]
      for (const ide of SUPPORTED_IDES) {
        if (v?.includes(ide)) return ide
      }
    }
    return "unknown"
  }

  export function alreadyInstalled() {
    return process.env["OPENCODE_CALLER"] === "vscode"
  }

  export async function install(ide: Ide) {
    const cmd = (() => {
      switch (ide) {
        case "Windsurf":
          return $`windsurf --install-extension sst-dev.opencode`
        case "Visual Studio Code":
          return $`code --install-extension sst-dev.opencode`
        case "Cursor":
          return $`cursor --install-extension sst-dev.opencode`
        case "VSCodium":
          return $`codium --install-extension sst-dev.opencode`
        default:
          throw new Error(`Unknown IDE: ${ide}`)
      }
    })()
    // TODO: check OPENCODE_CALLER
    const result = await cmd.quiet().throws(false)
    log.info("installed", {
      ide,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    })
    if (result.exitCode !== 0)
      throw new InstallFailedError({
        stderr: result.stderr.toString("utf8"),
      })
    if (result.stdout.toString().includes("already installed")) throw new AlreadyInstalledError({})
  }
}
