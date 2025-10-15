import { test, expect, beforeEach, afterEach } from "bun:test"
import { DynamicPrompt } from "../../src/session/dynamic-prompt"
import { mkdtemp, rm } from "fs/promises"
import path from "path"
import os from "os"

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "opencode-dynamic-prompt-test-"))
})

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
  }
})

const mockContext: DynamicPrompt.Context = {
  providerID: "anthropic",
  modelID: "claude-3-5-sonnet-20241022",
  directory: "/test/dir",
  worktree: "/test/worktree",
  isGitRepo: true,
  platform: "darwin",
  username: "testuser",
}

test("DynamicPrompt.resolve should return static prompts unchanged", async () => {
  const staticPrompt = "This is a static prompt"
  const result = await DynamicPrompt.resolve(staticPrompt, mockContext)
  expect(result).toBe(staticPrompt)
})

test("DynamicPrompt.resolve should read text files for non-TS/JS file:// paths", async () => {
  const textContent = "This is a text file content"
  const textFile = path.join(tempDir, "test.txt")
  await Bun.write(textFile, textContent)

  const result = await DynamicPrompt.resolve(`file://${textFile}`, mockContext)
  expect(result).toBe(textContent)
})

test("DynamicPrompt.resolve should execute TypeScript files with system export", async () => {
  const tsFile = path.join(tempDir, "test.ts")
  await Bun.write(
    tsFile,
    `
export function system(context: any): string {
  return \`Hello \${context.username} on \${context.platform}\`
}
`,
  )

  const result = await DynamicPrompt.resolve(`file://${tsFile}`, mockContext)
  expect(result).toBe("Hello testuser on darwin")
})

test("DynamicPrompt.resolve should execute JavaScript files with default export", async () => {
  const jsFile = path.join(tempDir, "test.js")
  await Bun.write(
    jsFile,
    `
export default function(context) {
  return \`Provider: \${context.providerID}, Model: \${context.modelID}\`
}
`,
  )

  const result = await DynamicPrompt.resolve(`file://${jsFile}`, mockContext)
  expect(result).toBe("Provider: anthropic, Model: claude-3-5-sonnet-20241022")
})

test("DynamicPrompt.resolve should handle async functions", async () => {
  const tsFile = path.join(tempDir, "async-test.ts")
  await Bun.write(
    tsFile,
    `
export async function system(context: any): Promise<string> {
  await new Promise(resolve => setTimeout(resolve, 1))
  return \`Async result for \${context.username}\`
}
`,
  )

  const result = await DynamicPrompt.resolve(`file://${tsFile}`, mockContext)
  expect(result).toBe("Async result for testuser")
})

test("DynamicPrompt.resolve should throw error for non-existent files", async () => {
  const nonExistentFile = path.join(tempDir, "non-existent.ts")

  await expect(DynamicPrompt.resolve(`file://${nonExistentFile}`, mockContext)).rejects.toThrow(
    "Failed to load dynamic prompt",
  )
})

test("DynamicPrompt.resolve should throw error when no function is exported", async () => {
  const tsFile = path.join(tempDir, "no-function.ts")
  await Bun.write(
    tsFile,
    `
export const notAFunction = "This is not a function"
`,
  )

  await expect(DynamicPrompt.resolve(`file://${tsFile}`, mockContext)).rejects.toThrow(
    'must export a "system" function or default function',
  )
})

test("DynamicPrompt.resolve should throw error when function returns non-string", async () => {
  const tsFile = path.join(tempDir, "wrong-return.ts")
  await Bun.write(
    tsFile,
    `
export function system() {
  return 123
}
`,
  )

  await expect(DynamicPrompt.resolve(`file://${tsFile}`, mockContext)).rejects.toThrow(
    "must return a string, got number",
  )
})

test("DynamicPrompt.resolve should handle .mjs files", async () => {
  const mjsFile = path.join(tempDir, "test.mjs")
  await Bun.write(
    mjsFile,
    `
export default function(context) {
  return \`MJS file for \${context.username}\`
}
`,
  )

  const result = await DynamicPrompt.resolve(`file://${mjsFile}`, mockContext)
  expect(result).toBe("MJS file for testuser")
})

test("DynamicPrompt.resolve should handle .mts files", async () => {
  const mtsFile = path.join(tempDir, "test.mts")
  await Bun.write(
    mtsFile,
    `
export function system(context: any): string {
  return \`MTS file for \${context.username}\`
}
`,
  )

  const result = await DynamicPrompt.resolve(`file://${mtsFile}`, mockContext)
  expect(result).toBe("MTS file for testuser")
})

test("DynamicPrompt.resolve should handle relative file paths", async () => {
  const tsFile = path.join(tempDir, "relative.ts")
  await Bun.write(
    tsFile,
    `
export function system(context: any): string {
  return \`Relative path test\`
}
`,
  )

  // Test with a context that has the tempDir as the directory
  const relativeContext = { ...mockContext, directory: tempDir }
  const result = await DynamicPrompt.resolve("file://relative.ts", relativeContext)
  expect(result).toBe("Relative path test")
})

test("DynamicPrompt.createContext should create proper context object", () => {
  const input = {
    providerID: "openai",
    modelID: "gpt-4",
    username: "customuser",
    directory: "/test/directory",
    worktree: "/test/worktree",
    isGitRepo: true,
  }

  const context = DynamicPrompt.createContext(input)

  expect(context.providerID).toBe("openai")
  expect(context.modelID).toBe("gpt-4")
  expect(context.username).toBe("customuser")
  expect(context.directory).toBe("/test/directory")
  expect(context.worktree).toBe("/test/worktree")
  expect(context.isGitRepo).toBe(true)
  expect(context.platform).toBe(process.platform)
})

test("DynamicPrompt.createContext should use default username when not provided", () => {
  const input = {
    providerID: "openai",
    modelID: "gpt-4",
    directory: "/test/directory",
    worktree: "/test/worktree",
    isGitRepo: false,
  }

  const context = DynamicPrompt.createContext(input)

  expect(context.username).toBe(os.userInfo().username)
})

test("DynamicPrompt.resolve should pass all context properties correctly", async () => {
  const tsFile = path.join(tempDir, "context-test.ts")
  await Bun.write(
    tsFile,
    `
export function system(context: any): string {
  return JSON.stringify({
    providerID: context.providerID,
    modelID: context.modelID,
    directory: context.directory,
    worktree: context.worktree,
    isGitRepo: context.isGitRepo,
    platform: context.platform,
    username: context.username,
  })
}
`,
  )

  const result = await DynamicPrompt.resolve(`file://${tsFile}`, mockContext)
  const parsed = JSON.parse(result)

  expect(parsed.providerID).toBe(mockContext.providerID)
  expect(parsed.modelID).toBe(mockContext.modelID)
  expect(parsed.directory).toBe(mockContext.directory)
  expect(parsed.worktree).toBe(mockContext.worktree)
  expect(parsed.isGitRepo).toBe(mockContext.isGitRepo)
  expect(parsed.platform).toBe(mockContext.platform)
  expect(parsed.username).toBe(mockContext.username)
})
