import { test, expect } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { Config } from "../../src/config/config"
import { SessionPrompt } from "../../src/session/prompt"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import fs from "fs/promises"

// Access the internal resolveAgentPrompt function for testing
const { resolveAgentPrompt } = SessionPrompt._internal

test("resolveAgentPrompt processes basic template with bash commands", async () => {
  const template = "Current time: !`date`"
  const result = await resolveAgentPrompt(template)

  expect(result).toMatch(/Current time: \w+/)
  expect(result).not.toContain("!`date`")
})

test("resolveAgentPrompt processes template with multiple bash commands", async () => {
  const template = "User: !`whoami`, Directory: !`pwd`"
  const result = await resolveAgentPrompt(template)

  expect(result).not.toContain("!`whoami`")
  expect(result).not.toContain("!`pwd`")
  expect(result).toContain("User:")
  expect(result).toContain("Directory:")
})

test("resolveAgentPrompt handles bash command errors gracefully", async () => {
  const template = "This will fail: !`exit 1`"
  const result = await resolveAgentPrompt(template)

  // The command will still execute but return empty output for failed commands
  expect(result).toBe("This will fail: ")
})

test("resolveAgentPrompt loads content from file:// URL", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "test-prompt.txt"),
        "You are a test agent with dynamic content: !`echo hello world`",
      )
    },
  })

  const fileUrl = `file://${path.join(tmp.path, "test-prompt.txt")}`
  const result = await resolveAgentPrompt(fileUrl)

  expect(result).toContain("You are a test agent with dynamic content: hello world")
  expect(result).not.toContain("!`echo hello world`")
})

test("resolveAgentPrompt throws error for missing file:// URL", async () => {
  const fileUrl = "file:///nonexistent/path/to/file.txt"

  await expect(resolveAgentPrompt(fileUrl)).rejects.toThrow(/Failed to load agent prompt from file/)
})

test("resolveAgentPrompt returns template as-is when no processing needed", async () => {
  const template = "Static prompt with no dynamic content"
  const result = await resolveAgentPrompt(template)

  expect(result).toBe(template)
})

test("agent with templated prompt works in full system", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // Create a test script that outputs dynamic content
      const scriptPath = path.join(dir, "test-script.js")
      await Bun.write(scriptPath, 'console.log("Dynamic agent prompt from Node.js")')

      // Create agent config with templated prompt
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          agent: {
            test_agent: {
              prompt: `You are a helpful assistant. !\`node ${scriptPath}\``,
              model: "test/model",
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await Agent.get("test_agent")
      expect(agent).toBeDefined()
      expect(agent?.prompt).toContain("!`node")

      // Test that the prompt gets processed when the agent is used
      // This simulates how the prompt would be resolved in actual usage
      const resolvedPrompt = await resolveAgentPrompt(agent!.prompt!)
      expect(resolvedPrompt).toContain("You are a helpful assistant. Dynamic agent prompt from Node.js")
    },
  })
})

test("agent with file:// prompt works in full system", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // Create prompt file with template
      const promptPath = path.join(dir, "agent-prompt.md")
      await Bun.write(promptPath, "You are specialized in: !`echo TypeScript development`")

      // Create agent config with file:// URL
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          agent: {
            file_agent: {
              prompt: `file://${promptPath}`,
              model: "test/model",
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await Agent.get("file_agent")
      expect(agent).toBeDefined()
      expect(agent?.prompt).toStartWith("file://")

      // Test that both file loading and templating work together
      const resolvedPrompt = await resolveAgentPrompt(agent!.prompt!)
      expect(resolvedPrompt).toBe("You are specialized in: TypeScript development\n")
    },
  })
})

test("markdown agent file with templated content", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const opencodeDir = path.join(dir, ".opencode")
      await fs.mkdir(opencodeDir, { recursive: true })
      const agentDir = path.join(opencodeDir, "agent")
      await fs.mkdir(agentDir, { recursive: true })

      // Create markdown agent file with templated prompt
      await Bun.write(
        path.join(agentDir, "dynamic.md"),
        `---
model: test/model
---
You are a specialized agent. Current working directory: !\`pwd\``,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      const agent = config.agent?.["dynamic"]

      expect(agent).toBeDefined()
      expect(agent?.prompt).toContain("!`pwd`")

      // Test that the prompt gets templated
      const resolvedPrompt = await resolveAgentPrompt(agent!.prompt!)
      expect(resolvedPrompt).toContain("Current working directory:")
      expect(resolvedPrompt).not.toContain("!`pwd`")
      // The command runs in the current process directory, not the temp dir
    },
  })
})
