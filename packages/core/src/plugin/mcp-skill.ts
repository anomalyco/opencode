export * as McpSkillPlugin from "./mcp-skill.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Hash } from "@opencode/util/hash"
import { Effect, Stream } from "effect"
import { Bus } from "../bus.js"
import { McpClient } from "../mcp/client.js"
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
      listed: yield* accept(yield* mcp.skills()),
      // Skills servers confirmed by URI without listing them, until that server's skills change.
      confirmed: [] as Served[],
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
                reason: { _tag: "NotConfirmed", server: target.server, uri: target.uri, detail: error.message },
              }),
          ),
        )
        state.confirmed.push(...(yield* accept([{ server: Mcp.ServerName.make(target.server), entry }])))
        yield* skills.reload()
        return state.registered.get(key(target.server, entry.uri))
      })
    const cache = new Map<string, McpClient.SkillFile>()

    const read = (skill: Served, id: Skill.ID, digest: string, file?: Skill.FilePath) =>
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
                reason:
                  error instanceof McpClient.SkillMismatchError
                    ? { _tag: "Mismatch", file: file ?? Skill.manifest, check: error.check, detail: error.message }
                    : { _tag: "Unavailable", file: file ?? Skill.manifest, detail: error.message },
              }),
          ),
        )
      })

    yield* bus.subscribe(Mcp.SkillsChanged).pipe(
      Stream.runForEach((event) =>
        mcp.skills().pipe(
          Effect.flatMap(accept),
          Effect.tap((listed) =>
            Effect.sync(() => {
              state.confirmed = state.confirmed.filter((skill) => skill.server !== event.data.server)
              state.listed = listed
            }),
          ),
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
        if (!SkillDiscovery.isSafeSegment(id) || editor.get(id)) continue
        state.registered.set(key(skill.server, skill.entry.uri), id)
        editor.add(
          {
            id,
            name: Skill.Name.make(id),
            description: skill.description,
            path: AbsolutePath.make(Skill.uri(id, Skill.manifest)),
            content:
              cache.get(`${skill.manifest} SKILL.md`)?.body ??
              read(skill, id, skill.manifest).pipe(
                Effect.map((result) => result.body ?? ""),
                // Lists the loaded content from now on.
                Effect.tap(() => skills.reload()),
              ),
          },
          Object.fromEntries(
            Array.from(skill.files, ([file, digest]) => [
              file,
              read(skill, id, digest, file).pipe(Effect.map((result) => result.bytes)),
            ]),
          ),
          { type: "mcp", server: skill.server },
        )
      }
    })
  }),
})

/** A skill a server serves, parsed from its entry. */
export interface Served {
  readonly server: Mcp.ServerName
  /** The entry as listed, which every file read is checked against. */
  readonly entry: McpClient.Skill
  readonly name: string
  readonly description: string
  /** The digest of its SKILL.md. */
  readonly manifest: string
  /** Its other files, with their digests. */
  readonly files: ReadonlyMap<Skill.FilePath, string>
}

export type Parsed =
  | { readonly _tag: "Served"; readonly skill: Served }
  | { readonly _tag: "Rejected"; readonly server: Mcp.ServerName; readonly uri: string; readonly reason: Rejection }

/** Why an entry isn't registered: `dynamic` lists no files to check, and a skill needs a listed `SKILL.md`. */
export type Rejection = "dynamic" | "no_manifest"

/**
 * Parses one entry a server lists into a skill whose files are known by path and digest. Files outside the skill's
 * folder, or with paths that aren't safe, aren't part of it.
 */
export function parseEntry(skill: Mcp.Skill): Parsed {
  const entry = skill.entry
  const rejected = (reason: Rejection): Parsed => ({ _tag: "Rejected", server: skill.server, uri: entry.uri, reason })
  if (entry.resources === "dynamic") return rejected("dynamic")
  const root = entry.uri.slice(0, entry.uri.lastIndexOf("/") + 1)
  const listed = new Map(
    entry.resources.flatMap((resource) => {
      const file = resource.uri.startsWith(root) ? Skill.parseFilePath(resource.uri.slice(root.length)) : undefined
      return file ? [[file, resource.digest] as const] : []
    }),
  )
  const manifest = listed.get(Skill.manifest)
  if (!manifest) return rejected("no_manifest")
  listed.delete(Skill.manifest)
  return {
    _tag: "Served",
    skill: {
      server: skill.server,
      entry,
      name: entry.frontmatter.name,
      description: entry.frontmatter.description,
      manifest,
      files: listed,
    },
  }
}

/** The entries that parse, logging the rest once with why. */
const accept = (skills: ReadonlyArray<Mcp.Skill>) =>
  Effect.gen(function* () {
    const parsed = skills.map(parseEntry)
    yield* Effect.forEach(
      parsed.flatMap((item) => (item._tag === "Rejected" ? [item] : [])),
      (item) => Effect.logWarning("skipping MCP skill", { server: item.server, uri: item.uri, reason: item.reason }),
      { discard: true },
    )
    return parsed.flatMap((item) => (item._tag === "Served" ? [item.skill] : []))
  })

/**
 * `<server>:<name>` for each skill. Same-named skills of one server are told apart by the trailing segments of their
 * paths that differ, joined with `.`, which a skill name can't contain: `acme/billing/refunds` and
 * `acme/support/refunds` become `docs:billing.refunds` and `docs:support.refunds`. Paths that never differ, such as
 * one skill under two URI schemes, also get a hash of the URI.
 */
function ids(listed: ReadonlyArray<Served>) {
  return Array.from(Map.groupBy(listed, (skill) => `${skill.server}:${skill.name}`)).flatMap(([id, group]) => {
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
