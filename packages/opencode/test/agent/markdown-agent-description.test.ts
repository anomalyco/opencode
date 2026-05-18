/**
 * Regression test for issue #27831:
 * Custom markdown-defined subagents show "should only be called manually"
 * in the Task tool description despite having a `description` field in
 * their YAML frontmatter.
 *
 * The propagation chain under test:
 *  1. config/agent.ts:load()  — ConfigMarkdown.parse() extracts frontmatter.description
 *  2. config/config.ts        — mergeDeep merges markdown agents into cfg.agent
 *  3. agent/agent.ts          — item.description = value.description ?? item.description
 *  4. tool/registry.ts        — describeTask() renders item.description
 */

import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Plugin } from "../../src/plugin"
import { Provider } from "../../src/provider/provider"
import { Skill } from "../../src/skill"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const agentLayer = (flags: Partial<RuntimeFlags.Info> = {}) =>
  Agent.layer.pipe(
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Auth.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Skill.defaultLayer),
    Layer.provide(RuntimeFlags.layer(flags)),
  )

const it = testEffect(agentLayer())

afterEach(async () => {
  await disposeAllInstances()
})

describe("markdown agent description propagation (#27831)", () => {
  it.instance(
    "markdown agent frontmatter description appears in Agent.list()",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        // Write a markdown agent file in .opencode/agents/
        const agentDir = path.join(test.directory, ".opencode", "agents")
        yield* Effect.promise(() =>
          Bun.write(
            path.join(agentDir, "my-helper.md"),
            `---
description: Searches the codebase for relevant context
mode: subagent
---

You are a helpful assistant that searches code.
`,
          ),
        )

        const agents = yield* Agent.Service.use((svc) => svc.list())
        const myHelper = agents.find((a) => a.name === "my-helper")

        expect(myHelper).toBeDefined()
        expect(myHelper?.description).toBe("Searches the codebase for relevant context")
        expect(myHelper?.mode).toBe("subagent")
        expect(myHelper?.prompt).toBe("You are a helpful assistant that searches code.")
      }),
    { git: true },
  )

  it.instance(
    "markdown agent description is not overridden by fallback text in describeTask()",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const agentDir = path.join(test.directory, ".opencode", "agents")
        yield* Effect.promise(() =>
          Bun.write(
            path.join(agentDir, "code-reviewer.md"),
            `---
description: Reviews code for quality and correctness
mode: subagent
---

You review code carefully.
`,
          ),
        )

        const agents = yield* Agent.Service.use((svc) => svc.list())
        const reviewer = agents.find((a) => a.name === "code-reviewer")

        expect(reviewer).toBeDefined()
        // The description must come from frontmatter, not the fallback
        expect(reviewer?.description).toBe("Reviews code for quality and correctness")
        expect(reviewer?.description).not.toBe("This subagent should only be called manually by the user.")
      }),
    { git: true },
  )

  it.instance(
    "markdown agent without description field still loads correctly",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const agentDir = path.join(test.directory, ".opencode", "agents")
        yield* Effect.promise(() =>
          Bun.write(
            path.join(agentDir, "no-desc-agent.md"),
            `---
mode: subagent
---

Just an agent with no description.
`,
          ),
        )

        const agents = yield* Agent.Service.use((svc) => svc.list())
        const agent = agents.find((a) => a.name === "no-desc-agent")

        expect(agent).toBeDefined()
        // No description in frontmatter → description is undefined (fallback text applies in describeTask)
        expect(agent?.description).toBeUndefined()
      }),
    { git: true },
  )

  it.instance(
    "markdown agent description with colon in value is preserved",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const agentDir = path.join(test.directory, ".opencode", "agents")
        yield* Effect.promise(() =>
          Bun.write(
            path.join(agentDir, "colon-agent.md"),
            `---
description: "Searches for relevant context: files, symbols, patterns"
mode: subagent
---

You search code.
`,
          ),
        )

        const agents = yield* Agent.Service.use((svc) => svc.list())
        const agent = agents.find((a) => a.name === "colon-agent")

        expect(agent).toBeDefined()
        expect(agent?.description).toBe("Searches for relevant context: files, symbols, patterns")
      }),
    { git: true },
  )
})
