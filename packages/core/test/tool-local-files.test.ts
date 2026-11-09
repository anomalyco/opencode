import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { Effect, Schema } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Tool } from "@opencode/core/tool"
import { Agent } from "@opencode/schema/agent"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import type { Content, Info } from "@opencode/schema/tool"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"
import { executeTool, toolNodeReplacements } from "./lib/tool"
import { withTempDir } from "./fixture/tmpdir"

const layer = AppNodeBuilder.build(LayerNode.group([Tool.node, PluginHooks.node]), toolNodeReplacements())
const it = testEffect(layer)

const identity = {
  sessionID: Session.ID.make("ses_tool_files"),
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_tool_files"),
}

const capture = (content: ReadonlyArray<Content>): Info => ({
  name: "capture",
  description: "Return fixed file content",
  input: Schema.Struct({}),
  execute: () => Effect.succeed({ content }),
})

const run = (content: ReadonlyArray<Content>) =>
  Effect.gen(function* () {
    const registry = yield* Tool.Service
    yield* registry.transform((editor) =>
      editor.add({ ...capture(content), options: { codemode: false } }),
    )
    return yield* executeTool(registry, {
      ...identity,
      call: { type: "tool-call", id: "call-capture", name: "capture", input: {} },
    })
  })

describe("Tool local file content", () => {
  it.live("inlines readable local files as data URLs", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const source = Buffer.from("capture bytes")
        const file = path.join(tmp.path, "capture.png")
        yield* Effect.tryPromise(() => fs.writeFile(file, source))
        const execution = yield* run([
          { type: "file", uri: pathToFileURL(file).href, mime: "image/png", name: "capture.png" },
        ])
        expect(execution.status).toBe("completed")
        expect(execution.content).toEqual([
          {
            type: "file",
            uri: `data:image/png;base64,${source.toString("base64")}`,
            mime: "image/png",
            name: "capture.png",
          },
        ])
      }),
    ),
  )

  it.live("degrades unreadable files to a note", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const file = path.join(tmp.path, "missing.png")
        const execution = yield* run([
          { type: "file", uri: pathToFileURL(file).href, mime: "image/png", name: "missing.png" },
        ])
        expect(execution.status).toBe("completed")
        expect(execution.content).toEqual([
          { type: "text", text: "[missing.png omitted: could not be read]" },
        ])
      }),
    ),
  )
  it.live("returns textual files as text instead of media", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const file = path.join(tmp.path, "notes.txt")
        yield* Effect.tryPromise(() => fs.writeFile(file, "hello from disk"))
        const execution = yield* run([
          { type: "file", uri: pathToFileURL(file).href, mime: "text/plain", name: "notes.txt" },
        ])
        expect(execution.status).toBe("completed")
        expect(execution.content).toEqual([
          { type: "text", text: "[Resource notes.txt (text/plain)]\nhello from disk" },
        ])
      }),
    ),
  )

  it.live("degrades unsupported file types to a note", () =>
    Effect.gen(function* () {
      const execution = yield* run([
        { type: "file", uri: "file:///C:/Windows/win.ini", mime: "application/zip", name: "archive.zip" },
      ])
      expect(execution.status).toBe("completed")
      expect(execution.content).toEqual([{ type: "text", text: "[archive.zip omitted: unsupported file type]" }])
    }),
  )

  it.live("leaves remote references untouched", () =>
    Effect.gen(function* () {
      const execution = yield* run([{ type: "file", uri: "https://example.test/capture.png", mime: "image/png" }])
      expect(execution.status).toBe("completed")
      expect(execution.content).toEqual([
        { type: "file", uri: "https://example.test/capture.png", mime: "image/png" },
      ])
    }),
  )
})
