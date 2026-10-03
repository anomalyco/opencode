import os from "os"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { ConfigVariable } from "@opencode/core/config/variable"
import { FSUtil } from "@opencode/util/fs-util"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

// substitute() only reads files through FSUtil, so a spy layer records the exact
// paths the substitution asks for while serving canned content.
function spyFileSystemLayer(spy: { paths: string[]; content: string }) {
  return Layer.effect(
    FSUtil.Service,
    FSUtil.Service.use((fs) =>
      Effect.succeed(
        FSUtil.Service.of({
          ...fs,
          readFileString: (target: string) => {
            spy.paths.push(target)
            return Effect.succeed(spy.content)
          },
        }),
      ),
    ),
  ).pipe(Layer.provide(LayerNode.compile(FSUtil.node)))
}

describe("ConfigVariable.substitute", () => {
  // Reproduction: a UNC path inside a JSON string value must be written with
  // doubled backslashes, so the raw token body cannot be used as a filesystem
  // path — it has to be JSON-decoded first.
  it.effect("decodes JSON string escapes in {file:...} bodies before filesystem access", () =>
    Effect.gen(function* () {
      const spy = { paths: [] as string[], content: "decoded" }
      const text = String.raw`{"shell":"{file:\\\\server\\share\\mcp.json}"}`
      const substituted = yield* ConfigVariable.substitute({ type: "path", path: "/project/opencode.json", text }).pipe(
        Effect.provide(spyFileSystemLayer(spy)),
      )
      expect(spy.paths).toEqual([String.raw`\\server\share\mcp.json`])
      expect(substituted).toBe(`{"shell":"decoded"}`)
    }),
  )

  // A plain Windows path written as JSON (doubled backslashes) must decode to
  // the same path the user meant; on POSIX the body has no escapes and passes
  // through unchanged, so this holds on every platform.
  it.effect("decodes escaped Windows paths in {file:...} bodies", () =>
    Effect.gen(function* () {
      const spy = { paths: [] as string[], content: "decoded" }
      const target = path.join("C:", "Users", "dev", "mcp.json")
      const body = JSON.stringify(target).slice(1, -1)
      const text = `{"shell":"{file:${body}}"}`
      const substituted = yield* ConfigVariable.substitute({ type: "path", path: "/project/opencode.json", text }).pipe(
        Effect.provide(spyFileSystemLayer(spy)),
      )
      expect(spy.paths).toEqual([target])
      expect(substituted).toBe(`{"shell":"decoded"}`)
    }),
  )

  it.effect("resolves plain relative {file:...} paths against the config directory", () =>
    Effect.gen(function* () {
      const spy = { paths: [] as string[], content: "decoded" }
      const text = String.raw`{"shell":"{file:sub/mcp.json}"}`
      const substituted = yield* ConfigVariable.substitute({ type: "path", path: "/project/opencode.json", text }).pipe(
        Effect.provide(spyFileSystemLayer(spy)),
      )
      expect(spy.paths).toEqual([path.resolve("/project", "sub/mcp.json")])
      expect(substituted).toBe(`{"shell":"decoded"}`)
    }),
  )

  it.effect("keeps the raw path when a {file:...} body is not valid JSON string content", () =>
    Effect.gen(function* () {
      const spy = { paths: [] as string[], content: "decoded" }
      const text = String.raw`{"shell":"{file:\q}"}`
      const substituted = yield* ConfigVariable.substitute({ type: "path", path: "/project/opencode.json", text }).pipe(
        Effect.provide(spyFileSystemLayer(spy)),
      )
      expect(spy.paths).toHaveLength(1)
      expect(substituted).toBe(`{"shell":"decoded"}`)
    }),
  )

  it.effect("expands ~ after decoding escapes in {file:...} bodies", () =>
    Effect.gen(function* () {
      const spy = { paths: [] as string[], content: "decoded" }
      const text = String.raw`{"shell":"{file:~\/config/mcp.json}"}`
      const substituted = yield* ConfigVariable.substitute({ type: "path", path: "/project/opencode.json", text }).pipe(
        Effect.provide(spyFileSystemLayer(spy)),
      )
      expect(spy.paths).toEqual([path.join(os.homedir(), path.join("config", "mcp.json"))])
      expect(substituted).toBe(`{"shell":"decoded"}`)
    }),
  )
})
