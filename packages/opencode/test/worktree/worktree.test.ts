import { describe, test, expect } from "bun:test"
import z from "zod"
import { Worktree } from "../../src/worktree"

describe("Worktree", () => {
  describe("Info schema", () => {
    test("validates correct worktree info", () => {
      const result = Worktree.Info.safeParse({
        name: "brave-falcon",
        branch: "opencode/brave-falcon",
        directory: "/tmp/worktrees/brave-falcon",
      })
      expect(result.success).toBe(true)
    })

    test("rejects missing name", () => {
      const result = Worktree.Info.safeParse({
        branch: "opencode/test",
        directory: "/tmp/test",
      })
      expect(result.success).toBe(false)
    })

    test("rejects missing branch", () => {
      const result = Worktree.Info.safeParse({
        name: "test",
        directory: "/tmp/test",
      })
      expect(result.success).toBe(false)
    })

    test("rejects missing directory", () => {
      const result = Worktree.Info.safeParse({
        name: "test",
        branch: "opencode/test",
      })
      expect(result.success).toBe(false)
    })

    test("accepts any string values for fields", () => {
      const result = Worktree.Info.safeParse({
        name: "",
        branch: "",
        directory: "",
      })
      expect(result.success).toBe(true)
    })
  })

  describe("CreateInput schema", () => {
    test("accepts empty object (all fields optional)", () => {
      const result = Worktree.CreateInput.safeParse({})
      expect(result.success).toBe(true)
    })

    test("accepts name field", () => {
      const result = Worktree.CreateInput.safeParse({
        name: "my-worktree",
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.name).toBe("my-worktree")
      }
    })

    test("accepts startCommand field", () => {
      const result = Worktree.CreateInput.safeParse({
        startCommand: "npm install",
      })
      expect(result.success).toBe(true)
    })

    test("accepts both name and startCommand", () => {
      const result = Worktree.CreateInput.safeParse({
        name: "feature-x",
        startCommand: "pnpm install && pnpm build",
      })
      expect(result.success).toBe(true)
    })

    test("accepts undefined input", () => {
      const result = Worktree.CreateInput.optional().safeParse(undefined)
      expect(result.success).toBe(true)
    })
  })

  describe("RemoveInput schema", () => {
    test("validates correct remove input", () => {
      const result = Worktree.RemoveInput.safeParse({
        directory: "/tmp/worktrees/test",
      })
      expect(result.success).toBe(true)
    })

    test("rejects missing directory", () => {
      const result = Worktree.RemoveInput.safeParse({})
      expect(result.success).toBe(false)
    })
  })

  describe("ResetInput schema", () => {
    test("validates correct reset input", () => {
      const result = Worktree.ResetInput.safeParse({
        directory: "/tmp/worktrees/test",
      })
      expect(result.success).toBe(true)
    })

    test("rejects missing directory", () => {
      const result = Worktree.ResetInput.safeParse({})
      expect(result.success).toBe(false)
    })
  })

  describe("Error types", () => {
    test("NotGitError can be instantiated", () => {
      const error = new Worktree.NotGitError({
        message: "Not a git repo",
      })
      expect(error).toBeInstanceOf(Error)
      expect(error.name).toBe("WorktreeNotGitError")
      expect(error.data.message).toBe("Not a git repo")
    })

    test("NameGenerationFailedError can be instantiated", () => {
      const error = new Worktree.NameGenerationFailedError({
        message: "Could not generate unique name",
      })
      expect(error).toBeInstanceOf(Error)
      expect(error.name).toBe("WorktreeNameGenerationFailedError")
    })

    test("CreateFailedError can be instantiated", () => {
      const error = new Worktree.CreateFailedError({
        message: "git worktree add failed",
      })
      expect(error).toBeInstanceOf(Error)
      expect(error.name).toBe("WorktreeCreateFailedError")
    })

    test("RemoveFailedError can be instantiated", () => {
      const error = new Worktree.RemoveFailedError({
        message: "git worktree remove failed",
      })
      expect(error).toBeInstanceOf(Error)
      expect(error.name).toBe("WorktreeRemoveFailedError")
    })

    test("ResetFailedError can be instantiated", () => {
      const error = new Worktree.ResetFailedError({
        message: "reset failed",
      })
      expect(error).toBeInstanceOf(Error)
      expect(error.name).toBe("WorktreeResetFailedError")
    })

    test("StartCommandFailedError can be instantiated", () => {
      const error = new Worktree.StartCommandFailedError({
        message: "npm install failed",
      })
      expect(error).toBeInstanceOf(Error)
      expect(error.name).toBe("WorktreeStartCommandFailedError")
    })
  })

  describe("Event definitions", () => {
    test("Ready event has correct type", () => {
      expect(Worktree.Event.Ready.type).toBe("worktree.ready")
    })

    test("Failed event has correct type", () => {
      expect(Worktree.Event.Failed.type).toBe("worktree.failed")
    })

    test("Ready event validates properties", () => {
      const result = Worktree.Event.Ready.properties.safeParse({
        name: "brave-falcon",
        branch: "opencode/brave-falcon",
      })
      expect(result.success).toBe(true)
    })

    test("Failed event validates properties", () => {
      const result = Worktree.Event.Failed.properties.safeParse({
        message: "Something went wrong",
      })
      expect(result.success).toBe(true)
    })

    test("Ready event rejects missing properties", () => {
      const result = Worktree.Event.Ready.properties.safeParse({})
      expect(result.success).toBe(false)
    })
  })

  describe("slug pattern (internal logic test via schema)", () => {
    // Testing the slug generation pattern used internally
    test("slug converts spaces to dashes", () => {
      const slug = (input: string) =>
        input
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+/, "")
          .replace(/-+$/, "")
      expect(slug("Hello World")).toBe("hello-world")
    })

    test("slug handles special characters", () => {
      const slug = (input: string) =>
        input
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+/, "")
          .replace(/-+$/, "")
      expect(slug("Feature/ABC-123")).toBe("feature-abc-123")
    })

    test("slug trims leading and trailing dashes", () => {
      const slug = (input: string) =>
        input
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+/, "")
          .replace(/-+$/, "")
      expect(slug("--hello--")).toBe("hello")
    })

    test("slug lowercases input", () => {
      const slug = (input: string) =>
        input
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+/, "")
          .replace(/-+$/, "")
      expect(slug("MyFeature")).toBe("myfeature")
    })

    test("slug handles empty string", () => {
      const slug = (input: string) =>
        input
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+/, "")
          .replace(/-+$/, "")
      expect(slug("")).toBe("")
    })
  })
})
