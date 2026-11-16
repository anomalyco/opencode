export * as McpSkillPlugin from "./mcp-skill.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Hash } from "@opencode/util/hash"
import { Effect, Stream } from "effect"
import { Bus } from "../bus.js"
import { SkillFile } from "../config/plugin/skill-file.js"
import { Flag } from "../flag.js"
import { Mcp } from "../mcp/index.js"
import { AbsolutePath } from "../schema.js"
import { Skill } from "../skill.js"
import { SkillDiscovery } from "../skill/discovery.js"

const MANIFEST = "SKILL.md"

type Listed = Mcp.Skill & { readonly resources: Exclude<Mcp.Skill["entry"]["resources"], "dynamic"> }

/**
 * Experimental: registers the skills connected MCP servers list through MCP Skills, a beta extension, as
 * `<server>:<name>`. Nothing is fetched until a skill is loaded or one of its files is read, and every file is verified
 * against the listed entry.
 */
export const Plugin = define({
  id: "opencode.mcp.skill",
  effect: Effect.fn(function* () {
    if (!(yield* Flag.enabled("mcp_skills"))) return
    const mcp = yield* Mcp.Service
    const bus = yield* Bus.Service
    const skills = yield* Skill.Service
    const loaded = { skills: [] as Listed[] }

    const discover = Effect.gen(function* () {
      const kept = new Map<string, Listed>()
      // Listed by server, then URI, so the alphabetically first URI keeps a name its server repeats.
      for (const skill of yield* mcp.skills()) {
        const resources = skill.entry.resources
        // Dynamic skills publish no digests, so their content cannot be verified.
        if (resources === "dynamic") continue
        const id = `${skill.server}:${skill.entry.frontmatter.name}`
        // The ID is the first segment of the skill's `skill://` paths, so a `/` in it would make its files unreadable.
        if (!SkillDiscovery.isSafeSegment(id)) {
          yield* Effect.logWarning("skipping MCP skill whose name cannot form a path", { server: skill.server, id })
          continue
        }
        const existing = kept.get(id)
        if (!existing) {
          kept.set(id, { ...skill, resources })
          continue
        }
        yield* Effect.logWarning("skipping MCP skill with a duplicate name", {
          server: skill.server,
          name: skill.entry.frontmatter.name,
          uri: skill.entry.uri,
          kept: existing.entry.uri,
        })
      }
      loaded.skills = Array.from(kept.values())
    })

    yield* bus.subscribe(Mcp.SkillsChanged).pipe(
      Stream.runForEach(() => discover.pipe(Effect.andThen(skills.reload()))),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* discover

    // One transform reading the latest discovery, so a refresh keeps its place among other skill sources.
    yield* skills.transform((editor) => {
      for (const skill of loaded.skills) {
        const entry = skill.entry
        const id = Skill.ID.make(`${skill.server}:${entry.frontmatter.name}`)
        const read = (ref?: string) => mcp.readSkill({ server: skill.server, entry, ref })
        const root = entry.uri.slice(0, entry.uri.lastIndexOf("/") + 1)
        const files = skill.resources.flatMap((resource) => {
          const file = resource.uri.startsWith(root) ? resource.uri.slice(root.length) : ""
          return file !== MANIFEST && SkillDiscovery.isSafeRelativePath(file) ? [file] : []
        })
        // Only the name, description and invocation preference are read: no frontmatter field widens permissions.
        const autoinvoke = SkillFile.autoinvoke(entry.frontmatter)
        editor.add(
          {
            id,
            name: Skill.Name.make(id),
            description: entry.frontmatter.description,
            ...(autoinvoke === undefined ? {} : { autoinvoke }),
            path: AbsolutePath.make(Skill.uri(id, MANIFEST)),
            content: read().pipe(Effect.map((file) => file.body ?? "")),
            revision: Hash.sha256(JSON.stringify([entry.uri, entry.frontmatter, entry.resources])),
          },
          Object.fromEntries(files.map((file) => [file, read(file).pipe(Effect.map((result) => result.bytes))])),
        )
      }
    })
  }),
})
