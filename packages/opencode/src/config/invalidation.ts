import { Bus } from "@/bus"
import { Config } from "./config"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import type { ConfigDiff } from "./diff"
import { Context } from "../util/context"
import { isConfigHotReloadEnabled } from "./hot-reload"

const log = Log.create({ service: "config.invalidation" })

type ApplyInput = {
  scope: "project" | "global"
  directory?: string
  diff: ConfigDiff
  refreshed?: boolean
}

let setupPromise: Promise<void> | undefined
async function invalidateProvider(diff: ConfigDiff): Promise<void> {
  await Instance.invalidate("provider")
}

async function invalidateMCP(diff: ConfigDiff): Promise<void> {
  await Instance.invalidate("mcp")
}

async function invalidateLSP(diff: ConfigDiff): Promise<void> {
  await Instance.invalidate("lsp")
}

async function invalidateFileWatcher(): Promise<void> {
  await Instance.invalidate("filewatcher")
}

async function invalidatePlugin(diff: ConfigDiff): Promise<void> {
  await Instance.invalidate("plugin")
}

async function invalidateToolRegistry(): Promise<void> {
  await Instance.invalidate("tool-registry")
}

async function invalidatePermission(): Promise<void> {
  await Instance.invalidate("permission")
}

async function invalidateCommandAgentFormat(diff: ConfigDiff): Promise<void> {
  if (diff.command) await Instance.invalidate("command")
  if (diff.agent) await Instance.invalidate("agent")
  if (diff.formatter) await Instance.invalidate("format")
}

async function invalidateUIAndPrompts(diff: ConfigDiff): Promise<void> {
  if (diff.instructions) await Instance.invalidate("instructions")
  if (diff.theme) await Instance.invalidate("theme")
}

async function applyInternal(input: ApplyInput) {
  const { diff, scope } = input
  const targetDirectory = input.directory ?? process.cwd()
  const directoryForLog = input.directory ?? targetDirectory
  const alreadyRefreshed = input.refreshed === true

  await Instance.provide({
    directory: targetDirectory,
    fn: async () => {
      if (!alreadyRefreshed) {
        await Instance.invalidate("config")
      }
      log.info("config.invalidate.stateRefreshed", { scope, directory: directoryForLog })

      if (Object.keys(diff).length === 0) {
        log.info("config.update.noop", { scope, directory: directoryForLog })
        return
      }

      const sections = Object.keys(diff).filter((k) => diff[k as keyof ConfigDiff] === true)
      const targets = new Set<string>()
      const tasks: Promise<void>[] = []
      const providerChanged = diff.provider || diff.model || diff.small_model || diff.disabled_providers
      if (providerChanged) {
        targets.add("provider")
        tasks.push(invalidateProvider(diff))
      }

      const mcpChanged = diff.mcp
      if (mcpChanged) {
        targets.add("mcp")
        tasks.push(invalidateMCP(diff))
      }

      const lspChanged = diff.lsp || diff.formatter
      if (lspChanged) {
        targets.add("lsp")
        tasks.push(invalidateLSP(diff))
      }

      const watcherChanged = diff.watcher
      if (watcherChanged) {
        targets.add("filewatcher")
        tasks.push(invalidateFileWatcher())
      }

      const pluginChanged = diff.plugin
      if (pluginChanged) {
        targets.add("plugin")
        tasks.push(invalidatePlugin(diff))
        targets.add("tool-registry")
        tasks.push(invalidateToolRegistry())
      }

      const permissionChanged = diff.permission
      if (permissionChanged) {
        targets.add("permission")
        tasks.push(invalidatePermission())
      }

      const commandAgentFormatChanged = diff.command || diff.agent || diff.formatter
      if (commandAgentFormatChanged) {
        if (diff.command) targets.add("command")
        if (diff.agent) targets.add("agent")
        if (diff.formatter) targets.add("format")
        tasks.push(invalidateCommandAgentFormat(diff))
      }

      const shareSettingsChanged = diff.share || diff.autoshare
      const uiChanged = diff.theme || diff.instructions || shareSettingsChanged
      if (uiChanged) {
        if (diff.theme) targets.add("theme")
        if (diff.instructions) targets.add("instructions")
        if (shareSettingsChanged) targets.add("share-settings")
        tasks.push(invalidateUIAndPrompts(diff))
      }

      log.info("config.invalidate.start", {
        scope,
        directory: directoryForLog,
        sections,
        targets: Array.from(targets),
      })

      try {
        await Promise.all(tasks)
      } catch (error) {
        log.error("Targeted config invalidation failed", {
          error: String(error),
        })
      }

      log.info("config.invalidate.complete", {
        scope,
        directory: directoryForLog,
        sections,
        targets: Array.from(targets),
      })
    },
  })
}
export namespace ConfigInvalidation {
  export async function apply(input: ApplyInput) {
    try {
      await applyInternal(input)
    } catch (error) {
      if (error instanceof Context.NotFound) {
        log.warn("config.invalidate.missingContext", { error: String(error) })
        return
      }
      throw error
    }
  }

  export async function setup() {
    if (setupPromise) {
      return setupPromise
    }

    setupPromise = (async () => {
      if (isConfigHotReloadEnabled()) {
        Bus.subscribe(Config.Event.Updated, async (event) => {
          const { diff, scope, directory, refreshed } = event.properties as any
          await apply({ diff, scope, directory, refreshed })
        })
      }
    })()

    return setupPromise
  }
}
