import { describe, expect } from "bun:test"
import path from "path"
import { Effect, FileSystem } from "effect"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ReadToolFileSystem } from "@opencode-ai/core/tool/read-filesystem"
import { Skeleton } from "../src/skeleton"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([FSUtil.node, Skeleton.node, LayerNodePlatform.filesystem])))
const fixture = Effect.gen(function* () {
  const fs = yield* FSUtil.Service
  const files = yield* FileSystem.FileSystem
  const directory = yield* files.makeTempDirectoryScoped()
  return { fs, files, directory }
})

describe("ReadToolFileSystem Skeleton Pruning", () => {
  it.effect("prunes TypeScript function bodies when view is skeleton", () =>
    Effect.gen(function* () {
      const { fs, files, directory } = yield* fixture
      const file = path.join(directory, "service.ts")
      const code = `export interface Config {
  host: string
  port: number
}

export class Server {
  start(): void {
    console.log("Starting server...")
    console.log("Listening on port 8080")
  }
}

export function handleRequest(req: any): string {
  const parsed = JSON.parse(req)
  return "OK: " + parsed.id
}
`
      yield* files.writeFileString(file, code)

      const result = yield* ReadToolFileSystem.read(fs, file, "service.ts", { view: "skeleton" })

      expect(result).toHaveProperty("type", "text-page")
      if ("type" in result && result.type === "text-page") {
        expect(result.view).toBe("skeleton")
        expect(result.content).toContain("export interface Config")
        expect(result.content).toContain("export class Server")
        expect(result.content).toContain("start(): void { /* body omitted */ }")
        expect(result.content).toContain("export function handleRequest(req: any): string { /* body omitted */ }")
        expect(result.content).not.toContain("Starting server...")
        expect(result.content).not.toContain("JSON.parse")
        expect(result.skeletonLines).toBeLessThan(result.originalLines!)
      }
    }),
  )

  it.effect("prunes Python function bodies while keeping signatures and docstrings", () =>
    Effect.gen(function* () {
      const { fs, files, directory } = yield* fixture
      const file = path.join(directory, "handler.py")
      const code = `class DataHandler:
    """Handles data processing pipeline."""

    def __init__(self, name: str):
        self.name = name
        self.buffer = []
        print("Initialized")

    def process(self, item: dict) -> bool:
        """Process a single record."""
        validated = item.get("valid", False)
        if validated:
            self.buffer.append(item)
            return True
        return False
`
      yield* files.writeFileString(file, code)

      const result = yield* ReadToolFileSystem.read(fs, file, "handler.py", { view: "skeleton" })

      expect(result).toHaveProperty("type", "text-page")
      if ("type" in result && result.type === "text-page") {
        expect(result.view).toBe("skeleton")
        expect(result.content).toContain("class DataHandler:")
        expect(result.content).toContain('"""Handles data processing pipeline."""')
        expect(result.content).toContain("def __init__(self, name: str):")
        expect(result.content).toContain("def process(self, item: dict) -> bool:")
        expect(result.content).toContain('"""Process a single record."""')
        expect(result.content).not.toContain("self.buffer = []")
        expect(result.content).not.toContain("validated = item.get")
        expect(result.skeletonLines).toBeLessThan(result.originalLines!)
      }
    }),
  )

  it.effect("returns full content when view is omitted or full", () =>
    Effect.gen(function* () {
      const { fs, files, directory } = yield* fixture
      const file = path.join(directory, "full.ts")
      const code = `export function add(a: number, b: number) {
  return a + b
}
`
      yield* files.writeFileString(file, code)

      const omittedResult = yield* ReadToolFileSystem.read(fs, file, "full.ts")
      expect(omittedResult.content).toBe(code)

      const fullResult = yield* ReadToolFileSystem.read(fs, file, "full.ts", { view: "full" })
      expect(fullResult.content).toBe(code)
    }),
  )

  it.effect("returns full content cleanly when file has no prunable functions", () =>
    Effect.gen(function* () {
      const { fs, files, directory } = yield* fixture
      const file = path.join(directory, "types.ts")
      const code = `export interface User {
  id: string
  name: string
}

export type Role = "admin" | "user"
`
      yield* files.writeFileString(file, code)

      const result = yield* ReadToolFileSystem.read(fs, file, "types.ts", { view: "skeleton" })
      expect(result.content).toBe(code)
    }),
  )

  it.effect("automatically activates skeleton view when file exceeds 800 lines and pagination/view are omitted", () =>
    Effect.gen(function* () {
      const { fs, files, directory } = yield* fixture
      const file = path.join(directory, "large-service.ts")

      // Generate a TypeScript file with > 800 lines (850 lines)
      const parts: string[] = ["export interface CommonConfig { id: string }"]
      for (let i = 1; i <= 280; i++) {
        parts.push(`export function handler${i}(param: number): string {
  const calculation = param * 2 + ${i}
  return "result: " + calculation
}`)
      }
      const code = parts.join("\n\n") + "\n"
      yield* files.writeFileString(file, code)

      // Read without options (no view, no offset, no limit)
      const result = yield* ReadToolFileSystem.read(fs, file, "large-service.ts")

      expect(result).toHaveProperty("type", "text-page")
      if ("type" in result && result.type === "text-page") {
        expect(result.view).toBe("skeleton")
        expect(result.content).toContain("export interface CommonConfig")
        expect(result.content).toContain("export function handler1(param: number): string { /* body omitted */ }")
        expect(result.content).not.toContain("const calculation =")
        expect(result.originalLines).toBeGreaterThanOrEqual(800)
        expect(result.skeletonLines).toBeLessThan(result.originalLines!)
      }
    }),
  )

  it.effect("does not activate auto-skeleton when file exceeds 800 lines but view is explicitly full", () =>
    Effect.gen(function* () {
      const { fs, files, directory } = yield* fixture
      const file = path.join(directory, "large-full.ts")

      const parts: string[] = ["export interface FullConfig { id: string }"]
      for (let i = 1; i <= 280; i++) {
        parts.push(`export function fullHandler${i}(param: number): string {
  const calculation = param * 2 + ${i}
  return "result: " + calculation
}`)
      }
      const code = parts.join("\n\n") + "\n"
      yield* files.writeFileString(file, code)

      const result = yield* ReadToolFileSystem.read(fs, file, "large-full.ts", { view: "full" })

      if ("view" in result) {
        expect(result.view).toBeUndefined()
      }
      expect(result.content).toContain("const calculation =")
      expect(result.content).not.toContain("/* body omitted */")
    }),
  )

  it.effect("does not activate auto-skeleton when file exceeds 800 lines but pagination offset/limit is specified", () =>
    Effect.gen(function* () {
      const { fs, files, directory } = yield* fixture
      const file = path.join(directory, "large-paged.ts")

      const parts: string[] = ["export interface PagedConfig { id: string }"]
      for (let i = 1; i <= 280; i++) {
        parts.push(`export function pagedHandler${i}(param: number): string {
  const calculation = param * 2 + ${i}
  return "result: " + calculation
}`)
      }
      const code = parts.join("\n\n") + "\n"
      yield* files.writeFileString(file, code)

      const result = yield* ReadToolFileSystem.read(fs, file, "large-paged.ts", { offset: 1, limit: 10 })

      expect(result).toHaveProperty("type", "text-page")
      if ("type" in result && result.type === "text-page") {
        expect(result.view).toBeUndefined()
        expect(result.offset).toBe(1)
        expect(result.content).not.toContain("/* body omitted */")
      }
    }),
  )

  it.effect("does not activate auto-skeleton when file has fewer than 800 lines and view is omitted", () =>
    Effect.gen(function* () {
      const { fs, files, directory } = yield* fixture
      const file = path.join(directory, "under-threshold.ts")

      const parts: string[] = ["export interface SmallConfig { id: string }"]
      for (let i = 1; i <= 30; i++) {
        parts.push(`export function smallHandler${i}(param: number): string {
  const value = param + ${i}
  return "small: " + value
}`)
      }
      const code = parts.join("\n\n") + "\n"
      yield* files.writeFileString(file, code)

      const result = yield* ReadToolFileSystem.read(fs, file, "under-threshold.ts")

      expect(result.content).toBe(code)
      if ("view" in result) {
        expect(result.view).toBeUndefined()
      }
    }),
  )
})

