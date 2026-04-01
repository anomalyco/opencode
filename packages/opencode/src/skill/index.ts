import os from "os"
import path from "path"
import fs from "fs"
import { pathToFileURL } from "url"
import z from "zod"
import { Effect, Layer, ServiceMap } from "effect"
import { NamedError } from "@opencode-ai/util/error"
import type { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { Flag } from "@/flag/flag"
import { Global } from "@/global"
import { Permission } from "@/permission"
import { AppFileSystem } from "@/filesystem"
import { Config } from "../config/config"
import { ConfigMarkdown } from "../config/markdown"
import { MCP } from "../mcp"
import { Glob } from "../util/glob"
import { Log } from "../util/log"
import { Discovery } from "./discovery"

export namespace Skill {
  const log = Log.create({ service: "skill" })
  const EXTERNAL_DIRS = [".claude", ".agents"]
  const EXTERNAL_SKILL_PATTERN = "skills/**/SKILL.md"
  const OPENCODE_SKILL_PATTERN = "{skill,skills}/**/SKILL.md"
  const SKILL_PATTERN = "**/SKILL.md"

  export const Info = z.object({
    name: z.string(),
    description: z.string(),
    location: z.string(),
    content: z.string(),
    paths: z.array(z.string()).optional(),
    allowedTools: z.array(z.string()).optional(),
    model: z.string().optional(),
    effort: z.enum(["low", "medium", "high"]).optional(),
    whenToUse: z.string().optional(),
    argumentHint: z.string().optional(),
  })
  export type Info = z.infer<typeof Info>

  export const InvalidError = NamedError.create(
    "SkillInvalidError",
    z.object({
      path: z.string(),
      message: z.string().optional(),
      issues: z.custom<z.core.$ZodIssue[]>().optional(),
    }),
  )

  export const NameMismatchError = NamedError.create(
    "SkillNameMismatchError",
    z.object({
      path: z.string(),
      expected: z.string(),
      actual: z.string(),
    }),
  )

  type State = {
    skills: Record<string, Info>
    dirs: Set<string>
    resolved: Set<string>
  }

  export interface Interface {
    readonly get: (name: string) => Effect.Effect<Info | undefined>
    readonly all: () => Effect.Effect<Info[]>
    readonly dirs: () => Effect.Effect<string[]>
    readonly available: (agent?: Agent.Info, contextFiles?: string[]) => Effect.Effect<Info[]>
  }

  const add = Effect.fnUntraced(function* (state: State, match: string, bus: Bus.Interface) {
    // 17.4: deduplicate by resolved (symlink-aware) path
    const real = (() => {
      try {
        return fs.realpathSync(match)
      } catch {
        return match
      }
    })()
    if (state.resolved.has(real)) return
    state.resolved.add(real)

    const md = yield* Effect.tryPromise({
      try: () => ConfigMarkdown.parse(match),
      catch: (err) => err,
    }).pipe(
      Effect.catch(
        Effect.fnUntraced(function* (err) {
          const message = ConfigMarkdown.FrontmatterError.isInstance(err)
            ? err.data.message
            : `Failed to parse skill ${match}`
          const { Session } = yield* Effect.promise(() => import("@/session"))
          yield* bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
          log.error("failed to load skill", { skill: match, err })
          return undefined
        }),
      ),
    )

    if (!md) return

    const parsed = Info.pick({ name: true, description: true }).safeParse(md.data)
    if (!parsed.success) return

    // 17.1: parse extended frontmatter fields
    const extended = z
      .object({
        paths: z.array(z.string()).optional(),
        "allowed-tools": z.array(z.string()).optional(),
        model: z.string().optional(),
        effort: z.enum(["low", "medium", "high"]).optional(),
        when_to_use: z.string().optional(),
        "argument-hint": z.string().optional(),
      })
      .safeParse(md.data)
    const extra = extended.success ? extended.data : {}

    if (state.skills[parsed.data.name]) {
      log.warn("duplicate skill name", {
        name: parsed.data.name,
        existing: state.skills[parsed.data.name].location,
        duplicate: match,
      })
    }

    state.dirs.add(path.dirname(match))
    state.skills[parsed.data.name] = {
      name: parsed.data.name,
      description: parsed.data.description,
      location: match,
      content: md.content,
      paths: extra.paths,
      allowedTools: extra["allowed-tools"],
      model: extra.model,
      effort: extra.effort,
      whenToUse: extra.when_to_use,
      argumentHint: extra["argument-hint"],
    }
  })

  const scan = Effect.fnUntraced(function* (
    state: State,
    bus: Bus.Interface,
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

    yield* Effect.forEach(matches, (match) => add(state, match, bus), {
      concurrency: "unbounded",
      discard: true,
    })
  })

  const loadSkills = Effect.fnUntraced(function* (
    state: State,
    config: Config.Interface,
    discovery: Discovery.Interface,
    bus: Bus.Interface,
    fsys: AppFileSystem.Interface,
    mcp: MCP.Interface,
    directory: string,
    worktree: string,
  ) {
    if (!Flag.OPENCODE_DISABLE_EXTERNAL_SKILLS) {
      for (const dir of EXTERNAL_DIRS) {
        const root = path.join(Global.Path.home, dir)
        if (!(yield* fsys.isDir(root))) continue
        yield* scan(state, bus, root, EXTERNAL_SKILL_PATTERN, { dot: true, scope: "global" })
      }

      const upDirs = yield* fsys
        .up({ targets: EXTERNAL_DIRS, start: directory, stop: worktree })
        .pipe(Effect.catch(() => Effect.succeed([] as string[])))

      for (const root of upDirs) {
        yield* scan(state, bus, root, EXTERNAL_SKILL_PATTERN, { dot: true, scope: "project" })
      }
    }

    const configDirs = yield* config.directories()
    for (const dir of configDirs) {
      yield* scan(state, bus, dir, OPENCODE_SKILL_PATTERN)
    }

    const cfg = yield* config.get()
    for (const item of cfg.skills?.paths ?? []) {
      const expanded = item.startsWith("~/") ? path.join(os.homedir(), item.slice(2)) : item
      const dir = path.isAbsolute(expanded) ? expanded : path.join(directory, expanded)
      if (!(yield* fsys.isDir(dir))) {
        log.warn("skill path not found", { path: dir })
        continue
      }

      yield* scan(state, bus, dir, SKILL_PATTERN)
    }

    for (const url of cfg.skills?.urls ?? []) {
      const pulledDirs = yield* discovery.pull(url)
      for (const dir of pulledDirs) {
        state.dirs.add(dir)
        yield* scan(state, bus, dir, SKILL_PATTERN)
      }
    }

    // 18.2: Plugin skill registration — scan skill paths contributed by plugin manifests
    for (const manifest of cfg.plugin_manifests ?? []) {
      if (manifest.enabled === false) continue
      for (const skillPath of manifest.skills ?? []) {
        const dir = path.isAbsolute(skillPath) ? skillPath : path.join(directory, skillPath)
        if (!(yield* fsys.isDir(dir))) {
          log.warn("plugin skill path not found", { plugin: manifest.id, path: dir })
          continue
        }
        yield* scan(state, bus, dir, SKILL_PATTERN)
      }
    }

    // 17.3: MCP-sourced skills — wrap MCP server prompts as skills
    for (const [name, prompt] of Object.entries(yield* mcp.prompts())) {
      if (state.skills[name]) continue
      const args = prompt.arguments ?? []
      const argHint = args.map((a) => `$${a.name}`).join(" ")
      state.skills[name] = {
        name,
        description: prompt.description ?? name,
        location: `mcp:${name}`,
        content: argHint ? `Use this skill with arguments: ${argHint}` : `Invoke the MCP prompt: ${name}`,
        argumentHint: argHint || undefined,
      }
    }

    log.info("init", { count: Object.keys(state.skills).length })
  })

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Skill") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const discovery = yield* Discovery.Service
      const config = yield* Config.Service
      const bus = yield* Bus.Service
      const fsys = yield* AppFileSystem.Service
      const mcp = yield* MCP.Service
      const state = yield* InstanceState.make(
        Effect.fn("Skill.state")(function* (ctx) {
          const s: State = { skills: {}, dirs: new Set(), resolved: new Set() }
          yield* loadSkills(s, config, discovery, bus, fsys, mcp, ctx.directory, ctx.worktree)
          return s
        }),
      )

      const get = Effect.fn("Skill.get")(function* (name: string) {
        const s = yield* InstanceState.get(state)
        return s.skills[name]
      })

      const all = Effect.fn("Skill.all")(function* () {
        const s = yield* InstanceState.get(state)
        return Object.values(s.skills)
      })

      const dirs = Effect.fn("Skill.dirs")(function* () {
        const s = yield* InstanceState.get(state)
        return Array.from(s.dirs)
      })

      const available = Effect.fn("Skill.available")(function* (agent?: Agent.Info, contextFiles?: string[]) {
        const s = yield* InstanceState.get(state)
        let list = Object.values(s.skills).toSorted((a, b) => a.name.localeCompare(b.name))
        if (agent)
          list = list.filter((skill) => Permission.evaluate("skill", skill.name, agent.permission).action !== "deny")
        // 17.2: filter by paths if context files are explicitly provided
        if (contextFiles !== undefined)
          list = list.filter((skill) => {
            if (!skill.paths || skill.paths.length === 0) return true
            return contextFiles.some((file) => skill.paths!.some((pat) => Glob.match(pat, file)))
          })
        return list
      })

      return Service.of({ get, all, dirs, available })
    }),
  )

  export const defaultLayer = layer.pipe(
    Layer.provide(Discovery.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Bus.layer),
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(MCP.defaultLayer),
  )

  export function fmt(list: Info[], opts: { verbose: boolean }) {
    if (list.length === 0) return "No skills are currently available."

    if (opts.verbose) {
      return [
        "<available_skills>",
        ...list.flatMap((skill) => [
          "  <skill>",
          `    <name>${skill.name}</name>`,
          `    <description>${skill.description}</description>`,
          `    <location>${pathToFileURL(skill.location).href}</location>`,
          "  </skill>",
        ]),
        "</available_skills>",
      ].join("\n")
    }

    return ["## Available Skills", ...list.map((skill) => `- **${skill.name}**: ${skill.description}`)].join("\n")
  }

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function get(name: string) {
    return runPromise((skill) => skill.get(name))
  }

  export async function all() {
    return runPromise((skill) => skill.all())
  }

  export async function dirs() {
    return runPromise((skill) => skill.dirs())
  }

  export async function available(agent?: Agent.Info, contextFiles?: string[]) {
    return runPromise((skill) => skill.available(agent, contextFiles))
  }
}
