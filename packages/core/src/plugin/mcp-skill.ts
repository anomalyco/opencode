export * as McpSkillPlugin from "./mcp-skill.js"

import { define } from "@opencode/plugin/effect/plugin"
import { AbsolutePath } from "../schema.js"
import { Effect, Stream } from "effect"
import { ConfigMarkdown } from "../config/markdown.js"
import { Mcp } from "../mcp/index.js"
import { Skill } from "../skill.js"

// Skills served over MCP (SEP-2640) enter the same registry as filesystem skills, so the skill tool
// and the skill guidance need no knowledge of where a skill came from. Two properties of the
// extension shape this producer:
//
// A skill is identified by the pair of server and URI, never by name alone. The registry keys on
// `id`, so the id is namespaced by server; that is what keeps two servers publishing a skill of the
// same name from shadowing one another, and it is also what the skill tool receives from the model.
//
// Content is verified before it is ever shown. The listing publishes a SHA-256 digest and byte
// length per file, and the extension requires a host to check them and to refuse a mismatch rather
// than act on it. Both checks happen here, at load, so nothing downstream has to re-verify.

// `path` is required on every skill but is meaningless for a served one, which has no file on disk.
// A synthetic path keeps the field honest about being a placeholder while staying absolute, and
// `Skill.prepare` branches on `origin` so nothing ever scans this location.
const placeholder = (server: string, name: string) => AbsolutePath.make(`/mcp/${server}/${name}/SKILL.md`)

export const Plugin = define({
  id: "opencode.mcp.skill",
  effect: Effect.fn(function* (ctx) {
    const mcp = yield* Mcp.Service
    // What this producer currently publishes, mutated in place by `sync` and replayed by the single
    // transform below. State replays every registered transform on each rebuild, so registering one
    // per sync would stack registrations and resurrect skills a later sync withdrew.
    const published = new Map<Skill.ID, Skill.Info>()

    const load = Effect.fn("McpSkillPlugin.load")(function* (server: string, skill: Mcp.ServerSkill) {
      const entry = skill.files.find((file) => file.uri === skill.uri)

      if (!entry) return undefined

      const content = yield* mcp
        .readResource({ server, uri: entry.uri })
        .pipe(Effect.catchCause(() => Effect.succeed(undefined)))

      if (!content) return undefined
      // A read is only usable when the text matches the digest and length the listing published. A
      // mismatch means the bytes are not what the listing promised, so the skill is dropped rather
      // than surfaced.
      const text = content.contents.flatMap((part) => (part.type === "text" ? [part.text] : []))

      if (text.length !== 1) return undefined

      if (text[0].length !== entry.size) return undefined

      if (sha256(text[0]) !== entry.digest) return undefined
      const markdown = ConfigMarkdown.parseOption(text[0])

      if (!markdown) return undefined

      const info = {
        id: Skill.ID.make(`mcp:${server}:${skill.name}`),
        name: Skill.Name.make(skill.name),
        path: placeholder(server, skill.name),
        content: markdown.content,
        origin: Skill.McpOrigin.make({
          type: "mcp",
          server,
          uri: skill.uri,
          files: skill.files.filter((file) => file.uri !== skill.uri).map((file) => file.uri),
        }),
      }

      // The guidance drops a skill with no description, so a server that omits one would otherwise
      // contribute an entry the model could never discover. It is assigned when present rather than
      // spread in behind an empty object, which would hide the omission.
      if (skill.description !== undefined) return Skill.Info.make({ ...info, description: skill.description })
      return Skill.Info.make(info)
    })

    const sync = Effect.fn("McpSkillPlugin.sync")(function* () {
      const connected = (yield* mcp.servers()).filter((server) => server.status.status === "connected")
      const loaded = new Map<Skill.ID, Skill.Info>()

      for (const server of connected) {
        // SAFETY: an empty array literal is assignable to ReadonlyArray<Mcp.ServerSkill> without a
        // widening step, so the cast is only naming the type the recovery branch already produces.
        const skills = yield* mcp
          .skills({ server: server.name })
          .pipe(Effect.catchCause(() => Effect.succeed([] as Mcp.ServerSkill[])))

        for (const skill of skills) {
          const info = yield* load(server.name, skill)

          if (info) loaded.set(info.id, info)
        }
      }

      published.clear()

      for (const [id, info] of loaded) published.set(id, info)
    })

    // Registered once, reading `published` on every rebuild. Registering per sync would stack
    // transforms and re-add withdrawn skills.
    yield* ctx.skill.transform((editor) => {
      for (const [id, info] of published) editor.add(info)
    })

    // Subscribe before the first sync so a server that connects during it still converges.
    yield* ctx.event.subscribe().pipe(
      Stream.filter((event) => event.type === "mcp.status.changed"),
      Stream.runForEach(() =>
        sync().pipe(
          Effect.andThen(ctx.skill.reload()),
          Effect.catchCause((cause) => Effect.logError("failed to sync MCP skills", { cause })),
        ),
      ),
      Effect.ignore,
      Effect.forkScoped({ startImmediately: true }),
    )

    yield* sync().pipe(Effect.andThen(ctx.skill.reload()))
  }),
})

// The extension's digest format is `sha256:<64 lowercase hex>` over the file's raw bytes.
function sha256(input: string) {
  return `sha256:${new Bun.CryptoHasher("sha256").update(input).digest("hex")}`
}
