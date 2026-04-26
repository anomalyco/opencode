import { afterEach, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { disposeAllInstances, provideInstance, testInstanceStoreLayer, tmpdir } from "../fixture/fixture"

const disable = process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS
const cfg = process.env.OPENCODE_CONFIG_DIR
const content = process.env.OPENCODE_CONFIG_CONTENT
const home = process.env.OPENCODE_TEST_HOME
process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS = "1"

const { Effect } = await import("effect")
const { MessageID, SessionID } = await import("../../src/session/schema")
const { ToolRegistry } = await import("../../src/tool/registry")

afterEach(async () => {
  if (disable === undefined) delete process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS
  else process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS = disable
  if (cfg === undefined) delete process.env.OPENCODE_CONFIG_DIR
  else process.env.OPENCODE_CONFIG_DIR = cfg
  if (content === undefined) delete process.env.OPENCODE_CONFIG_CONTENT
  else process.env.OPENCODE_CONFIG_CONTENT = content
  if (home === undefined) delete process.env.OPENCODE_TEST_HOME
  else process.env.OPENCODE_TEST_HOME = home
  await disposeAllInstances()
})

// Validates the OMO+superpowers coexistence pattern:
// A plugin captures ctx.skills during server(), then calls ctx.skills.all()
// LAZILY (via a tool execute) after plugin loading completes.
// Native skills must be visible in the lazy call.
test("plugin tool can lazily call ctx.skills.all() and see native skills", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // Create a native skill in the standard location
      const skill = path.join(dir, ".opencode", "skill", "test-native")
      await fs.mkdir(skill, { recursive: true })
      await Bun.write(
        path.join(skill, "SKILL.md"),
        ["---", "name: test-native", "description: A test native skill", "---", "", "# Test Native Skill", ""].join("\n"),
      )

      // Create a plugin that captures ctx.skills and exposes a tool
      // whose execute calls ctx.skills.all() lazily
      const plugin = path.join(dir, ".opencode", "plugin")
      await fs.mkdir(plugin, { recursive: true })
      const out = JSON.stringify(path.join(dir, "skills-result.json"))
      await Bun.write(
        path.join(plugin, "skill-reader.ts"),
        [
          'import { writeFileSync } from "fs"',
          "",
          "export default {",
          '  id: \"test.skill-reader\",',
          "  server: async (ctx) => {",
          "    // Capture ctx.skills — do NOT call all() during server()",
          "    const skills = ctx.skills",
          "    return {",
          "      tool: {",
          "        check_native_skills: {",
          '          description: \"Returns native skills found via ctx.skills.all()\",',
          "          args: {},",
          "          execute: async () => {",
          "            // LAZY call — runs after server() has returned",
          "            const all = await skills.all()",
          `            writeFileSync(${out}, JSON.stringify(all.map(s => s.name)))`,
          '            return all.map(s => s.name).join(\", \")',
          "          }",
          "        }",
          "      }",
          "    }",
          "  },",
          "}",
          "",
        ].join("\n"),
      )
    },
  })

  process.env.OPENCODE_TEST_HOME = tmp.path
  process.env.OPENCODE_CONFIG_DIR = path.join(tmp.path, ".config")
  delete process.env.OPENCODE_CONFIG_CONTENT
  await fs.mkdir(process.env.OPENCODE_CONFIG_DIR, { recursive: true })

  await Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* ToolRegistry.Service
      const tools = yield* svc.all()
      const tool = tools.find((t) => t.id === "check_native_skills")
      if (!tool) throw new Error("Plugin tool not found")
      yield* tool.execute(
        {},
        {
          sessionID: SessionID.make("ses_test"),
          messageID: MessageID.make("msg_test"),
          agent: "test",
          abort: new AbortController().signal,
          extra: {},
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )
    }).pipe(
      provideInstance(tmp.path),
      Effect.provide(testInstanceStoreLayer),
      Effect.provide(ToolRegistry.defaultLayer),
      Effect.provide(Ripgrep.defaultLayer),
    ),
  )

  const names = (await Bun.file(path.join(tmp.path, "skills-result.json")).json()) as string[]
  expect(names).toContain("test-native")
}, 30000)
