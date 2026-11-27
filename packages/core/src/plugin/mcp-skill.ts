export * as McpSkillPlugin from "./mcp-skill.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Hash } from "@opencode/util/hash"
import { Effect, Stream } from "effect"
import { Bus } from "../bus.js"
import type { McpClient } from "../mcp/client.js"
import { Mcp } from "../mcp/index.js"
import { AbsolutePath } from "../schema.js"
import { Skill } from "../skill.js"
import { SkillDiscovery } from "../skill/discovery.js"

/**
 * Registers the skills connected MCP servers list as `<server>:<name>`, and resolves `<server>:<SKILL.md uri>` to a skill
 * the server confirms through `skills/get` without listing it. Nothing is read until a skill or one of its files is used, and the MCP client checks every file it reads against the listed size and digest. Verified files are
 * kept in memory by digest, so a skill whose SKILL.md was loaded once lists its content.
 */
export const Plugin = define({
  id: "opencode.mcp.skill",
  effect: Effect.fn(function* () {
    const mcp = yield* Mcp.Service
    const bus = yield* Bus.Service
    const skills = yield* Skill.Service
    const state = {
      listed: yield* mcp.skills(),
      // Skills servers confirmed by URI without listing them, until that server's skills change.
      confirmed: [] as Mcp.Skill[],
      // The ID each skill was registered under, by server and URI.
      registered: new Map<string, Skill.ID>(),
    }
    const key = (server: string, uri: string) => `${server} ${uri}`

    const resolve: Skill.Resolver = (id) =>
      Effect.gen(function* () {
        const target = address(id)
        if (!target) return undefined
        const known = state.registered.get(key(target.server, target.uri))
        if (known) return known
        const entry = yield* mcp.getSkill(target).pipe(
          Effect.mapError(
            (error) =>
              new Skill.LoadError({
                skill: id,
                message: `MCP server "${target.server}" did not confirm ${target.uri}: ${error.message}`,
              }),
          ),
        )
        state.confirmed.push({ server: Mcp.ServerName.make(target.server), entry })
        yield* skills.reload()
        return state.registered.get(key(target.server, entry.uri))
      })
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

    yield* bus.subscribe(Mcp.SkillsChanged).pipe(
      Stream.runForEach((event) =>
        mcp.skills().pipe(
          Effect.tap(() =>
            Effect.sync(
              () => (state.confirmed = state.confirmed.filter((skill) => skill.server !== event.data.server)),
            ),
          ),
          Effect.tap((listed) => Effect.sync(() => (state.listed = listed))),
          Effect.andThen(skills.reload()),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )

    yield* skills.transform((editor) => {
      editor.resolve(resolve)
      state.registered.clear()
      // Confirmed skills are named by their whole path, so they never take or change a listed skill's ID.
      const confirmed = state.confirmed.map((skill) => ({
        skill,
        id: Skill.ID.make(`${skill.server}:${path(skill.entry.uri).join(".")}`),
      }))
      for (const { skill, id } of [...ids(state.listed), ...confirmed]) {
        // Dynamic skills list no files, so nothing they serve can be verified.
        if (skill.entry.resources === "dynamic") continue
        if (!SkillDiscovery.isSafeSegment(id) || editor.get(id)) continue
        state.registered.set(key(skill.server, skill.entry.uri), id)
        const root = skill.entry.uri.slice(0, skill.entry.uri.lastIndexOf("/") + 1)
        const files = skill.entry.resources.flatMap((resource) => {
          const file = resource.uri.startsWith(root) ? Skill.parseFilePath(resource.uri.slice(root.length)) : undefined
          return file ? [{ file, digest: resource.digest }] : []
        })
        const digest = files.find((item) => item.file === Skill.manifest)?.digest ?? ""
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
          { type: "mcp", server: skill.server },
        )
      }
    })
  }),
})

/**
 * `<server>:<name>` for each skill. Same-named skills of one server are told apart by the trailing segments of their
 * paths that differ, joined with `.`, which a skill name can't contain: `acme/billing/refunds` and
 * `acme/support/refunds` become `docs:billing.refunds` and `docs:support.refunds`. Paths that never differ, such as
 * one skill under two URI schemes, also get a hash of the URI.
 */
function ids(listed: ReadonlyArray<Mcp.Skill>) {
  return Array.from(
    Map.groupBy(
      listed.filter((skill) => skill.entry.resources !== "dynamic"),
      (skill) => `${skill.server}:${skill.entry.frontmatter.name}`,
    ),
  ).flatMap(([id, group]) => {
    if (group.length === 1) return group.map((skill) => ({ skill, id: Skill.ID.make(id) }))
    const segments = group.map((skill) => path(skill.entry.uri))
    const longest = Math.max(...segments.map((parts) => parts.length))
    const labels =
      Array.from({ length: longest - 1 }, (_, index) =>
        segments.map((parts) => parts.slice(-(index + 2)).join(".")),
      ).find((candidate) => new Set(candidate).size === candidate.length) ??
      group.map((skill, index) => `${segments[index]?.join(".")}.${Hash.sha256(skill.entry.uri).slice(0, 8)}`)
    return group.map((skill, index) => ({ skill, id: Skill.ID.make(`${skill.server}:${labels[index]}`) }))
  })
}

const path = (uri: string) =>
  uri
    .replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//, "")
    .replace(/\/SKILL\.md$/, "")
    .split("/")

/** A skill addressed as `<server>:<SKILL.md uri>`, as in `docs:skill://acme/billing/refunds/SKILL.md`. */
function address(value: string) {
  const colon = value.indexOf(":")
  if (colon <= 0) return undefined
  const uri = value.slice(colon + 1)
  if (!uri.endsWith("/SKILL.md") || !/^[A-Za-z][A-Za-z0-9+.-]*:./.test(uri)) return undefined
  return { server: value.slice(0, colon), uri }
}
