import { describe, test, expect, beforeAll, beforeEach, afterAll } from "bun:test"
import { Effect } from "effect"
import { Discovery } from "../../src/skill/discovery"
import { Global } from "../../src/global"
import { Filesystem } from "../../src/util/filesystem"
import { rm } from "fs/promises"
import path from "path"

const oldPath = "/.well-known/skills/"
const newPath = "/.well-known/agent-skills/"

let oldUrl: string
let newUrl: string
let rootUrl: string
let server: ReturnType<typeof Bun.serve>
let count = 0
let hits: string[] = []
let gate = { old: true, new: true }

const fixturePath = path.join(import.meta.dir, "../fixture/skills")
const cacheDir = path.join(Global.Path.cache, "skills")

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      hits.push(url.pathname)

      const base =
        url.pathname.startsWith(newPath) && gate.new
          ? newPath
          : url.pathname.startsWith(oldPath) && gate.old
            ? oldPath
            : null

      if (base) {
        const filePath = url.pathname.slice(base.length)
        const fullPath = path.join(fixturePath, filePath)

        if (await Filesystem.exists(fullPath)) {
          if (!fullPath.endsWith("index.json")) {
            count++
          }
          return new Response(Bun.file(fullPath))
        }
      }

      return new Response("Not Found", { status: 404 })
    },
  })

  oldUrl = `http://localhost:${server.port}${oldPath}`
  newUrl = `http://localhost:${server.port}${newPath}`
  rootUrl = `http://localhost:${server.port}/`
})

beforeEach(async () => {
  await rm(cacheDir, { recursive: true, force: true })
  count = 0
  hits = []
  gate = { old: true, new: true }
})

afterAll(async () => {
  server?.stop()
  await rm(cacheDir, { recursive: true, force: true })
})

describe("Discovery.pull", () => {
  const pull = (url: string) =>
    Effect.runPromise(Discovery.Service.use((s) => s.pull(url)).pipe(Effect.provide(Discovery.defaultLayer)))
  const indexes = () => hits.filter((item) => item.endsWith("/index.json"))

  test("downloads skills from legacy well-known url", async () => {
    const dirs = await pull(oldUrl)
    expect(dirs.length).toBeGreaterThan(0)
    for (const dir of dirs) {
      expect(dir).toStartWith(cacheDir)
      const md = path.join(dir, "SKILL.md")
      expect(await Filesystem.exists(md)).toBe(true)
    }
    expect(indexes()).toEqual([`${oldPath}index.json`])
  })

  test("downloads skills from agent-skills url", async () => {
    const dirs = await pull(newUrl)
    expect(dirs.length).toBeGreaterThan(0)
    for (const dir of dirs) {
      const md = path.join(dir, "SKILL.md")
      expect(await Filesystem.exists(md)).toBe(true)
    }
    expect(indexes()).toEqual([`${newPath}index.json`])
  })

  test("legacy url without trailing slash works", async () => {
    const dirs = await pull(oldUrl.replace(/\/$/, ""))
    expect(dirs.length).toBeGreaterThan(0)
    expect(indexes()).toEqual([`${oldPath}index.json`])
  })

  test("agent-skills url without trailing slash works", async () => {
    const dirs = await pull(newUrl.replace(/\/$/, ""))
    expect(dirs.length).toBeGreaterThan(0)
    expect(indexes()).toEqual([`${newPath}index.json`])
  })

  test("returns empty array for invalid url", async () => {
    const dirs = await pull(`http://localhost:${server.port}/invalid-url/`)
    expect(dirs).toEqual([])
    expect(indexes()).toEqual(["/invalid-url/index.json"])
  })

  test("returns empty array for non-json response", async () => {
    // any url not explicitly handled in server returns 404 text "Not Found"
    const dirs = await pull(`http://localhost:${server.port}/some-other-path/`)
    expect(dirs).toEqual([])
    expect(indexes()).toEqual(["/some-other-path/index.json"])
  })

  test("downloads reference files alongside SKILL.md", async () => {
    const dirs = await pull(oldUrl)
    // find a skill dir that should have reference files (e.g. agents-sdk)
    const agentsSdk = dirs.find((d) => d.endsWith(path.sep + "agents-sdk"))
    expect(agentsSdk).toBeDefined()
    if (agentsSdk) {
      const refs = path.join(agentsSdk, "references")
      expect(await Filesystem.exists(path.join(agentsSdk, "SKILL.md"))).toBe(true)
      // agents-sdk has reference files per the index
      const refDir = await Array.fromAsync(new Bun.Glob("**/*.md").scan({ cwd: refs, onlyFiles: true }))
      expect(refDir.length).toBeGreaterThan(0)
    }
  })

  test("caches downloaded files on second pull", async () => {
    const first = await pull(newUrl)
    expect(first.length).toBeGreaterThan(0)
    const firstCount = count
    expect(firstCount).toBeGreaterThan(0)

    const second = await pull(newUrl)
    expect(second.length).toBe(first.length)
    expect(second.sort()).toEqual(first.sort())
    expect(count).toBe(firstCount)
  })

  test("root url falls back to agent-skills before legacy", async () => {
    const dirs = await pull(rootUrl)
    expect(dirs.length).toBeGreaterThan(0)
    expect(indexes()).toEqual(["/index.json", `${newPath}index.json`])
  })

  test("root url falls back to legacy when agent-skills is unavailable", async () => {
    gate = { old: true, new: false }

    const dirs = await pull(rootUrl)
    expect(dirs.length).toBeGreaterThan(0)
    expect(indexes()).toEqual(["/index.json", `${newPath}index.json`, `${oldPath}index.json`])
  })
})
