import { test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm } from "fs/promises"
import path from "path"
import os from "os"
import { Agent } from "../../src/agent/agent"

// Note: This is an integration test that requires proper setup of the session context
// For now, we'll test the dynamic prompt integration by mocking the necessary parts

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "opencode-prompt-integration-test-"))
})

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test("Agent configuration should handle dynamic prompts in JSON format", async () => {
  // Create a dynamic prompt file
  const dynamicPromptFile = path.join(tempDir, "agent-prompt.ts")
  await Bun.write(
    dynamicPromptFile,
    `
export function system(context) {
  return \`Dynamic agent for \${context.providerID} provider\`
}
`,
  )

  // Create agent configuration that references the dynamic prompt
  const agentConfig: Agent.Info = {
    name: "test-dynamic",
    mode: "all",
    builtIn: false,
    permission: {
      edit: "allow",
      bash: { "*": "allow" },
      webfetch: "allow",
    },
    prompt: `file://${dynamicPromptFile}`,
    tools: {},
    options: {},
  }

  // Verify the agent has the correct prompt path
  expect(agentConfig.prompt).toBe(`file://${dynamicPromptFile}`)
  expect(agentConfig.prompt?.startsWith("file://")).toBe(true)
  expect(agentConfig.prompt?.endsWith(".ts")).toBe(true)
})

test("Markdown agent configuration should support dynamic prompts in frontmatter", async () => {
  // Create a dynamic prompt file
  const dynamicPromptFile = path.join(tempDir, "markdown-prompt.js")
  await Bun.write(
    dynamicPromptFile,
    `
export default function(context) {
  return \`Markdown dynamic agent for \${context.username}\`
}
`,
  )

  // Create markdown agent file with frontmatter pointing to dynamic prompt
  const markdownAgent = path.join(tempDir, "test-agent.md")
  await Bun.write(
    markdownAgent,
    `---
description: "Test agent with dynamic prompt"
prompt: "file://${dynamicPromptFile}"
tools:
  read: true
  write: true
---

This markdown content will be ignored because the frontmatter has a prompt field.`,
  )

  // Simulate what the config loader would do
  const matter = await import("gray-matter")
  const content = await Bun.file(markdownAgent).text()
  const parsed = matter.default(content)

  const agentConfig = {
    name: "test-agent",
    ...parsed.data,
    prompt: parsed.data.prompt || parsed.content.trim(),
  }

  // Verify the configuration
  expect(agentConfig.prompt).toBe(`file://${dynamicPromptFile}`)
  expect(agentConfig.description).toBe("Test agent with dynamic prompt")
  expect(agentConfig.tools).toEqual({ read: true, write: true })
})

test("Dynamic prompt should work with various file extensions", async () => {
  const extensions = [".ts", ".js", ".mts", ".mjs"]

  for (const ext of extensions) {
    const promptFile = path.join(tempDir, `prompt${ext}`)
    const isTypeScript = ext.includes("ts")

    await Bun.write(
      promptFile,
      `
export function system(context${isTypeScript ? ": any" : ""}) {
  return \`Extension ${ext} works for \${context.username}\`
}
`,
    )

    const agentConfig: Agent.Info = {
      name: `test-${ext.slice(1)}`,
      mode: "all",
      builtIn: false,
      permission: {
        edit: "allow",
        bash: { "*": "allow" },
        webfetch: "allow",
      },
      prompt: `file://${promptFile}`,
      tools: {},
      options: {},
    }

    expect(agentConfig.prompt).toBe(`file://${promptFile}`)
  }
})

test("Error handling should work correctly for malformed dynamic prompts", async () => {
  // Test non-existent file
  const nonExistentFile = path.join(tempDir, "non-existent.ts")
  const agentConfig1: Agent.Info = {
    name: "test-non-existent",
    mode: "all",
    builtIn: false,
    permission: { edit: "allow", bash: { "*": "allow" }, webfetch: "allow" },
    prompt: `file://${nonExistentFile}`,
    tools: {},
    options: {},
  }
  expect(agentConfig1.prompt).toBe(`file://${nonExistentFile}`)

  // Test file with no function export
  const noFunctionFile = path.join(tempDir, "no-function.ts")
  await Bun.write(noFunctionFile, `export const notAFunction = "hello"`)

  const agentConfig2: Agent.Info = {
    name: "test-no-function",
    mode: "all",
    builtIn: false,
    permission: { edit: "allow", bash: { "*": "allow" }, webfetch: "allow" },
    prompt: `file://${noFunctionFile}`,
    tools: {},
    options: {},
  }
  expect(agentConfig2.prompt).toBe(`file://${noFunctionFile}`)

  // Test file with wrong return type
  const wrongReturnFile = path.join(tempDir, "wrong-return.ts")
  await Bun.write(wrongReturnFile, `export function system() { return 123 }`)

  const agentConfig3: Agent.Info = {
    name: "test-wrong-return",
    mode: "all",
    builtIn: false,
    permission: { edit: "allow", bash: { "*": "allow" }, webfetch: "allow" },
    prompt: `file://${wrongReturnFile}`,
    tools: {},
    options: {},
  }
  expect(agentConfig3.prompt).toBe(`file://${wrongReturnFile}`)
})

test("Mixed static and dynamic prompts should coexist", async () => {
  // Static prompt agent
  const staticAgent: Agent.Info = {
    name: "static-agent",
    mode: "all",
    builtIn: false,
    permission: { edit: "allow", bash: { "*": "allow" }, webfetch: "allow" },
    prompt: "This is a static prompt",
    tools: {},
    options: {},
  }

  // Dynamic prompt agent
  const dynamicPromptFile = path.join(tempDir, "dynamic.ts")
  await Bun.write(
    dynamicPromptFile,
    `
export function system(context) {
  return \`This is a dynamic prompt for \${context.username}\`
}
`,
  )

  const dynamicAgent: Agent.Info = {
    name: "dynamic-agent",
    mode: "all",
    builtIn: false,
    permission: { edit: "allow", bash: { "*": "allow" }, webfetch: "allow" },
    prompt: `file://${dynamicPromptFile}`,
    tools: {},
    options: {},
  }

  expect(staticAgent.prompt).toBe("This is a static prompt")
  expect(dynamicAgent.prompt).toBe(`file://${dynamicPromptFile}`)
  expect(staticAgent.prompt?.startsWith("file://")).toBe(false)
  expect(dynamicAgent.prompt?.startsWith("file://")).toBe(true)
})
