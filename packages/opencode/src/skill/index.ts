import path from "path"
import { pathToFileURL } from "url"
import { Effect, Layer, Context, Schema } from "effect"
import { NamedError } from "@opencode-ai/core/util/error"
import type { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { InstanceState } from "@/effect/instance-state"
import { Global } from "@opencode-ai/core/global"
import { Permission } from "@/permission"
import { QuickAssistant } from "@/quick-assistant"
import { Filesystem } from "@/util/filesystem"
import { Config } from "../config/config"
import { ConfigMarkdown } from "../config/markdown"
import { Glob } from "../util/glob"
import { Log } from "../util/log"
import { Discovery } from "./discovery"
import CUSTOMIZE_OPENCODE_SKILL_BODY from "./prompt/customize-opencode.md" with { type: "text" }
import { isRecord } from "@/util/record"

const log = Log.create({ service: "skill" })
const CLAUDE_EXTERNAL_DIR = ".claude"
const AGENTS_EXTERNAL_DIR = ".agents"
const EXTERNAL_SKILL_PATTERN = "skills/**/SKILL.md"
const OPENCODE_SKILL_PATTERN = "{skill,skills}/**/SKILL.md"
const SKILL_PATTERN = "**/SKILL.md"

// Built-in skill that ships with opencode. The model's intuition for what an
// opencode.json should look like is often wrong, and opencode hard-fails on
// invalid config, so users hit cryptic startup errors. Loading this skill
// when the model is asked to touch opencode's own config files gives it the
// actual schemas instead of guesses.
const CUSTOMIZE_OPENCODE_SKILL_NAME = "customize-opencode"
const CUSTOMIZE_OPENCODE_SKILL_DESCRIPTION =
  "Use ONLY when the user is editing or creating opencode's own configuration: opencode.json, opencode.jsonc, files under .opencode/, or files under ~/.config/opencode/. Also use when creating or fixing opencode agents, subagents, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring opencode itself."

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  location: Schema.String,
  content: Schema.String,
})
export type Info = Schema.Schema.Type<typeof Info>

const Issue = Schema.StructWithRest(
  Schema.Struct({
    message: Schema.String,
    path: Schema.Array(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

function isSkillFrontmatter(data: unknown): data is { name: string; description?: string } {
  return (
    isRecord(data) &&
    typeof data.name === "string" &&
    (data.description === undefined || typeof data.description === "string")
  )
}

export class InvalidError extends Schema.TaggedErrorClass<InvalidError>()("SkillInvalidError", {
  path: Schema.String,
  message: Schema.optional(Schema.String),
  issues: Schema.optional(Schema.Array(Issue)),
}) {}

export class NameMismatchError extends Schema.TaggedErrorClass<NameMismatchError>()("SkillNameMismatchError", {
  path: Schema.String,
  expected: Schema.String,
  actual: Schema.String,
}) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Skill.NotFoundError", {
  name: Schema.String,
  available: Schema.Array(Schema.String),
}) {
  override get message() {
    return `Skill "${this.name}" not found. Available skills: ${this.available.join(", ") || "none"}`
  }
}

type State = {
  skills: Record<string, Info>
  dirs: Set<string>
}

type DiscoveryState = {
  matches: string[]
  dirs: string[]
}

type ScanState = {
  matches: Set<string>
  dirs: Set<string>
}

export interface Interface {
  readonly get: (name: string) => Effect.Effect<Info | undefined>
  readonly require: (name: string) => Effect.Effect<Info, NotFoundError>
  readonly all: () => Effect.Effect<Info[]>
  readonly dirs: () => Effect.Effect<string[]>
  readonly available: (agent?: Agent.Info) => Effect.Effect<Info[]>
}

const add = Effect.fnUntraced(function* (state: State, match: string, bus: Bus.Interface) {
  const md = yield* Effect.tryPromise({
    try: () => ConfigMarkdown.parse(match),
    catch: (err) => err,
  }).pipe(
    Effect.catch(
      Effect.fnUntraced(function* (err) {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? err.data.message
          : `Failed to parse skill ${match}`
        const { Session } = yield* Effect.promise(() => import("@/session/session"))
        yield* bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        log.error("failed to load skill", { skill: match, err })
        return undefined
      }),
    ),
  )

  if (!md) return

  if (!isSkillFrontmatter(md.data)) return

  if (state.skills[md.data.name]) {
    log.warn("duplicate skill name", {
      name: md.data.name,
      existing: state.skills[md.data.name].location,
      duplicate: match,
    })
  }

  state.dirs.add(path.dirname(match))
  state.skills[md.data.name] = {
    name: md.data.name,
    description: md.data.description,
    location: match,
    content: md.content,
  }
})

const scan = Effect.fnUntraced(function* (
  state: ScanState,
  root: string,
  pattern: string,
  opts?: { dot?: boolean; scope?: string },
) {
  const matches = yield* Effect.tryPromise({
    try: () =>
      Glob.scan(pattern, {
        cwd: root,
        absolute: true,
        include: "file",
        symlink: true,
        dot: opts?.dot,
      }),
    catch: (error) => error,
  }).pipe(
    Effect.catch((error) => {
      if (!opts?.scope) return Effect.die(error)
      log.error(`failed to scan ${opts.scope} skills`, { dir: root, error })
      return Effect.succeed([] as string[])
    }),
  )

  for (const match of matches) {
    state.matches.add(match)
    state.dirs.add(path.dirname(match))
  }
})

const discoverSkills = Effect.fnUntraced(function* (
  config: Config.Interface,
  discovery: Discovery.Interface,
  fsys: AppFileSystem.Interface,
  global: Global.Interface,
  disableExternalSkills: boolean,
  disableClaudeCodeSkills: boolean,
  directory: string,
  worktree: string,
) {
  const state: ScanState = { matches: new Set(), dirs: new Set() }

  const externalDirs: string[] = []
  if (!disableExternalSkills) {
    if (!disableClaudeCodeSkills) externalDirs.push(CLAUDE_EXTERNAL_DIR)
    externalDirs.push(AGENTS_EXTERNAL_DIR)

    for (const dir of externalDirs) {
      const root = path.join(global.home, dir)
      if (!(yield* fsys.isDir(root))) continue
      yield* scan(state, root, EXTERNAL_SKILL_PATTERN, { dot: true, scope: "global" })
    }

    const upDirs = yield* fsys
      .up({ targets: externalDirs, start: directory, stop: worktree })
      .pipe(Effect.catch(() => Effect.succeed([] as string[])))

    for (const root of upDirs) {
      yield* scan(state, root, EXTERNAL_SKILL_PATTERN, { dot: true, scope: "project" })
    }
  }

  const scan = async (state: State, root: string, pattern: string, opts?: { dot?: boolean; scope?: string }) => {
    log.info("skill.scan.glob.start", { root, pattern, scope: opts?.scope })
    return Glob.scan(pattern, {
      cwd: root,
      absolute: true,
      include: "file",
      symlink: true,
      dot: opts?.dot,
    })
      .then((matches) => {
        log.info("skill.scan.glob.matches", { root, pattern, count: matches.length, matches: matches.slice(0, 5) })
        return Promise.all(matches.map((match) => add(state, match)))
      })
      .catch((error) => {
        if (!opts?.scope) throw error
        log.error(`failed to scan ${opts.scope} skills`, { dir: root, pattern, error })
      })
  }

    const require = Effect.fn("Skill.require")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      const info = s.skills[name]
      if (info) return info
      return yield* new NotFoundError({ name, available: Object.keys(s.skills).toSorted() })
    })

    const load = async () => {
      if (QuickAssistant.active(directory)) {
        log.info("skip quick assistant skills", { directory })
        return
      }

      log.info("skill.scan.start", {
        directory,
        worktree,
        message: "Starting skill scan",
      })

      if (!Flag.OPENCODE_DISABLE_EXTERNAL_SKILLS) {
        for (const dir of EXTERNAL_DIRS) {
          const root = path.join(Global.Path.home, dir)
          if (!(await Filesystem.isDir(root))) continue
          log.info("skill.scan.global", { root, pattern: EXTERNAL_SKILL_PATTERN })
          await scan(state, root, EXTERNAL_SKILL_PATTERN, { dot: true, scope: "global" })
        }

        log.info("skill.scan.project.start", {
          start: directory,
          stop: worktree,
          targets: EXTERNAL_DIRS,
        })
        for await (const root of Filesystem.up({
          targets: EXTERNAL_DIRS,
          start: directory,
          stop: worktree,
        })) {
          log.info("skill.scan.project.found", { root, pattern: EXTERNAL_SKILL_PATTERN })
          await scan(state, root, EXTERNAL_SKILL_PATTERN, { dot: true, scope: "project" })
        }
      }

    const available = Effect.fn("Skill.available")(function* (agent?: Agent.Info) {
      const s = yield* InstanceState.get(state)
      const list = Object.values(s.skills).toSorted((a, b) => a.name.localeCompare(b.name))
      if (!agent) return list
      return list.filter((skill) => Permission.evaluate("skill", skill.name, agent.permission).action !== "deny")
    })

    return Service.of({ get, require, all, dirs, available })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Discovery.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(Bus.layer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Global.layer),
  Layer.provide(RuntimeFlags.defaultLayer),
)

export function fmt(list: Info[], opts: { verbose: boolean }) {
  const described = list.filter((skill) => skill.description !== undefined)
  if (described.length === 0) return "No skills are currently available."
  if (opts.verbose) {
    return [
      "<available_skills>",
      ...described
        .toSorted((a, b) => a.name.localeCompare(b.name))
        .flatMap((skill) => [
          "  <skill>",
          `    <name>${skill.name}</name>`,
          `    <description>${skill.description}</description>`,
          `    <location>${pathToFileURL(skill.location).href}</location>`,
          "  </skill>",
        ]),
      "</available_skills>",
    ].join("\n")
  }

  return [
    "## Available Skills",
    ...described
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((skill) => `- **${skill.name}**: ${skill.description}`),
  ].join("\n")
}

export * as Skill from "."
