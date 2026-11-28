import { describe, expect, test } from "bun:test"
import { Mcp } from "@opencode/core/mcp/index"
import type { McpClient } from "@opencode/core/mcp/client"
import { McpSkillPlugin } from "@opencode/core/plugin/mcp-skill"
import { Skill } from "@opencode/core/skill"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { serve } from "./fixture/http"
import { remote, until, world } from "./harness"

const it = testEffect(Layer.empty)

describe("McpSkillPlugin.parseEntry", () => {
  const server = Mcp.ServerName.make("team")
  const entry = (resources: McpClient.Skill["resources"]): Mcp.Skill => ({
    server,
    entry: { uri: "skill://acme/pdf/SKILL.md", frontmatter: { name: "pdf", description: "PDFs" }, resources },
  })
  const file = (path: string) => ({ uri: `skill://acme/pdf/${path}`, digest: `sha256:${path}`, size: 1 })

  test("keeps SKILL.md's digest and the skill's other files by path", () => {
    const parsed = McpSkillPlugin.parseEntry(entry([file("SKILL.md"), file("references/FORMS.md")]))
    if (parsed._tag !== "Served") throw new Error("expected a served skill")
    expect(parsed.skill.manifest).toBe("sha256:SKILL.md")
    expect(Array.from(parsed.skill.files, ([path, digest]) => [String(path), digest])).toEqual([
      ["references/FORMS.md", "sha256:references/FORMS.md"],
    ])
  })

  test("leaves out files outside the skill's folder or with unsafe paths", () => {
    const parsed = McpSkillPlugin.parseEntry(
      entry([file("SKILL.md"), { uri: "skill://acme/other/x.md", digest: "sha256:x", size: 1 }, file("%2e%2e/secret")]),
    )
    expect(parsed._tag === "Served" && parsed.skill.files.size).toBe(0)
  })

  test("versions a skill by its server and every listed file", () => {
    const version = (skill: Mcp.Skill) => {
      const parsed = McpSkillPlugin.parseEntry(skill)
      if (parsed._tag !== "Served") throw new Error("expected a served skill")
      return parsed.skill.version
    }
    const listed = entry([file("SKILL.md"), file("references/FORMS.md")])
    expect(version(listed)).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(version(entry([file("references/FORMS.md"), file("SKILL.md")]))).toBe(version(listed))
    expect(version(entry([file("SKILL.md"), { ...file("references/FORMS.md"), digest: "sha256:changed" }]))).not.toBe(
      version(listed),
    )
    expect(version({ ...listed, server: Mcp.ServerName.make("other") })).not.toBe(version(listed))
  })

  test("rejects dynamic skills and skills that don't list SKILL.md", () => {
    expect(McpSkillPlugin.parseEntry(entry("dynamic"))).toMatchObject({ _tag: "Rejected", reason: "dynamic" })
    expect(McpSkillPlugin.parseEntry(entry([file("references/FORMS.md")]))).toMatchObject({
      _tag: "Rejected",
      reason: "no_manifest",
    })
  })
})

describe("MCP skills", () => {
  it.live("resolve a skill the server confirms by URI, ask once per version, and refuse files that changed", () =>
    Effect.gen(function* () {
      const server = yield* serve({ era: "modern", skills: true })
      const place = yield* (yield* world).open({ servers: { team: remote(server.url) } })
      const deploy = Skill.ID.make("team:deploy")
      yield* until("the skill", place.skills.list(), (list) => list.some((skill) => skill.id === deploy))

      expect(yield* place.skills.resolve("team:skill://billing/disputes/SKILL.md")).toMatchObject({
        id: Skill.ID.make("team:billing.disputes"),
      })
      expect(yield* place.skills.content(Skill.ID.make("team:billing.disputes"))).toBe("# Disputes\n")
      expect((yield* place.skills.resolve("team:skill://billing/missing/SKILL.md").pipe(Effect.flip))._tag).toBe(
        "Skill.LoadError",
      )

      const approval = yield* place.skills.approval(deploy)
      expect(approval.resources).toEqual([deploy, expect.stringMatching(/^team:deploy@sha256:[0-9a-f]{64}$/)])

      // Verified files are kept by digest, so loading again reads nothing.
      const reads = () => server.seen.methods.filter((method) => method === "resources/read").length
      expect(yield* place.skills.content(deploy)).toBe("# Deploy\n\nRun scripts/run.sh.\n")
      const before = reads()
      expect(yield* place.skills.content(deploy)).toBe("# Deploy\n\nRun scripts/run.sh.\n")
      expect(reads()).toBe(before)

      server.state.tampered = true
      const script = Skill.parseFilePath("scripts/run.sh")!
      const error = yield* place.skills.read(deploy, script).pipe(Effect.flip)
      expect(error._tag === "Skill.LoadError" && error.reason).toMatchObject({
        _tag: "Mismatch",
        file: "scripts/run.sh",
        check: "digest",
      })
    }),
  )
})
