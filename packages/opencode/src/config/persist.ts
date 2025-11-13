import path from "path"
import fs from "fs/promises"
import { mergeDeep } from "remeda"
import { Config } from "./config"
import { acquireLock } from "./lock"
import { createBackup, restoreBackup } from "./backup"
import { writeConfigFile, writeFileAtomically } from "./write"
import { computeDiff, type ConfigDiff } from "./diff"
import { ConfigUpdateError, ConfigValidationError, ConfigWriteError } from "./error"
import { Instance } from "@/project/instance"
import { State } from "@/project/state"
import { resolveGlobalFile } from "./global-file"
import { Log } from "@/util/log"
import { parse as parseJsonc } from "jsonc-parser"
import z from "zod"
import { isConfigHotReloadEnabled } from "./hot-reload"

const log = Log.create({ service: "config.persist" })

async function determineTargetFile(scope: "project" | "global", directory: string): Promise<string> {
  if (scope === "global") {
    return resolveGlobalFile()
  }

  const candidates = [
    path.join(directory, ".opencode", "opencode.jsonc"),
    path.join(directory, ".opencode", "opencode.json"),
    path.join(directory, "opencode.jsonc"),
    path.join(directory, "opencode.json"),
  ]

  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) {
      return candidate
    }
  }

  const defaultPath = path.join(directory, ".opencode", "opencode.jsonc")
  await fs.mkdir(path.dirname(defaultPath), { recursive: true })
  return defaultPath
}

async function loadFileContent(filepath: string): Promise<string | null> {
  if (!(await Bun.file(filepath).exists())) {
    return null
  }

  return Bun.file(filepath).text()
}

function normalizeConfig(config: Config.Info): Config.Info {
  return {
    $schema: config.$schema || "https://opencode.ai/schema/config.json",
    ...config,
    agent: config.agent || {},
    mode: config.mode || {},
    plugin: config.plugin || [],
  }
}

export async function update(input: { scope: "project" | "global"; update: Config.Info; directory: string }): Promise<{
  before: Config.Info
  after: Config.Info
  diff: ConfigDiff
  diffForPublish: ConfigDiff
  filepath: string
}> {
  const filepath = await determineTargetFile(input.scope, input.directory)
  const release = await acquireLock(filepath)

  log.info("config.update.start", {
    scope: input.scope,
    directory: input.directory,
    filepath,
  })

  const beforeGlobal = input.scope === "global" ? await Config.global() : undefined

  try {
    const backupPath = await createBackup(filepath)

    try {
      const before = await Config.get()

      const existingContent = await loadFileContent(filepath)
      const fileContent = existingContent ? parseJsonc(existingContent) : {}
      const previousParsed = existingContent ? Config.Info.safeParse(fileContent) : undefined
      const previousNormalized = previousParsed?.success ? normalizeConfig(previousParsed.data) : undefined

      const merged = mergeDeep(fileContent, input.update)

      const validated = Config.Info.parse(merged)

      const normalized = normalizeConfig(validated)
      const writerDiff = previousNormalized ? computeDiff(previousNormalized, normalized) : undefined

      await writeConfigFile(filepath, normalized, existingContent, {
        diff: writerDiff,
        previous: previousNormalized,
      }).catch((error) => {
        log.error("JSONC write failed, attempting fallback", {
          filepath,
          error: String(error),
        })

        const content = JSON.stringify(normalized, null, 2) + "\n"
        return writeFileAtomically(filepath, content)
      })

      const hotReloadEnabled = isConfigHotReloadEnabled()
      if (hotReloadEnabled && input.scope === "global") {
        await State.invalidate("config")
      }
      if (hotReloadEnabled && input.scope === "project") {
        await Instance.invalidate("config")
      }

      log.info("config.update.cacheInvalidated", {
        scope: input.scope,
        directory: input.directory,
        filepath,
        cacheInvalidated: hotReloadEnabled && input.scope === "global",
        hotReloadEnabled,
      })

      const after = hotReloadEnabled ? await Config.get() : await Config.readFreshConfig()
      const afterGlobal = input.scope === "global" ? await Config.global() : undefined

      const diff = computeDiff(before, after)
      const diffForPublish = input.scope === "global" ? computeDiff(beforeGlobal!, afterGlobal!) : diff

      if (await Bun.file(backupPath).exists()) {
        await fs.unlink(backupPath)
      }

      log.info("config.update.persisted", {
        scope: input.scope,
        directory: input.directory,
        filepath,
      })

      return { before, after, diff, diffForPublish, filepath }
    } catch (error) {
      if (await Bun.file(backupPath).exists()) {
        await restoreBackup(backupPath, filepath).catch((restoreError) => {
          log.error("Failed to restore backup", {
            backupPath,
            filepath,
            error: String(restoreError),
          })
          throw new ConfigWriteError({
            filepath,
            operation: "restore",
            cause: restoreError,
          })
        })
      }

      if (error instanceof z.ZodError) {
        const errors = error.issues.map((e: z.ZodIssue) => ({
          field: e.path.join("."),
          message: e.message,
          expected: "expected" in e ? String((e as any).expected) : undefined,
          received: JSON.stringify("received" in e ? (e as any).received : undefined),
        }))

        throw new ConfigValidationError({ filepath, errors })
      }

      throw new ConfigUpdateError(
        {
          filepath,
          scope: input.scope,
          directory: input.directory,
          cause: error,
        },
        { cause: error instanceof Error ? error : undefined },
      )
    }
  } finally {
    await release()
  }
}
