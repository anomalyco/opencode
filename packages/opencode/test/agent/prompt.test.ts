import { test, expect } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { Config } from "../../src/config/config"
import { SessionPrompt } from "../../src/session/prompt"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import fs from "fs/promises"
import os from "os"

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

test("resolveAgentPrompt processes file references with @file/path", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "context.txt"), "Important context information")
      await Bun.write(path.join(dir, "rules.md"), "# Rules\n1. Be helpful\n2. Be accurate")
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const template = "You are an agent with context: @context.txt and rules: @rules.md"
      const result = await resolveAgentPrompt(template)

      expect(result).toContain("Important context information")
      expect(result).toContain("# Rules")
      expect(result).toContain("1. Be helpful")
      expect(result).not.toContain("@context.txt")
      expect(result).not.toContain("@rules.md")
    },
  })
})

test("resolveAgentPrompt handles missing file references gracefully", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const template = "You are an agent with missing context: @nonexistent.txt"
      const result = await resolveAgentPrompt(template)

      expect(result).toContain("Error reading file nonexistent.txt")
      expect(result).not.toContain("@nonexistent.txt")
    },
  })
})

test("resolveAgentPrompt processes directory references", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const subdir = path.join(dir, "docs")
      await fs.mkdir(subdir)
      await Bun.write(path.join(subdir, "readme.md"), "README content")
      await Bun.write(path.join(subdir, "guide.md"), "Guide content")
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const template = "Available documentation: @docs"
      const result = await resolveAgentPrompt(template)

      expect(result).toContain("Directory contents of docs:")
      expect(result).toContain("- readme.md")
      expect(result).toContain("- guide.md")
      expect(result).not.toContain("@docs")
    },
  })
})

test("resolveAgentPrompt combines shell and file templating", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "version.txt"), "v1.0.0")
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const template = "System info - User: !\`whoami\`, Version: @version.txt, Time: !\`date +%Y\`"
      const result = await resolveAgentPrompt(template)

      expect(result).toContain("System info - User:")
      expect(result).toContain("Version: v1.0.0")
      expect(result).toContain("Time:")
      expect(result).not.toContain("!`whoami`")
      expect(result).not.toContain("@version.txt")
      expect(result).not.toContain("!`date +%Y`")
    },
  })
})

test("resolveAgentPrompt handles tilde paths in file references", async () => {
  await using tmp = await tmpdir()

  const homeDir = os.homedir()
  const testFile = path.join(homeDir, ".test-opencode-file")

  // Create a test file in home directory
  await Bun.write(testFile, "Home directory content")

  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const template = "Content from home: @~/.test-opencode-file"
        const result = await resolveAgentPrompt(template)

        expect(result).toContain("Home directory content")
        expect(result).not.toContain("@~/.test-opencode-file")
      },
    })
  } finally {
    // Clean up test file
    await fs.unlink(testFile).catch(() => {})
  }
})

test("agent with combined templating works in full system", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // Create context file
      await Bun.write(path.join(dir, "agent-context.md"), "# Agent Context\nSpecialized for TypeScript")

      // Create agent config with both shell and file templating
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          agent: {
            combined_agent: {
              prompt: `You are an assistant. Context: @agent-context.md. Current user: !\`whoami\``,
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
      const agent = await Agent.get("combined_agent")
      expect(agent).toBeDefined()
      expect(agent?.prompt).toContain("@agent-context.md")
      expect(agent?.prompt).toContain("!`whoami`")

      // Test that both templating types work together
      const resolvedPrompt = await resolveAgentPrompt(agent!.prompt!)
      expect(resolvedPrompt).toContain("# Agent Context")
      expect(resolvedPrompt).toContain("Specialized for TypeScript")
      expect(resolvedPrompt).toContain("Current user:")
      expect(resolvedPrompt).not.toContain("@agent-context.md")
      expect(resolvedPrompt).not.toContain("!`whoami`")
    },
  })
})
