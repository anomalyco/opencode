export * as McpSkillPlugin from "./mcp-skill.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Stream } from "effect"
import { Bus } from "../bus.js"
import type { McpClient } from "../mcp/client.js"
import { Mcp } from "../mcp/index.js"
import { AbsolutePath } from "../schema.js"
import { Skill } from "../skill.js"
import { SkillDiscovery } from "../skill/discovery.js"

/**
 * Registers the skills connected MCP servers list as `<server>:<name>`. Nothing is read until a skill or one of its
 * files is used, and the MCP client checks every file it reads against the listed size and digest. Verified files are
 * kept in memory by digest, so a skill whose SKILL.md was loaded once lists its content.
 */
export const Plugin = define({
  id: "opencode.mcp.skill",
  effect: Effect.fn(function* () {
    const mcp = yield* Mcp.Service
    const bus = yield* Bus.Service
    const skills = yield* Skill.Service
    const state = { listed: yield* mcp.skills() }
    const cache = new Map<string, McpClient.SkillFile>()

    const read = (skill: Mcp.Skill, id: Skill.ID, digest: string, file?: string) =>
      Effect.suspend(() => {
        // The SKILL.md key is separate because only a SKILL.md read carries the body without frontmatter.
        const key = file === undefined ? `${digest} SKILL.md` : digest
        const cached = cache.get(key)
        if (cached) return Effect.succeed(cached)
        return mcp.readSkill({ server: skill.server, entry: skill.entry, ref: file }).pipe(
          Effect.tap((result) => Effect.sync(() => cache.set(key, result))),
          Effect.mapError(
            (error) =>
              new Skill.LoadError({
                skill: id,
                message: `Failed to load ${file ?? "SKILL.md"} of MCP skill ${id}: ${error.message}`,
              }),
          ),
        )
      })

    yield* bus.subscribe(Mcp.SkillsChanged, { overflow: "slide" }).pipe(
      Stream.runForEach(() =>
        mcp.skills().pipe(
          Effect.tap((listed) => Effect.sync(() => (state.listed = listed))),
          Effect.andThen(skills.reload()),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )

    yield* skills.transform((editor) => {
      for (const skill of state.listed) {
        // Dynamic skills list no files, so nothing they serve can be verified.
        if (skill.entry.resources === "dynamic") continue
        const id = Skill.ID.make(`${skill.server}:${skill.entry.frontmatter.name}`)
        if (!SkillDiscovery.isSafeSegment(id) || editor.get(id)) continue
        const root = skill.entry.uri.slice(0, skill.entry.uri.lastIndexOf("/") + 1)
        const files = skill.entry.resources.flatMap((resource) => {
          const file = resource.uri.startsWith(root) ? resource.uri.slice(root.length) : ""
          return SkillDiscovery.isSafeRelativePath(file) ? [{ file, digest: resource.digest }] : []
        })
        const digest = files.find((item) => item.file === "SKILL.md")?.digest ?? ""
        editor.add(
          {
            id,
            name: Skill.Name.make(id),
            description: skill.entry.frontmatter.description,
            path: AbsolutePath.make(Skill.uri(id, "SKILL.md")),
            content:
              cache.get(`${digest} SKILL.md`)?.body ??
              read(skill, id, digest).pipe(
                Effect.map((result) => result.body ?? ""),
                // Lists the loaded content from now on.
                Effect.tap(() => skills.reload()),
              ),
          },
          Object.fromEntries(
            files.map((item) => [
              item.file,
              read(skill, id, item.digest, item.file).pipe(Effect.map((result) => result.bytes)),
            ]),
          ),
        )
      }
    })
  }),
})
