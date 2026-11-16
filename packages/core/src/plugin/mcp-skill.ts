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
type Named = Listed & { readonly id: Skill.ID }

/**
 * Experimental: registers the skills connected MCP servers list through MCP Skills, a beta extension, as
 * `<server>:<name>`, telling same-named skills of one server apart by their paths. Nothing is fetched until a skill is loaded or one of its files is read, and every file is verified
 * against the listed entry.
 */
export const Plugin = define({
  id: "opencode.mcp.skill",
  effect: Effect.fn(function* () {
    if (!(yield* Flag.enabled("mcp_skills"))) return
    const mcp = yield* Mcp.Service
    const bus = yield* Bus.Service
    const skills = yield* Skill.Service
    const loaded = { skills: [] as Named[] }

    const discover = Effect.gen(function* () {
      // Dynamic skills publish no digests, so their content cannot be verified.
      const listed = (yield* mcp.skills()).flatMap((skill): Listed[] =>
        skill.entry.resources === "dynamic" ? [] : [{ ...skill, resources: skill.entry.resources }],
      )
      const named = Array.from(
        Map.groupBy(listed, (skill) => `${skill.server}:${skill.entry.frontmatter.name}`),
      ).flatMap(([id, group]) => (group.length === 1 ? [{ ...group[0]!, id: Skill.ID.make(id) }] : disambiguate(group)))
      // The ID is the first segment of the skill's `skill://` paths, so a `/` in it would make its files unreadable.
      yield* Effect.forEach(
        named.filter((skill) => !SkillDiscovery.isSafeSegment(skill.id)),
        (skill) =>
          Effect.logWarning("skipping MCP skill whose name cannot form a path", { server: skill.server, id: skill.id }),
        { discard: true },
      )
      loaded.skills = named.filter((skill) => SkillDiscovery.isSafeSegment(skill.id))
    })

    // Registered after every other skill source, so a taken ID is visible and reported rather than silently replaced.
    const shadowed = new Set<string>()
    const report = Effect.suspend(() =>
      Effect.forEach(
        shadowed,
        (id) => Effect.logWarning("skipping MCP skill whose ID another skill already uses", { id }),
        { discard: true },
      ),
    )

    yield* bus.subscribe(Mcp.SkillsChanged).pipe(
      Stream.runForEach(() => discover.pipe(Effect.andThen(skills.reload()), Effect.andThen(report))),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* discover

    // One transform reading the latest discovery, so a refresh keeps its place among other skill sources.
    yield* skills.transform((editor) => {
      shadowed.clear()
      for (const skill of loaded.skills) {
        const entry = skill.entry
        const id = skill.id
        if (editor.get(id, { content: false })) {
          shadowed.add(id)
          continue
        }
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
            server: skill.server,
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
    yield* report
  }),
})

// Same-named skills from one server are told apart by the trailing segments of their paths that differ, joined with
// `.`, which a skill name cannot contain: `acme/billing/refunds` and `acme/support/refunds` become `billing.refunds` and
// `support.refunds`. Paths that never differ, such as one skill under two URI schemes, also get a hash of the URI.
function disambiguate(group: ReadonlyArray<Listed>): Named[] {
  const segments = group.map((skill) =>
    skill.entry.uri
      .replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//, "")
      .slice(0, -`/${MANIFEST}`.length)
      .split("/"),
  )
  const longest = Math.max(...segments.map((parts) => parts.length))
  const labels =
    Array.from({ length: longest - 1 }, (_, index) =>
      segments.map((parts) => parts.slice(-(index + 2)).join(".")),
    ).find((candidate) => new Set(candidate).size === candidate.length) ??
    group.map((skill, index) => `${segments[index]!.join(".")}.${Hash.sha256(skill.entry.uri).slice(0, 8)}`)
  return group.map((skill, index) => ({ ...skill, id: Skill.ID.make(`${skill.server}:${labels[index]}`) }))
}
