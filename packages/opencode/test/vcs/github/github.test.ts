import { describe, test, expect } from "bun:test"
import {
  parseGitHubRemote,
  extractResponseText,
  formatPromptTooLargeError,
  GitHubProvider,
} from "../../../src/vcs/github/github"
import type { MessageV2 } from "../../../src/session/message-v2"

describe("GitHubProvider", () => {
  test("has backward compatibility exports", () => {
    // Verify key exports exist
    expect(typeof parseGitHubRemote).toBe("function")
    expect(typeof extractResponseText).toBe("function")
    expect(typeof formatPromptTooLargeError).toBe("function")
    expect(typeof GitHubProvider).toBe("function")
  })

  test("GitHubProvider class implements IVCSProvider interface", () => {
    // Verify the class can be instantiated
    const provider = new GitHubProvider({
      token: "test-token",
      owner: "test-owner",
      repo: "test-repo",
    })

    // Verify required properties
    expect(provider.name).toBe("github")

    // Verify required methods exist
    expect(typeof provider.parseWebhook).toBe("function")
    expect(typeof provider.getMR).toBe("function")
    expect(typeof provider.listMRs).toBe("function")
    expect(typeof provider.getMRChanges).toBe("function")
    expect(typeof provider.listMRNotes).toBe("function")
    expect(typeof provider.createMRNote).toBe("function")
    expect(typeof provider.listMRDiscussions).toBe("function")
    expect(typeof provider.createMRDiscussion).toBe("function")
    expect(typeof provider.getAuthToken).toBe("function")
  })

  test("parseGitHubRemote works correctly", () => {
    expect(parseGitHubRemote("https://github.com/owner/repo.git")).toEqual({
      owner: "owner",
      repo: "repo",
    })
    expect(parseGitHubRemote("git@github.com:owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    })
    expect(parseGitHubRemote("https://gitlab.com/owner/repo")).toBeNull()
  })

  test("extractResponseText works correctly", () => {
    const textParts = [
      { id: "1", sessionID: "s", messageID: "m", type: "text" as const, text: "Hello world" },
    ]
    expect(extractResponseText(textParts)).toBe("Hello world")

    const nonTextParts = [
      { id: "1", sessionID: "s", messageID: "m", type: "tool" as const, tool: "bash", state: { status: "completed" } },
    ]
    expect(extractResponseText(nonTextParts)).toBeNull()
  })

  test("formatPromptTooLargeError works correctly", () => {
    const result = formatPromptTooLargeError([
      { filename: "test.png", content: "a".repeat(400 * 1024) },
    ])

    expect(result).toStartWith("PROMPT_TOO_LARGE:")
    expect(result).toInclude("test.png")
    expect(result).toInclude("300") // KB (400 * 0.75)
  })
})
