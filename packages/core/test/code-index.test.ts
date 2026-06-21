import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Service as CodeIndexService, layer as CodeIndexLayer } from "../src/memory/index-service"
import { Database } from "../src/database/database"
import { it } from "./lib/effect"
import { tmpdir } from "./fixture/tmpdir"
import fs from "fs/promises"
import path from "path"

function layer() {
  return CodeIndexLayer.pipe(
    Layer.provide(Database.layerFromPath(":memory:").pipe(Layer.fresh)),
  )
}

describe("CodeIndexService", () => {
  it.live("indexes codebase files recursively and performs semantic searches", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const projectDir = tmp.path

          // Create some mock project files
          const srcDir = path.join(projectDir, "src")
          yield* Effect.promise(() => fs.mkdir(srcDir, { recursive: true }))

          const codeFile1 = path.join(srcDir, "math.ts")
          const codeContent1 = `
export function add(a: number, b: number): number {
  return a + b
}

export function subtract(a: number, b: number): number {
  return a - b
}
`
          yield* Effect.promise(() => fs.writeFile(codeFile1, codeContent1, "utf-8"))

          const codeFile2 = path.join(projectDir, "README.md")
          const codeContent2 = `
# ZERO Assistant Project
This is the README file describing the project parameters.
Use Python for scripts and TypeScript for core services.
`
          yield* Effect.promise(() => fs.writeFile(codeFile2, codeContent2, "utf-8"))

          const service = yield* CodeIndexService

          // Index project
          const indexResult = yield* service.indexProject(projectDir)
          expect(indexResult.filesIndexed).toBe(2)
          expect(indexResult.chunksCreated).toBe(2)

          // Perform semantic search
          const searchResult1 = yield* service.searchCode("subtract")
          expect(searchResult1.length).toBeGreaterThan(0)
          expect(searchResult1[0].filepath).toBe(codeFile1)
          expect(searchResult1[0].content).toContain("subtract")

          const searchResult2 = yield* service.searchCode("parameters")
          expect(searchResult2.length).toBeGreaterThan(0)
          expect(searchResult2[0].filepath).toBe(codeFile2)
          expect(searchResult2[0].content).toContain("ZERO Assistant")
        }).pipe(Effect.provide(layer())),
      ),
    ),
  )
})
