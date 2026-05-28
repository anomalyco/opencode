import { EOL } from "os"
import path from "path"
import { Effect } from "effect"
import * as prompts from "@clack/prompts"
import type { Argv } from "yargs"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { ConfigPaths } from "@/config/paths"
import { ConfigRepair } from "@/config/repair"
import { cmd } from "./cmd"
import { effectCmd, fail } from "../effect-cmd"

type Scope = "global" | "project" | "custom"
type ConfigFile = {
  path: string
  scope: Scope
}

type ScopeArgs = {
  global?: boolean
  project?: boolean
}

export const ConfigCommand = cmd({
  command: "config",
  describe: "manage configuration files",
  builder: (yargs) =>
    yargs.command(ConfigCheckCommand).command(ConfigRepairCommand).command(ConfigResetCommand).demandCommand(),
  async handler() {},
})

const ConfigCheckCommand = effectCmd({
  command: "check",
  describe: "validate configuration files",
  builder: (yargs) => scopeOptions(yargs),
  instance: false,
  handler: Effect.fn("Cli.config.check")(function* (args: ScopeArgs) {
    yield* runConfigInspection({ repair: false, scopes: selectedScopes(args) })
  }),
})

const ConfigRepairCommand = effectCmd({
  command: "repair",
  describe: "remove safely repairable configuration errors",
  builder: (yargs) => scopeOptions(yargs),
  instance: false,
  handler: Effect.fn("Cli.config.repair")(function* (args: ScopeArgs) {
    yield* runConfigInspection({ repair: true, scopes: selectedScopes(args) })
  }),
})

const ConfigResetCommand = effectCmd({
  command: "reset",
  describe: "back up and reset config files to an empty config",
  builder: (yargs) =>
    scopeOptions(yargs)
      .option("yes", {
        describe: "skip confirmation prompt",
        type: "boolean",
      })
      .option("all", {
        describe: "reset valid config files too",
        type: "boolean",
      }),
  instance: false,
  handler: Effect.fn("Cli.config.reset")(function* (args: ScopeArgs & { yes?: boolean; all?: boolean }) {
    const files = (yield* collectConfigFiles(selectedScopes(args))).filter((file) => file.scope !== "custom")

    if (!files.length) {
      process.stdout.write("No config files found to reset." + EOL)
      return
    }

    const targets = yield* Effect.forEach(files, (file) =>
      Effect.gen(function* () {
        const text = (yield* AppFileSystem.Service.use((fs) => fs.readFileStringSafe(file.path)).pipe(Effect.orDie)) ?? ""
        return {
          file,
          text,
          inspection: yield* ConfigRepair.inspect(text, file.path),
        }
      }),
    ).pipe(Effect.map((items) => (args.all ? items : items.filter((item) => !item.inspection.valid))))

    if (!targets.length) {
      process.stdout.write("No invalid config files found. Use `opencode config reset --all` to reset valid config too." + EOL)
      return
    }

    process.stdout.write(
      `The following config ${targets.length === 1 ? "file" : "files"} will be backed up and reset:${EOL}`,
    )
    for (const target of targets) {
      process.stdout.write(`  - ${formatFile(target.file)}${target.inspection.valid ? " (valid)" : " (invalid)"}${EOL}`)
    }

    if (!args.yes) {
      if (!process.stdin.isTTY) {
        return yield* fail("Refusing to reset config without confirmation. Re-run with `--yes` to apply.")
      }

      const confirm = yield* Effect.promise(() =>
        prompts.confirm({
          message: "Reset these config files?",
          initialValue: false,
        }),
      )
      if (prompts.isCancel(confirm) || !confirm) {
        prompts.outro("Cancelled")
        return
      }
    }

    const fs = yield* AppFileSystem.Service
    for (const target of targets) {
      const backup = `${target.file.path}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`
      yield* fs.writeFileString(backup, target.text).pipe(Effect.orDie)
      yield* fs
        .writeFileString(target.file.path, JSON.stringify({ $schema: "https://opencode.ai/config.json" }, null, 2) + EOL)
        .pipe(Effect.orDie)
      process.stdout.write(`${formatFile(target.file)}: reset (backup: ${backup})${EOL}`)
      process.stdout.write(
        `  Tip: start opencode again, then ask the agent to inspect ${backup} and copy back the settings you still want.${EOL}`,
      )
    }
  }),
})

const runConfigInspection = Effect.fn("Cli.config.inspect")(function* (input: { repair: boolean; scopes: Scope[] }) {
  const fs = yield* AppFileSystem.Service
  const files = yield* collectConfigFiles(input.scopes)

  if (!files.length) {
    process.stdout.write("No config files found" + EOL)
    return
  }

  const results = yield* Effect.forEach(files, (file) =>
    Effect.gen(function* () {
      const before = (yield* fs.readFileStringSafe(file.path).pipe(Effect.orDie)) ?? ""
      const inspection = yield* ConfigRepair.inspect(before, file.path)
      if (!input.repair || !inspection.fixPaths.length) return { file, inspection, fixed: false, fixedPaths: [] }

      const after = ConfigRepair.applyFixes(before, inspection)
      const backup = `${file.path}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`
      if (after !== before) {
        yield* fs.writeFileString(backup, before).pipe(Effect.orDie)
        yield* fs.writeFileString(file.path, after).pipe(Effect.orDie)
      }
      return {
        file,
        inspection: yield* ConfigRepair.inspect(after, file.path),
        fixed: after !== before,
        fixedPaths: inspection.fixPaths,
        backup,
      }
    }),
  )

  for (const result of results) {
    if (result.inspection.valid && !result.fixed) {
      process.stdout.write(`${formatFile(result.file)}: ok${EOL}`)
      continue
    }
    if (result.inspection.valid) {
      process.stdout.write(`${formatFile(result.file)}: repaired ${result.fixedPaths.map(formatPath).join(", ")}${EOL}`)
      process.stdout.write(`  backup: ${result.backup}${EOL}`)
      continue
    }

    process.stdout.write(`${formatFile(result.file)}: invalid${EOL}`)
    if (result.inspection.message) process.stdout.write(`  ${result.inspection.message}${EOL}`)
    for (const issue of result.inspection.issues) {
      process.stdout.write(`  - ${issue.message}${issue.path.length ? ` (${issue.path.join(".")})` : ""}${EOL}`)
    }
    if (result.inspection.fixPaths.length && !input.repair) {
      process.stdout.write(`  repairable: ${result.inspection.fixPaths.map(formatPath).join(", ")}${EOL}`)
      process.stdout.write("  run: opencode config repair" + EOL)
      continue
    }
    if (result.inspection.candidatePaths.length) {
      process.stdout.write("  automatic repair skipped because removing the reported fields did not make the file valid" + EOL)
      process.stdout.write(recoveryHint(result.file))
      continue
    }
    process.stdout.write("  automatic repair is not available." + EOL)
    process.stdout.write(recoveryHint(result.file))
  }

  if (results.every((result) => result.inspection.valid)) process.stdout.write(`Config files are valid (${results.length} checked).${EOL}`)
  if (results.some((result) => !result.inspection.valid)) process.exitCode = 1
})

const collectConfigFiles = Effect.fn("Cli.config.files")(function* (scopes: Scope[]) {
  const fs = yield* AppFileSystem.Service
  const directories = yield* ConfigPaths.directories(process.cwd()).pipe(Effect.orDie)
  const projectFiles = !Flag.OPENCODE_DISABLE_PROJECT_CONFIG
    ? yield* ConfigPaths.files("opencode", process.cwd()).pipe(Effect.orDie)
    : []
  const configDirFiles = directories
    .filter((dir) => dir.endsWith(".opencode") || dir === Flag.OPENCODE_CONFIG_DIR)
    .flatMap((dir) =>
      ConfigPaths.fileInDirectory(dir, "opencode").map((file) => ({ path: file, scope: "project" as const })),
    )
  const candidates = dedupeFiles([
    ...(scopes.includes("global")
      ? [
          { path: path.join(Global.Path.config, "config.json"), scope: "global" as const },
          ...ConfigPaths.fileInDirectory(Global.Path.config, "opencode").map((file) => ({
            path: file,
            scope: "global" as const,
          })),
        ]
      : []),
    ...(scopes.includes("project")
      ? [
          ...projectFiles.map((file) => ({ path: file, scope: "project" as const })),
          ...configDirFiles,
        ]
      : []),
    ...(scopes.includes("custom") && Flag.OPENCODE_CONFIG
      ? [{ path: Flag.OPENCODE_CONFIG, scope: "custom" as const }]
      : []),
  ])

  return (
    yield* Effect.forEach(candidates, (file) =>
      fs.existsSafe(file.path).pipe(Effect.map((exists) => (exists ? file : undefined))),
    )
  ).filter((file): file is ConfigFile => file !== undefined)
})

function scopeOptions(yargs: Argv) {
  return yargs
    .option("global", {
      describe: "only use global config",
      type: "boolean",
    })
    .option("project", {
      describe: "only use project config",
      type: "boolean",
    })
}

function selectedScopes(args: ScopeArgs): Scope[] {
  if (args.global && !args.project) return ["global"]
  if (args.project && !args.global) return ["project"]
  return ["global", "project", "custom"]
}

function dedupeFiles(files: ConfigFile[]) {
  return Array.from(new Map(files.map((file) => [file.path, file])).values())
}

function formatFile(file: ConfigFile) {
  return `${file.path} (${file.scope})`
}

function formatPath(path: string[]) {
  return path.join(".")
}

function recoveryHint(file: ConfigFile) {
  if (file.scope === "custom") {
    return `  Safest recovery: move this file aside, start opencode, then ask the agent to inspect the backup and restore the settings you still want.${EOL}`
  }
  return `  Safest recovery: run \`opencode config reset --${file.scope} --yes\`, then ask the agent to inspect the backup and restore the settings you still want.${EOL}`
}
