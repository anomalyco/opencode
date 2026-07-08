import { describe, expect, test } from "bun:test"
import { Effect, FileSystem, Layer } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import path from "path"
import { Scaffold } from "@opencode-ai/core/work"
import { testEffect } from "../lib/effect"

const live = NodeFileSystem.layer
const { live: it } = testEffect(live)

describe("Work scaffold", () => {
  describe("at()", () => {
    test("builds the fixed folder layout", () => {
      const folder = Scaffold.at("/tmp/MI-TRABAJO" as any)
      expect(folder.aboutMe.endsWith("ABOUT-ME")).toBe(true)
      expect(folder.projects.endsWith("PROJECTS")).toBe(true)
      expect(folder.templates.endsWith("TEMPLATES")).toBe(true)
      expect(folder.outputs.endsWith("OUTPUTS")).toBe(true)
      expect(folder.folderMd.endsWith("FOLDER.md")).toBe(true)
    })
  })

  describe("detect()", () => {
    it(
      "returns false for a bare directory",
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const tmp = yield* fs.makeTempDirectoryScoped()
        expect(yield* Scaffold.detect(tmp as any)).toBe(false)
      }),
    )

    it(
      "returns true after create() runs",
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const tmp = yield* fs.makeTempDirectoryScoped()
        yield* Scaffold.create(tmp as any)
        expect(yield* Scaffold.detect(tmp as any)).toBe(true)
      }),
    )
  })

  describe("create()", () => {
    it(
      "creates all four directories and seed templates",
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const tmp = yield* fs.makeTempDirectoryScoped()
        const folder = yield* Scaffold.create(tmp as any)

        expect(yield* fs.exists(folder.aboutMe)).toBe(true)
        expect(yield* fs.exists(folder.projects)).toBe(true)
        expect(yield* fs.exists(folder.templates)).toBe(true)
        expect(yield* fs.exists(folder.outputs)).toBe(true)

        expect(yield* fs.exists(path.join(folder.aboutMe, "about-me.md"))).toBe(true)
        expect(yield* fs.exists(path.join(folder.aboutMe, "writing-style.md"))).toBe(true)
        expect(yield* fs.exists(folder.folderMd)).toBe(true)

        // about-me.md must be seeded, not empty
        const about = yield* fs.readFileString(path.join(folder.aboutMe, "about-me.md"))
        expect(about).toContain("# About me")
      }),
    )

    it(
      "is idempotent and never overwrites user content",
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const tmp = yield* fs.makeTempDirectoryScoped()

        yield* Scaffold.create(tmp as any)
        const aboutMePath = path.join(tmp, "ABOUT-ME", "about-me.md")
        yield* fs.writeFileString(aboutMePath, "MY CUSTOM CONTENT")

        yield* Scaffold.create(tmp as any)
        const content = yield* fs.readFileString(aboutMePath)
        expect(content).toBe("MY CUSTOM CONTENT")
      }),
    )
  })
})