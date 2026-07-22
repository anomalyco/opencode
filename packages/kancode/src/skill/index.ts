import { LayerNode } from "@kancode/core/effect/layer-node"
import path from "path"
import { Effect, Layer, Context, Schema } from "effect"
import { NamedError } from "@kancode/core/util/error"
import type { Agent } from "@/agent/agent"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
import { Global } from "@kancode/core/global"
import { SkillPlugin } from "@kancode/core/plugin/skill"
import { SkillV2 } from "@kancode/core/skill"
import { Permission } from "@/permission"
import { FSUtil } from "@kancode/core/fs-util"
import { Config } from "@/config/config"
import { FrontmatterError } from "@kancode/core/v1/config/error"
import { ConfigMarkdown } from "@/config/markdown"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Glob } from "@kancode/core/util/glob"
import { Discovery } from "./discovery"
import { isRecord } from "@/util/record"
import { escapeHtml } from "@/util/html"

const CLAUDE_EXTERNAL_DIR = ".claude"
const AGENTS_EXTERNAL_DIR = ".agents"
const CURSOR_EXTERNAL_DIR = ".cursor"
const CODEX_EXTERNAL_DIR = ".codex"
const KILO_EXTERNAL_DIR = ".kilo"
const OPENCODE_EXTERNAL_DIR = ".opencode"
const EXTERNAL_SKILL_PATTERN = "skills/**/SKILL.md"
const OPENCODE_SKILL_PATTERN = "{skill,skills}/**/SKILL.md"
const SKILL_PATTERN = "**/SKILL.md"

// External skill roots KanCode scans in addition to .kancode/. Ordered so
// that origin labels stay stable. .kancode is intentionally absent here — it
// is the "no origin tag" default. .opencode is a skills-only exception to
// the no-project-.opencode-discovery rule; config and other resources stay
// KanCode-only. See openspec/config.yaml.
const EXTERNAL_DIRS = [
  CLAUDE_EXTERNAL_DIR,
  AGENTS_EXTERNAL_DIR,
  CURSOR_EXTERNAL_DIR,
  CODEX_EXTERNAL_DIR,
  KILO_EXTERNAL_DIR,
  OPENCODE_EXTERNAL_DIR,
] as const

// Glob pattern to scan inside each external dir. .opencode legacy layout
// used both `skill/` (singular) and `skills/` (plural); all other external
// dirs use the `skills/` convention.
const PATTERN_BY_DIR: Record<string, string> = {
  ...Object.fromEntries(EXTERNAL_DIRS.map((d) => [d, EXTERNAL_SKILL_PATTERN])),
  [OPENCODE_EXTERNAL_DIR]: OPENCODE_SKILL_PATTERN,
}

// Built-in skills that ship with KanCode. customize-opencode covers config
// shapes; import-opencode migrates legacy project `.opencode/` content.
const CUSTOMIZE_OPENCODE_SKILL_NAME = "customize-opencode"
const CUSTOMIZE_OPENCODE_SKILL_DESCRIPTION = SkillPlugin.CUSTOMIZE_OPENCODE_DESCRIPTION
const CUSTOMIZE_OPENCODE_SKILL_BODY = SkillPlugin.CustomizeOpencodeContent

const IMPORT_OPENCODE_SKILL_NAME = "import-opencode"
const IMPORT_OPENCODE_SKILL_DESCRIPTION = SkillPlugin.IMPORT_OPENCODE_DESCRIPTION
const IMPORT_OPENCODE_SKILL_BODY = SkillPlugin.ImportOpencodeContent

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

const add = Effect.fnUntraced(function* (state: State, match: string, events: EventV2Bridge.Service["Service"]) {
  const md = yield* Effect.tryPromise({
    try: () => ConfigMarkdown.parse(match),
    catch: (err) => err,
  }).pipe(
    Effect.catch(
      Effect.fnUntraced(function* (err) {
        const message = FrontmatterError.isInstance(err) ? err.data.message : `Failed to parse skill ${match}`
        const { Session } = yield* Effect.promise(() => import("@/session/session"))
        yield* events.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        yield* Effect.logError("failed to load skill", { skill: match, error: err })
        return undefined
      }),
    ),
  )

  if (!md) return

  if (!isSkillFrontmatter(md.data)) return

  if (state.skills[md.data.name]) {
    yield* Effect.logWarning("duplicate skill name", {
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
      return Effect.logError(`failed to scan ${opts.scope} skills`, { dir: root, error: error }).pipe(
        Effect.as([] as string[]),
      )
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
  fsys: FSUtil.Interface,
  global: Global.Interface,
  directory: string,
  worktree: string,
) {
  const state: ScanState = { matches: new Set(), dirs: new Set() }

  const cfg = yield* config.get()

  // External skill sources are opt-in. Only sources listed in
  // `skills.external` are scanned; default is none.
  const enabledExternal = cfg.skills?.external ?? []

  if (enabledExternal.length > 0) {
    for (const dir of enabledExternal) {
      const root = path.join(global.home, dir)
      if (!(yield* fsys.isDir(root))) continue
      yield* scan(state, root, PATTERN_BY_DIR[dir] ?? EXTERNAL_SKILL_PATTERN, { dot: true, scope: "global" })
    }

    const upDirs = yield* fsys
      .up({ targets: enabledExternal, start: directory, stop: worktree })
      .pipe(Effect.catch(() => Effect.succeed([] as string[])))

    for (const root of upDirs) {
      // The walked-up dir's basename identifies which external root it is.
      const dir = path.basename(root)
      yield* scan(state, root, PATTERN_BY_DIR[dir] ?? EXTERNAL_SKILL_PATTERN, { dot: true, scope: "project" })
    }
  }

  const configDirs = yield* config.directories()
  for (const dir of configDirs) {
    yield* scan(state, dir, OPENCODE_SKILL_PATTERN)
  }

  for (const item of cfg.skills?.paths ?? []) {
    const expanded = item.startsWith("~/") ? path.join(global.home, item.slice(2)) : item
    const dir = path.isAbsolute(expanded) ? expanded : path.join(directory, expanded)
    if (!(yield* fsys.isDir(dir))) {
      yield* Effect.logWarning("skill path not found", { path: dir })
      continue
    }

    yield* scan(state, dir, SKILL_PATTERN)
  }

  for (const url of cfg.skills?.urls ?? []) {
    const pulledDirs = yield* discovery.pull(url)
    for (const dir of pulledDirs) {
      yield* scan(state, dir, SKILL_PATTERN)
    }
  }

  return {
    matches: Array.from(state.matches),
    dirs: Array.from(state.dirs),
  }
})

const loadSkills = Effect.fnUntraced(function* (
  state: State,
  discovered: DiscoveryState,
  events: EventV2Bridge.Service["Service"],
) {
  yield* Effect.forEach(discovered.matches, (match) => add(state, match, events), {
    concurrency: "unbounded",
    discard: true,
  })

  yield* Effect.logInfo("init", { count: Object.keys(state.skills).length })
})

export class Service extends Context.Service<Service, Interface>()("@kancode/Skill") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const discovery = yield* Discovery.Service
    const config = yield* Config.Service
    const events = yield* EventV2Bridge.Service
    const fsys = yield* FSUtil.Service
    const global = yield* Global.Service
    const discovered = yield* InstanceState.make(
      Effect.fn("Skill.discovery")(function* (ctx) {
        return yield* discoverSkills(config, discovery, fsys, global, ctx.directory, ctx.worktree)
      }),
    )
    const state = yield* InstanceState.make(
      Effect.fn("Skill.state")(function* () {
        const s: State = { skills: {}, dirs: new Set() }
        // Register built-in skills BEFORE disk discovery so a user-disk
        // skill with the same name can override them.
        s.skills[CUSTOMIZE_OPENCODE_SKILL_NAME] = {
          name: CUSTOMIZE_OPENCODE_SKILL_NAME,
          description: CUSTOMIZE_OPENCODE_SKILL_DESCRIPTION,
          location: "<built-in>",
          content: CUSTOMIZE_OPENCODE_SKILL_BODY,
        }
        s.skills[IMPORT_OPENCODE_SKILL_NAME] = {
          name: IMPORT_OPENCODE_SKILL_NAME,
          description: IMPORT_OPENCODE_SKILL_DESCRIPTION,
          location: "<built-in>",
          content: IMPORT_OPENCODE_SKILL_BODY,
        }
        yield* loadSkills(s, yield* InstanceState.get(discovered), events)
        return s
      }),
    )

    const get = Effect.fn("Skill.get")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      return s.skills[name]
    })

    const require = Effect.fn("Skill.require")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      const info = s.skills[name]
      if (info) return info
      return yield* new NotFoundError({ name, available: Object.keys(s.skills).toSorted() })
    })

    const all = Effect.fn("Skill.all")(function* () {
      const s = yield* InstanceState.get(state)
      return Object.values(s.skills)
    })

    const dirs = Effect.fn("Skill.dirs")(function* () {
      return (yield* InstanceState.get(discovered)).dirs
    })

    const available = Effect.fn("Skill.available")(function* (agent?: Agent.Info) {
      const s = yield* InstanceState.get(state)
      const list = Object.values(s.skills).toSorted((a, b) => a.name.localeCompare(b.name))
      if (!agent) return list
      return list.filter((skill) => Permission.evaluate("skill", skill.name, agent.permission).action !== "deny")
    })

    return Service.of({ get, require, all, dirs, available })
  }),
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
          `    <location>${escapeHtml(skill.location)}</location>`,
          "  </skill>",
        ]),
      "</available_skills>",
    ].join("\n")
  }

  return [
    "## Available Skills",
    ...described
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((skill) => {
        const tag = SkillV2.origin(skill.location)
        const desc = tag ? `[${tag}] ${skill.description}` : skill.description
        return `- **${skill.name}**: ${desc}`
      }),
  ].join("\n")
}

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Discovery.node, Config.node, EventV2Bridge.node, FSUtil.node, Global.node, RuntimeFlags.node],
})

export * as Skill from "."
