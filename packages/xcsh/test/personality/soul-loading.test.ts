import { describe, expect, test } from "bun:test"
import path from "path"
import { Personality } from "../../src/personality"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"

describe("Personality.loadSoul — SOUL.md file loading", () => {
  test("returns default soul when no SOUL.md files exist", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const soul = await Personality.loadSoul({
          configDir: path.join(tmp.path, "no-config"),
          projectDir: tmp.path,
        })
        expect(soul).toContain("You are")
        expect(soul.length).toBeGreaterThan(0)
      },
    })
  })

  test("loads global SOUL.md when present", async () => {
    await using tmp = await tmpdir({ git: true })
    const configDir = path.join(tmp.path, "config")
    await Bun.write(path.join(configDir, "SOUL.md"), "You are a custom global assistant.")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const soul = await Personality.loadSoul({
          configDir,
          projectDir: tmp.path,
        })
        expect(soul).toContain("You are a custom global assistant.")
      },
    })
  })

  test("loads project SOUL.md when present", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, ".xcsh", "SOUL.md"), "You are a project-specific assistant.")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const soul = await Personality.loadSoul({
          configDir: path.join(tmp.path, "no-config"),
          projectDir: tmp.path,
        })
        expect(soul).toContain("You are a project-specific assistant.")
      },
    })
  })

  test("concatenates global + project SOUL.md when both exist", async () => {
    await using tmp = await tmpdir({ git: true })
    const configDir = path.join(tmp.path, "config")
    await Bun.write(path.join(configDir, "SOUL.md"), "Global identity.")
    await Bun.write(path.join(tmp.path, ".xcsh", "SOUL.md"), "Project overlay.")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const soul = await Personality.loadSoul({
          configDir,
          projectDir: tmp.path,
        })
        expect(soul).toContain("Global identity.")
        expect(soul).toContain("Project overlay.")
        // Global comes first
        expect(soul.indexOf("Global identity.")).toBeLessThan(soul.indexOf("Project overlay."))
      },
    })
  })

  test("falls back to default when SOUL.md is empty", async () => {
    await using tmp = await tmpdir({ git: true })
    const configDir = path.join(tmp.path, "config")
    await Bun.write(path.join(configDir, "SOUL.md"), "")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const soul = await Personality.loadSoul({
          configDir,
          projectDir: tmp.path,
        })
        expect(soul).toContain("You are")
        expect(soul.trim().length).toBeGreaterThan(0)
      },
    })
  })
})
