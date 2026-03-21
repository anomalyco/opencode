import path from "path"
import { cmd } from "./cmd"
import { ConfigPaths } from "../../config/paths"
import { Config } from "../../config/config"
import { Instance } from "../../project/instance"
import { BunProc } from "../../bun"
import { UI } from "../ui"
import { Global } from "../../global"
import { Flag } from "../../flag/flag"

const ignored = ["opencode-openai-codex-auth", "opencode-copilot-auth"]
const pkg = /^(?:@[a-z0-9][a-z0-9-._~]*\/)?[a-z0-9][a-z0-9-._~]*$/i

function split(spec: string) {
  const at = spec.lastIndexOf("@")
  if (at > 0) return { pkg: spec.slice(0, at), version: spec.slice(at + 1) }
  return { pkg: spec, version: null }
}

function ignoredPlugin(spec: string) {
  return ignored.some((item) => spec.includes(item))
}

function unsupported(spec: string) {
  return (
    spec.startsWith("npm:") ||
    spec.includes("@npm:") ||
    spec.startsWith("workspace:") ||
    spec.includes("@workspace:") ||
    spec.startsWith("link:") ||
    spec.includes("@link:") ||
    spec.startsWith("patch:") ||
    spec.includes("@patch:") ||
    spec.startsWith("github:") ||
    spec.includes("@github:") ||
    spec.startsWith("git+") ||
    spec.startsWith("git@") ||
    spec.includes("://") ||
    spec.endsWith(".tgz")
  )
}

function classifyPlugin(spec: string) {
  if (spec.startsWith("file://")) return { kind: "local" as const, spec }
  if (ignoredPlugin(spec)) return { kind: "ignored" as const, spec }
  const item = split(spec)
  if (item.version && unsupported(item.version)) return { kind: "unsupported" as const, spec }
  if (unsupported(spec)) return { kind: "unsupported" as const, spec }
  if (!pkg.test(item.pkg)) return { kind: "unsupported" as const, spec }
  if (item.version) {
    return { kind: "locked" as const, pkg: item.pkg, spec, version: item.version }
  }
  return { kind: "npm" as const, pkg: item.pkg, spec, version: "latest" as const }
}

async function readPlugins(file: string) {
  const text = await Config.readFile(file)
  if (!text) return []
  const data = await ConfigPaths.parseText(text, file)
  if (!data || typeof data !== "object" || Array.isArray(data)) return []
  const list = (data as { plugin?: unknown }).plugin
  if (!Array.isArray(list)) return []
  return list.filter((item): item is string => typeof item === "string")
}

async function plugins() {
  let list = [...((await Config.getGlobal()).plugin ?? [])]

  if (Flag.OPENCODE_CONFIG) {
    list = list.concat(await readPlugins(Flag.OPENCODE_CONFIG))
  }

  for (const file of await ConfigPaths.projectFiles("opencode", Instance.directory, Instance.worktree)) {
    list = list.concat(await readPlugins(file))
  }

  if (Flag.OPENCODE_CONFIG_DIR) {
    for (const file of ConfigPaths.fileInDirectory(Flag.OPENCODE_CONFIG_DIR, "opencode")) {
      list = list.concat(await readPlugins(file))
    }
  }

  if (process.env.OPENCODE_CONFIG_CONTENT) {
    const data = await ConfigPaths.parseText(process.env.OPENCODE_CONFIG_CONTENT, {
      dir: Instance.directory,
      source: "OPENCODE_CONFIG_CONTENT",
    })
    if (
      data &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      Array.isArray((data as { plugin?: unknown }).plugin)
    ) {
      list = list.concat(
        (data as { plugin: unknown[] }).plugin.filter((item): item is string => typeof item === "string"),
      )
    }
  }

  return Config.deduplicatePlugins(list)
}

async function version(pkg: string) {
  return Bun.file(path.join(Global.Path.cache, "node_modules", pkg, "package.json"))
    .json()
    .then((x) => (typeof x.version === "string" ? x.version : null))
    .catch(() => null)
}

function line(spec: string, state: string, msg?: string) {
  UI.println(msg ? `${state} ${spec} ${msg}` : `${state} ${spec}`)
}

function detail(err: unknown) {
  if (!(err instanceof Error)) return String(err)
  const cause = err.cause
  if (cause instanceof Error) return cause.message
  return err.message
}

export const PluginUpdateCommand = cmd({
  command: "update",
  describe: "update configured npm plugins",
  handler: async (_args: { _: (string | number)[]; $0: string }) => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const items = (await plugins()).map(classifyPlugin)
        const list = items.filter((x) => x.kind === "npm")
        const total = { updated: 0, current: 0, skipped: 0, failed: 0 }

        if (!list.length) {
          UI.println("No config npm plugins to update")
        }

        for (const item of items) {
          if (item.kind === "locked") {
            total.skipped += 1
            line(item.spec, "skipped_locked")
            continue
          }
          if (item.kind === "local") {
            total.skipped += 1
            line(item.spec, "skipped_local")
            continue
          }
          if (item.kind === "ignored") {
            total.skipped += 1
            line(item.spec, "skipped_ignored")
            continue
          }
          if (item.kind === "unsupported") {
            total.skipped += 1
            line(item.spec, "skipped_unsupported")
            continue
          }

          const before = await version(item.pkg)
          const err = await BunProc.install(item.pkg, "latest")
            .then(() => null)
            .catch((err) => err)
          if (err) {
            total.failed += 1
            line(item.spec, "failed", detail(err))
            continue
          }
          const after = await version(item.pkg)
          if (!before || before !== after) {
            total.updated += 1
            line(item.spec, "updated")
            continue
          }
          total.current += 1
          line(item.spec, "current")
        }

        UI.println(`updated=${total.updated} current=${total.current} skipped=${total.skipped} failed=${total.failed}`)
        if (total.failed) process.exitCode = 1
      },
    })
  },
})

export const PluginCommand = cmd({
  command: "plugin",
  describe: "manage configured plugins",
  builder: (yargs) => yargs.command(PluginUpdateCommand).demandCommand(),
  handler: async () => {},
})
