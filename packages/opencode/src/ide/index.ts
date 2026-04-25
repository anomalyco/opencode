import { BusEvent } from "@/bus/bus-event"
import z from "zod"
import { Schema } from "effect"
import { NamedError } from "@opencode-ai/core/util/error"
import { Log } from "../util"
import { Process } from "@/util"

const SUPPORTED_IDES = [
  { name: "Windsurf" as const, cmd: "windsurf" },
  { name: "Visual Studio Code - Insiders" as const, cmd: "code-insiders" },
  { name: "Visual Studio Code" as const, cmd: "code" },
  { name: "Cursor" as const, cmd: "cursor" },
  { name: "VSCodium" as const, cmd: "codium" },
]

const log = Log.create({ service: "ide" })

export const Event = {
  Installed: BusEvent.define(
    "ide.installed",
    Schema.Struct({
      ide: Schema.String,
    }),
  ),
}

export const AlreadyInstalledError = NamedError.create("AlreadyInstalledError", z.object({}))

export const InstallFailedError = NamedError.create(
  "InstallFailedError",
  z.object({
    stderr: z.string(),
  }),
)

export function ide() {
  if (process.env["TERM_PROGRAM"] === "vscode") {
    const v = process.env["GIT_ASKPASS"]
    for (const ide of SUPPORTED_IDES) {
      if (v?.includes(ide.name)) return ide.name
    }
  }
  return "unknown"
}

export function alreadyInstalled() {
  return process.env["OPENCODE_CALLER"] === "vscode" || process.env["OPENCODE_CALLER"] === "vscode-insiders"
}

export async function install(ide: (typeof SUPPORTED_IDES)[number]["name"]) {
  const cmd = SUPPORTED_IDES.find((i) => i.name === ide)?.cmd
  if (!cmd) throw new Error(`Unknown IDE: ${ide}`)

  const p = await Process.run([cmd, "--install-extension", "sst-dev.opencode"], {
    nothrow: true,
  })
  const stdout = p.stdout.toString()
  const stderr = p.stderr.toString()

  log.info("installed", {
    ide,
    stdout,
    stderr,
  })

  if (p.code !== 0) {
    throw new InstallFailedError({ stderr })
  }
  if (stdout.includes("already installed")) {
    throw new AlreadyInstalledError({})
  }
}

export * as Ide from "."
