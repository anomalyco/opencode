import path from "path"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { parse } from "jsonc-parser"
import { isRecord } from "@opencode-ai/ai/utils/record"
import { ConfigFile } from "@opencode-ai/core/config/file"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { withTempDir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

// No Config, Location, Watcher, Credential, or WellKnown services are provided.
const it = testEffect(LayerNode.compile(FSUtil.node))

describe("ConfigFile", () => {
  it.live("edits the explicit target and preserves comments and unrelated fields", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const global = path.join(tmp.path, "global", "opencode.jsonc")
        const target = path.join(tmp.path, "project", "custom.jsonc")
        const text = '{\n  // Keep this comment.\n  "shell": "project",\n  "custom": { "value": 1 },\n}\n'
        yield* fs.writeWithDirs(global, '{ "shell": "global" }')
        yield* fs.writeWithDirs(target, text)

        const updated = yield* ConfigFile.update(target, (draft) => {
          draft.shell = "updated"
        })

        expect(updated).toEqual({ shell: "updated", custom: { value: 1 } })
        expect(yield* fs.readFileString(target)).toBe(text.replace('"project"', '"updated"'))
        expect(yield* fs.readFileString(global)).toBe('{ "shell": "global" }')
      }),
    ),
  )

  it.live("leaves raw substitutions, model shorthand, and legacy shapes unresolved", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const target = path.join(tmp.path, "opencode.jsonc")
        const text = `{
  "model": "{env:OPENCODE_TEST_CONFIG_MODEL}",
  "shell": "{file:missing-shell.txt}",
  "skills": { "paths": ["./skills"] },
  "agent": { "review": { "model": "acme/reasoner" } },
  "username": "before"
}
`
        yield* fs.writeFileString(target, text)
        yield* ConfigFile.update(target, (draft) => {
          expect(draft.model).toBe("{env:OPENCODE_TEST_CONFIG_MODEL}")
          expect(draft.shell).toBe("{file:missing-shell.txt}")
          expect(draft.skills).toEqual({ paths: ["./skills"] })
          draft.username = "after"
        })

        expect(yield* fs.readFileString(target)).toBe(text.replace('"before"', '"after"'))
      }),
    ),
  )

  it.live("patches nested source fields and deletes legacy keys without migrating them", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const target = path.join(tmp.path, "opencode.jsonc")
        yield* fs.writeFileString(
          target,
          `{
  "agent": {
    "review": { "description": "before", "hidden": true },
    // Keep the other definition.
    "build": { "description": "unchanged" }
  },
  "snapshot": true
}
`,
        )
        const updated = yield* ConfigFile.update(target, (draft) => {
          const agent: unknown = draft.agent
          if (!isRecord(agent) || !isRecord(agent.review)) throw new Error("Missing fixture agent")
          agent.review.description = "after"
          agent.review.color = "blue"
          delete agent.review.hidden
          delete draft.snapshot
        })

        expect(updated).toEqual({
          agent: { review: { description: "after", color: "blue" }, build: { description: "unchanged" } },
        })
        expect(parse(yield* fs.readFileString(target))).toEqual(updated)
        expect(yield* fs.readFileString(target)).toContain("// Keep the other definition.")
      }),
    ),
  )

  it.live("patches array elements without rewriting untouched comments", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const target = path.join(tmp.path, "opencode.jsonc")
        const text = `{
  "plugins": [
    // Keep the first plugin.
    "first",
    "second",
    // Keep the third plugin.
    "third",
    "fourth"
  ]
}
`
        yield* fs.writeFileString(target, text)
        yield* ConfigFile.update(target, (draft) => {
          if (!Array.isArray(draft.plugins)) throw new Error("Missing fixture plugins")
          draft.plugins[1] = "updated"
        })
        expect(yield* fs.readFileString(target)).toBe(text.replace('"second"', '"updated"'))

        const shortened = yield* ConfigFile.update(target, (draft) => {
          if (!Array.isArray(draft.plugins)) throw new Error("Missing fixture plugins")
          draft.plugins.splice(1, 3)
        })
        expect(shortened.plugins).toEqual(["first"])
        expect(parse(yield* fs.readFileString(target))).toEqual(shortened)

        const extended = yield* ConfigFile.update(target, (draft) => {
          if (!Array.isArray(draft.plugins)) throw new Error("Missing fixture plugins")
          draft.plugins.push("added", "last")
        })
        expect(extended.plugins).toEqual(["first", "added", "last"])
        expect(parse(yield* fs.readFileString(target))).toEqual(extended)
        expect(yield* fs.readFileString(target)).toContain("// Keep the first plugin.")
      }),
    ),
  )

  it.live("preserves adjacent comments when deleting properties and array elements", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const target = path.join(tmp.path, "opencode.jsonc")
        yield* fs.writeFileString(
          target,
          `{
  "shell": "remove",
  // Keep the model explanation.
  "model": "acme/reasoner",
  "plugins": ["first", "second", /* Keep the plugin explanation. */ "third"],
  "skills": [/* Keep the source explanation. */ "remove",],
}
`,
        )
        const updated = yield* ConfigFile.update(target, (draft) => {
          delete draft.shell
          if (!Array.isArray(draft.plugins)) throw new Error("Missing fixture plugins")
          draft.plugins.splice(1, 1)
          draft.skills = []
        })

        expect(parse(yield* fs.readFileString(target))).toEqual(updated)
        expect(updated).toEqual({ model: "acme/reasoner", plugins: ["first", "third"], skills: [] })
        expect(yield* fs.readFileString(target)).toContain("// Keep the model explanation.")
        expect(yield* fs.readFileString(target)).toContain("/* Keep the plugin explanation. */")
        expect(yield* fs.readFileString(target)).toContain("/* Keep the source explanation. */")
      }),
    ),
  )

  it.live("deletes own JSON keys that also exist on Object.prototype", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const target = path.join(tmp.path, "opencode.json")
        yield* fs.writeFileString(
          target,
          '{ "\\u005f_proto__": "remove", "constructor": "remove", "toString": "remove", "shell": "keep" }',
        )
        const updated = yield* ConfigFile.update(target, (draft) => {
          ;["__proto__", "constructor", "toString"].forEach((key) => {
            delete draft[key]
          })
        })

        expect(updated).toEqual({ shell: "keep" })
        expect(yield* fs.readJson(target)).toEqual(updated)
      }),
    ),
  )

  it.live("preserves and edits object-valued __proto__ source keys", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const target = path.join(tmp.path, "opencode.json")
        yield* fs.writeFileString(target, '{ "__proto__": { "value": "before" }, "shell": "keep" }')
        const updated = yield* ConfigFile.update(target, (draft) => {
          expect(Object.hasOwn(draft, "__proto__")).toBe(true)
          const entry: unknown = draft["__proto__"]
          if (!isRecord(entry)) throw new Error("Missing fixture entry")
          entry.value = "after"
        })

        expect(updated).toEqual({ ["__proto__"]: { value: "after" }, shell: "keep" })
        expect(yield* fs.readJson(target)).toEqual(updated)
        expect(Object.getPrototypeOf(updated)).toBe(Object.prototype)
      }),
    ),
  )

  it.live("rejects a duplicate-key patch that would not change the effective value", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const target = path.join(tmp.path, "opencode.json")
        const text = '{ "shell": "first", "shell": "second" }'
        yield* fs.writeFileString(target, text)
        const error = yield* ConfigFile.update(target, (draft) => {
          draft.shell = "after"
        }).pipe(Effect.flip)

        expect(error).toBeInstanceOf(ConfigFile.UpdateError)
        expect(error.message).toBe(`Config patch does not match the requested update: ${target}`)
        expect(yield* fs.readFileString(target)).toBe(text)
        expect(yield* fs.exists(target + ".tmp")).toBe(false)
      }),
    ),
  )

  it.live("rereads the selected file for consecutive edits without a watcher", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const target = path.join(tmp.path, "opencode.json")
        yield* fs.writeFileString(target, '{ "shell": "first" }')
        yield* ConfigFile.update(target, (draft) => {
          draft.shell = "second"
        })
        yield* ConfigFile.update(target, (draft) => {
          expect(draft.shell).toBe("second")
          draft.username = "added"
        })
        expect(yield* fs.readJson(target)).toEqual({ shell: "second", username: "added" })

        yield* fs.writeFileString(target, '{ "shell": "external", "username": "added" }')
        const updated = yield* ConfigFile.update(target, (draft) => {
          expect(draft.shell).toBe("external")
          draft.snapshots = false
        })
        expect(yield* fs.readJson(target)).toEqual(updated)
        expect(updated).toEqual({ shell: "external", username: "added", snapshots: false })
      }),
    ),
  )

  it.live("serializes concurrent read-modify-write calls", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const target = path.join(tmp.path, "opencode.json")
        yield* fs.writeFileString(target, '{ "count": 0 }')
        const increment = ConfigFile.update(target, (draft) => {
          if (typeof draft.count !== "number") throw new Error("Missing fixture count")
          draft.count++
        })
        yield* Effect.all([increment, increment, increment], { concurrency: "unbounded" })

        expect(yield* fs.readJson(target)).toEqual({ count: 3 })
      }),
    ),
  )

  it.live("does not rewrite no-op or structurally equal edits", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const target = path.join(tmp.path, "opencode.json")
        const text = '{\r\n  "plugins": ["first"]\r\n}'
        yield* fs.writeFileString(target, text)
        const before = yield* fs.stat(target)
        yield* ConfigFile.update(target, () => {})
        yield* ConfigFile.update(target, (draft) => {
          draft.plugins = ["first"]
        })

        expect(yield* fs.readFileString(target)).toBe(text)
        expect((yield* fs.stat(target)).ino).toEqual(before.ino)
        expect((yield* fs.stat(target)).mtime).toEqual(before.mtime)
        expect(yield* fs.exists(target + ".tmp")).toBe(false)
      }),
    ),
  )

  it.live("leaves the file unchanged when a callback throws and permits a later edit", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const target = path.join(tmp.path, "opencode.json")
        const text = '{ "shell": "before" }'
        yield* fs.writeFileString(target, text)
        const cause = new Error("Rejected config update")
        const error = yield* ConfigFile.update(target, (draft) => {
          draft.shell = "discarded"
          throw cause
        }).pipe(Effect.flip)

        expect(error).toBeInstanceOf(ConfigFile.UpdateError)
        expect(error.message).toBe("Config update failed")
        expect(error.cause).toBe(cause)
        expect(yield* fs.readFileString(target)).toBe(text)
        expect(yield* fs.exists(target + ".tmp")).toBe(false)

        yield* ConfigFile.update(target, (draft) => {
          draft.shell = "recovered"
        })
        expect(yield* fs.readJson(target)).toEqual({ shell: "recovered" })
      }),
    ),
  )

  it.live("ignores callback return values instead of replacing the document", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const target = path.join(tmp.path, "opencode.json")
        yield* fs.writeFileString(target, "{}")

        expect(yield* ConfigFile.update(target, () => new Date(0))).toEqual({})
        expect(yield* fs.readFileString(target)).toBe("{}")

        const updated = yield* ConfigFile.update(target, (draft) => (draft.shell = "updated"))
        expect(updated).toEqual({ shell: "updated" })
        expect(yield* fs.readJson(target)).toEqual(updated)
      }),
    ),
  )

  it.live("rejects non-JSON mutations before writing", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const target = path.join(tmp.path, "opencode.json")
        const text = '{ "shell": "before" }'
        yield* fs.writeFileString(target, text)
        const error = yield* ConfigFile.update(target, (draft) => {
          draft.invalid = Number.NaN
        }).pipe(Effect.flip)

        expect(error).toBeInstanceOf(ConfigFile.UpdateError)
        expect(error.message).toBe(`Config update must produce a JSON object: ${target}`)
        expect(yield* fs.readFileString(target)).toBe(text)
        expect(yield* fs.exists(target + ".tmp")).toBe(false)
      }),
    ),
  )
  ;["", "{", "[]", "null"].forEach((text) => {
    it.live(`rejects invalid or non-object source ${JSON.stringify(text)}`, () =>
      withTempDir((tmp) =>
        Effect.gen(function* () {
          const fs = yield* FSUtil.Service
          const target = path.join(tmp.path, "opencode.json")
          yield* fs.writeFileString(target, text)
          const error = yield* ConfigFile.update(target, () => {
            throw new Error("Callback must not run")
          }).pipe(Effect.flip)

          expect(error).toBeInstanceOf(ConfigFile.UpdateError)
          expect(error.message).toBe(`Invalid config file: ${target}`)
          expect(yield* fs.readFileString(target)).toBe(text)
          expect(yield* fs.exists(target + ".tmp")).toBe(false)
        }),
      ),
    )
  })

  it.live("reports a missing target without creating it", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const target = path.join(tmp.path, "missing.json")
        const error = yield* ConfigFile.update(target, () => {}).pipe(Effect.flip)

        expect(error).toBeInstanceOf(ConfigFile.UpdateError)
        expect(error.message).toBe(`Failed to read config: ${target}`)
        expect(error.cause).toBeDefined()
        expect(yield* fs.exists(target)).toBe(false)
      }),
    ),
  )

  it.live("reports write failures without replacing the target", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const target = path.join(tmp.path, "opencode.json")
        const text = '{ "shell": "before" }'
        yield* fs.writeFileString(target, text)
        yield* fs.makeDirectory(target + ".tmp")
        const error = yield* ConfigFile.update(target, (draft) => {
          draft.shell = "discarded"
        }).pipe(Effect.flip)

        expect(error).toBeInstanceOf(ConfigFile.UpdateError)
        expect(error.message).toBe(`Failed to write config: ${target}`)
        expect(error.cause).toBeDefined()
        expect(yield* fs.readFileString(target)).toBe(text)
      }),
    ),
  )
})
