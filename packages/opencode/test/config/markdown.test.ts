import { expect, test } from "bun:test"
import { ConfigMarkdown } from "../../src/config/markdown"

const template = `This is a @valid/path/to/a/file and it should also match at
the beginning of a line:

@another-valid/path/to/a/file

but this is not:

   - Adds a "Co-authored-by:" footer which clarifies which AI agent
     helped create this commit, using an appropriate \`noreply@...\`
     or \`noreply@anthropic.com\` email address.

We also need to deal with files followed by @commas, ones
with @file-extensions.md, even @multiple.extensions.bak,
hidden directorys like @.config/ or files like @.bashrc
and ones at the end of a sentence like @foo.md.

Also shouldn't forget @/absolute/paths.txt with and @/without/extensions,
as well as @~/home-files and @~/paths/under/home.txt.

If the reference is \`@quoted/in/backticks\` then it shouldn't match at all.`

const matches = ConfigMarkdown.files(template)

test("should extract exactly 12 file references", () => {
  expect(matches.length).toBe(12)
})

test("should extract valid/path/to/a/file", () => {
  expect(matches[0][1]).toBe("valid/path/to/a/file")
})

test("should extract another-valid/path/to/a/file", () => {
  expect(matches[1][1]).toBe("another-valid/path/to/a/file")
})

test("should extract paths ignoring comma after", () => {
  expect(matches[2][1]).toBe("commas")
})

test("should extract a path with a file extension and comma after", () => {
  expect(matches[3][1]).toBe("file-extensions.md")
})

test("should extract a path with multiple dots and comma after", () => {
  expect(matches[4][1]).toBe("multiple.extensions.bak")
})

test("should extract hidden directory", () => {
  expect(matches[5][1]).toBe(".config/")
})

test("should extract hidden file", () => {
  expect(matches[6][1]).toBe(".bashrc")
})

test("should extract a file ignoring period at end of sentence", () => {
  expect(matches[7][1]).toBe("foo.md")
})

test("should extract an absolute path with an extension", () => {
  expect(matches[8][1]).toBe("/absolute/paths.txt")
})

test("should extract an absolute path without an extension", () => {
  expect(matches[9][1]).toBe("/without/extensions")
})

test("should extract an absolute path in home directory", () => {
  expect(matches[10][1]).toBe("~/home-files")
})

test("should extract an absolute path under home directory", () => {
  expect(matches[11][1]).toBe("~/paths/under/home.txt")
})

test("should not match when preceded by backtick", () => {
  const backtickTest = "This `@should/not/match` should be ignored"
  const backtickMatches = ConfigMarkdown.files(backtickTest)
  expect(backtickMatches.length).toBe(0)
})

test("should not match email addresses", () => {
  const emailTest = "Contact user@example.com for help"
  const emailMatches = ConfigMarkdown.files(emailTest)
  expect(emailMatches.length).toBe(0)
})

// Helper function to reduce test code duplication
async function parseMarkdownWithEnv(markdown: string) {
  const tempFile = `/tmp/test-agent-${Date.now()}.md`
  await Bun.write(tempFile, markdown)
  try {
    return await ConfigMarkdown.parse(tempFile)
  } finally {
    await Bun.file(tempFile).delete()
  }
}

// Tests for {env:VAR} interpolation in frontmatter
test("should interpolate {env:VAR} in frontmatter", async () => {
  process.env.TEST_MODEL = "gpt-4"
  process.env.TEST_DESCRIPTION = "Test agent description"

  const markdownWithEnv = `---
description: "{env:TEST_DESCRIPTION}"
model: "{env:TEST_MODEL}"
mode: primary
---

# Agent Content

This is the agent content.`

  const result = await parseMarkdownWithEnv(markdownWithEnv)

  expect(result.data.description).toBe("Test agent description")
  expect(result.data.model).toBe("gpt-4")
  expect(result.data.mode).toBe("primary")
  expect(result.content).toContain("Agent Content")
})

test("should handle missing environment variables gracefully", async () => {
  delete process.env.NONEXISTENT_VAR

  const markdownWithMissingEnv = `---
description: "Description with {env:NONEXISTENT_VAR} missing"
model: "gpt-3.5-turbo"
---

# Agent Content`

  const result = await parseMarkdownWithEnv(markdownWithMissingEnv)

  expect(result.data.description).toBe("Description with  missing")
  expect(result.data.model).toBe("gpt-3.5-turbo")
})

test("should interpolate multiple environment variables in same field", async () => {
  process.env.PREFIX = "AI"
  process.env.SUFFIX = "Assistant"

  const markdownWithMultipleEnv = `---
description: "{env:PREFIX} {env:SUFFIX}"
model: "gpt-4"
---

# Agent Content`

  const result = await parseMarkdownWithEnv(markdownWithMultipleEnv)

  expect(result.data.description).toBe("AI Assistant")
  expect(result.data.model).toBe("gpt-4")
})

test("should not interpolate {env:VAR} in markdown body content", async () => {
  process.env.BODY_VAR = "should not appear"

  const markdownWithEnvInBody = `---
description: "Test agent"
model: "gpt-4"
---

# Agent Content

This should not interpolate: {env:BODY_VAR}`

  const result = await parseMarkdownWithEnv(markdownWithEnvInBody)

  expect(result.data.description).toBe("Test agent")
  expect(result.content).toContain("{env:BODY_VAR}")
})
