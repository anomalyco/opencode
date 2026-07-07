import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"
import { SkillDiscovery } from "@opencode-ai/core/skill/discovery"
import { tmpdir } from "./fixture/tmpdir"

type Fixture = {
  tmp: Awaited<ReturnType<typeof tmpdir>>
  server: Bun.Server<undefined>
  state: {
    skills: unknown[]
    files: Record<string, string>
    requests: string[]
  }
  base: string
}

async function pull(skills: unknown[], files: Record<string, string> = {}, fixture?: Fixture) {
  const state = fixture?.state ?? { skills, files, requests: [] }
  state.skills = skills
  state.files = files
  state.requests = []
  const server =
    fixture?.server ??
    Bun.serve({
      port: 0,
      fetch(request) {
        state.requests.push(request.url)
        const pathname = new URL(request.url).pathname
        const body =
          pathname === "/catalog/index.json" ? JSON.stringify({ skills: state.skills }) : state.files[pathname]
        return new Response(body ?? "Not Found", { status: body === undefined ? 404 : 200 })
      },
    })
  const tmp = fixture?.tmp ?? (await tmpdir())
  const base = fixture?.base ?? new URL("/catalog/", server.url).href
  const skillDiscoveryLayer = AppNodeBuilder.build(SkillDiscovery.node, [
    [Global.node, Global.layerWith({ cache: tmp.path })],
  ])
  const directories = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* SkillDiscovery.Service).pull(base)
    }).pipe(Effect.provide(skillDiscoveryLayer)),
  )
  return { tmp, server, state, base, requests: state.requests, directories }
}

async function dispose(fixture: Fixture) {
  await fixture.server.stop(true)
  await fixture.tmp[Symbol.asyncDispose]()
}

describe("SkillDiscovery.pull", () => {
  test("rejects skill name traversal without fetching files", async () => {
    const result = await pull([{ name: "../outside", files: ["SKILL.md"] }])
    try {
      expect(result.directories).toEqual([])
      expect(result.requests).toEqual([`${result.base}index.json`])
      expect(await fs.readdir(result.tmp.path)).toEqual([])
    } finally {
      await dispose(result)
    }
  })

  test("rejects file traversal without fetching files", async () => {
    const result = await pull([{ name: "deploy", files: ["SKILL.md", "../outside.md"] }])
    try {
      expect(result.directories).toEqual([])
      expect(result.requests).toEqual([`${result.base}index.json`])
      expect(await fs.readdir(result.tmp.path)).toEqual([])
    } finally {
      await dispose(result)
    }
  })

  test("rejects absolute file paths without fetching files", async () => {
    const result = await pull([{ name: "deploy", files: ["SKILL.md", "/tmp/outside.md"] }])
    try {
      expect(result.directories).toEqual([])
      expect(result.requests).toEqual([`${result.base}index.json`])
      expect(await fs.readdir(result.tmp.path)).toEqual([])
    } finally {
      await dispose(result)
    }
  })

  test("rejects cross-origin file URLs without fetching files", async () => {
    const result = await pull([{ name: "deploy", files: ["SKILL.md", "https://evil.example.test/outside.md"] }])
    try {
      expect(result.directories).toEqual([])
      expect(result.requests).toEqual([`${result.base}index.json`])
      expect(await fs.readdir(result.tmp.path)).toEqual([])
    } finally {
      await dispose(result)
    }
  })

  test("downloads safe nested files under the skill root", async () => {
    const result = await pull([{ name: "deploy", files: ["SKILL.md", "references/guide.md"] }], {
      "/catalog/deploy/SKILL.md": "# Deploy",
      "/catalog/deploy/references/guide.md": "# Guide",
    })
    try {
      expect(result.directories).toHaveLength(1)
      expect(result.requests.toSorted()).toEqual(
        [
          `${result.base}index.json`,
          `${result.base}deploy/SKILL.md`,
          `${result.base}deploy/references/guide.md`,
        ].toSorted(),
      )
      expect(await fs.readFile(path.join(result.directories[0], "SKILL.md"), "utf8")).toBe("# Deploy")
      expect(await fs.readFile(path.join(result.directories[0], "references", "guide.md"), "utf8")).toBe("# Guide")
    } finally {
      await dispose(result)
    }
  })

  test("refreshes cached files when the version changes", async () => {
    const first = await pull([{ name: "deploy", version: "1", files: ["SKILL.md"] }], {
      "/catalog/deploy/SKILL.md": "# Old",
    })
    try {
      const second = await pull(
        [{ name: "deploy", version: "2", files: ["SKILL.md"] }],
        { "/catalog/deploy/SKILL.md": "# New" },
        first,
      )

      expect(await fs.readFile(path.join(first.directories[0], "SKILL.md"), "utf8")).toBe("# New")
      expect(second.requests).toContain(`${first.base}deploy/SKILL.md`)
      const third = await pull(
        [{ name: "deploy", version: "2", files: ["SKILL.md"] }],
        { "/catalog/deploy/SKILL.md": "# Ignored" },
        first,
      )
      expect(third.requests).toEqual([`${first.base}index.json`])
    } finally {
      await dispose(first)
    }
  })

  test("publishes complete updates and removes stale files", async () => {
    const first = await pull([{ name: "deploy", version: "1", files: ["SKILL.md", "old.md"] }], {
      "/catalog/deploy/SKILL.md": "# Old",
      "/catalog/deploy/old.md": "old reference",
    })
    try {
      const root = first.directories[0]

      await pull(
        [{ name: "deploy", version: "2", files: ["SKILL.md", "missing.md"] }],
        { "/catalog/deploy/SKILL.md": "# Partial" },
        first,
      )
      expect(await fs.readFile(path.join(root, "SKILL.md"), "utf8")).toBe("# Old")
      expect(await fs.readFile(path.join(root, "old.md"), "utf8")).toBe("old reference")

      await pull(
        [{ name: "deploy", version: "3", files: ["SKILL.md"] }],
        { "/catalog/deploy/SKILL.md": "# New" },
        first,
      )
      expect(await fs.readFile(path.join(root, "SKILL.md"), "utf8")).toBe("# New")
      expect(await Bun.file(path.join(root, "old.md")).exists()).toBe(false)
    } finally {
      await dispose(first)
    }
  })
})
