import { test, expect, describe } from "bun:test"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import fs from "fs/promises"

/**
 * Test case designed to reproduce GitHub Issue #8868
 * https://github.com/anomalyco/opencode/issues/8868
 *
 * The user reports that agents and commands in `.opencode/agent/` and
 * `.opencode/command/` directories are not being loaded when:
 * - There's a top-level `opencode.json` with MCP config
 * - Agents/commands are `.md` files in `.opencode/{agent,command}/`
 *
 * Interestingly, renaming `opencode.json` to `opencode.jsonc` temporarily
 * makes them appear, suggesting a file-watcher or reload issue.
 */
describe("Issue #8868 - Agents and Commands not shown", () => {
  test("loads agents from .opencode/agent when opencode.json exists at project root", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        // Create top-level opencode.json (like the user has)
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            mcp: {
              "github-mcp-server": {
                type: "remote",
                url: "https://api.githubcopilot.com/mcp/",
              },
            },
          }),
        )

        // Create .opencode directory structure
        const opencodeDir = path.join(dir, ".opencode")
        await fs.mkdir(opencodeDir, { recursive: true })

        // Create agent directory with a test agent
        const agentDir = path.join(opencodeDir, "agent")
        await fs.mkdir(agentDir, { recursive: true })

        await Bun.write(
          path.join(agentDir, "test-orchestrator.md"),
          `---
model: github-copilot/gpt-4
mode: primary
description: Test orchestrator agent
---
You are a test orchestrator agent.`,
        )

        // Create command directory with a test command
        const commandDir = path.join(opencodeDir, "command")
        await fs.mkdir(commandDir, { recursive: true })

        await Bun.write(
          path.join(commandDir, "test-analyze.md"),
          `---
description: Test analyze command
---
Analyze the following: $ARGUMENTS`,
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()

        // Verify the agent was loaded from .opencode/agent/
        expect(config.agent?.["test-orchestrator"]).toBeDefined()
        expect(config.agent?.["test-orchestrator"]).toMatchObject({
          name: "test-orchestrator",
          mode: "primary",
          description: "Test orchestrator agent",
          prompt: "You are a test orchestrator agent.",
        })

        // Verify the command was loaded from .opencode/command/
        expect(config.command?.["test-analyze"]).toBeDefined()
        expect(config.command?.["test-analyze"]).toMatchObject({
          description: "Test analyze command",
          template: "Analyze the following: $ARGUMENTS",
        })
      },
    })
  })

  test("loads agents from .opencode/agent when opencode.jsonc exists at project root", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        // Create top-level opencode.jsonc (the workaround extension)
        await Bun.write(
          path.join(dir, "opencode.jsonc"),
          `{
  // This is the JSONC file that the user reports works temporarily
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "github-mcp-server": {
      "type": "remote",
      "url": "https://api.githubcopilot.com/mcp/"
    }
  }
}`,
        )

        // Create .opencode directory structure
        const opencodeDir = path.join(dir, ".opencode")
        await fs.mkdir(opencodeDir, { recursive: true })

        // Create agent directory with a test agent
        const agentDir = path.join(opencodeDir, "agent")
        await fs.mkdir(agentDir, { recursive: true })

        await Bun.write(
          path.join(agentDir, "jsonc-agent.md"),
          `---
model: test/model
mode: subagent
---
JSONC test agent prompt`,
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()

        // Verify the agent was loaded
        expect(config.agent?.["jsonc-agent"]).toBeDefined()
        expect(config.agent?.["jsonc-agent"]).toMatchObject({
          name: "jsonc-agent",
          mode: "subagent",
          prompt: "JSONC test agent prompt",
        })
      },
    })
  })

  test("loads agents with nested directory structure in .opencode/agents", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
          }),
        )

        const opencodeDir = path.join(dir, ".opencode")
        const agentsDir = path.join(opencodeDir, "agents")
        const nestedDir = path.join(agentsDir, "speckit")
        await fs.mkdir(nestedDir, { recursive: true })

        await Bun.write(
          path.join(nestedDir, "analyzer.md"),
          `---
mode: subagent
---
Nested analyzer agent`,
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()

        // The agent should be named with the nested path
        expect(config.agent?.["speckit/analyzer"]).toBeDefined()
        expect(config.agent?.["speckit/analyzer"]).toMatchObject({
          name: "speckit/analyzer",
          mode: "subagent",
          prompt: "Nested analyzer agent",
        })
      },
    })
  })
})
