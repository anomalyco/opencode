/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import { InstallationChannel, InstallationVersion } from "../installation/version"
import { Config } from "../config"
import { Location } from "../location"
import { FSUtil } from "../fs-util"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"
import opencodeContent from "./skill/opencode.md" with { type: "text" }
import reportContent from "./skill/report.md" with { type: "text" }

export const OpencodeContent = opencodeContent
export const ReportContent = reportContent

export const OpencodeDescription =
  "Use this skill for any question about OpenCode itself, including how OpenCode works, using or configuring it, troubleshooting it, developing plugins or integrations, using the OpenCode SDK, clients, server, or API, and contributing to the OpenCode codebase. Also use it for OpenCode agents, commands, skills, tools, permissions, MCP servers, providers, models, themes, keybinds, formatters, the CLI, TUI, desktop app, and web app."
const REPORT_DESCRIPTION =
  "Use when the user wants to report an opencode issue or bug. Collect standard diagnostics, add user-specific reproduction context, and publish the issue with GitHub CLI."

export const Plugin = define({
  id: "opencode.skill",
  effect: Effect.fn(function* (ctx) {
    const reportContent = yield* reportContentWithDiagnostics()
    yield* ctx.skill.transform((draft) => {
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            id: SkillV2.ID.make("opencode"),
            name: SkillV2.Name.make("OpenCode"),
            description: OpencodeDescription,
            location: AbsolutePath.make("/builtin/opencode.md"),
            content: OpencodeContent,
          }),
        }),
      )
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            id: SkillV2.ID.make("report"),
            name: SkillV2.Name.make("Report"),
            description: REPORT_DESCRIPTION,
            slash: true,
            location: AbsolutePath.make("/builtin/report.md"),
            content: reportContent,
          }),
        }),
      )
    })
  }),
})

const reportContentWithDiagnostics = Effect.fn("SkillPlugin.reportContentWithDiagnostics")(function* () {
  const plugins = yield* configuredPlugins().pipe(Effect.orElseSucceed(() => ["Unavailable: failed to inspect config"]))
  return [
    ReportContent,
    "",
    "## Runtime Diagnostics Snapshot",
    "",
    "These values were captured when the built-in report skill was registered. Verify them before publishing.",
    "",
    `- opencode version: ${InstallationVersion}`,
    `- install/channel: ${InstallationChannel}`,
    `- OS: ${os.type()} ${os.release()} (${os.platform()} ${os.arch()})`,
    `- Terminal: ${terminal()}`,
    `- Shell: ${shell()}`,
    `- Active plugins: ${plugins.length === 0 ? "None found in config" : plugins.join(", ")}`,
  ].join("\n")
})

const configuredPlugins = Effect.fn("SkillPlugin.configuredPlugins")(function* () {
  const config = yield* Config.Service
  const fs = yield* FSUtil.Service
  const location = yield* Location.Service
  return yield* Effect.forEach(yield* config.entries(), (entry) => {
    if (entry.type === "document") {
      const directory = entry.path ? path.dirname(entry.path) : location.directory
      return Effect.succeed(
        (entry.info.plugins ?? []).map((item) => {
          const ref = typeof item === "string" ? { package: item } : item
          if (ref.package.startsWith("file://")) return fileURLToPath(ref.package)
          if (ref.package.startsWith("./") || ref.package.startsWith("../")) return path.resolve(directory, ref.package)
          return ref.package
        }),
      )
    }
    return fs
      .glob("{plugin,plugins}/*.{ts,js}", {
        cwd: entry.path,
        absolute: true,
        include: "file",
        dot: true,
        symlink: true,
      })
      .pipe(Effect.orElseSucceed(() => []))
  }).pipe(Effect.map((items) => items.flat().toSorted()))
})

function terminal() {
  return (
    [
      process.env.TERM_PROGRAM ? `TERM_PROGRAM=${process.env.TERM_PROGRAM}` : undefined,
      process.env.TERM ? `TERM=${process.env.TERM}` : undefined,
      process.env.COLORTERM ? `COLORTERM=${process.env.COLORTERM}` : undefined,
    ]
      .filter((item): item is string => item !== undefined)
      .join(", ") || "Unavailable: terminal environment variables are not set"
  )
}

function shell() {
  return (
    process.env.SHELL ??
    process.env.ComSpec ??
    process.env.COMSPEC ??
    "Unavailable: shell environment variable is not set"
  )
}
