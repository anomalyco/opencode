import { describe, expect, test } from "bun:test"
import { resolveContinueListQuery, resolveRunDirectory, resolveRunFilePath } from "@/cli/cmd/run"

describe("run directory resolution", () => {
  test("local resumed sessions use the stored session directory", async () => {
    expect(
      await resolveRunDirectory({
        attach: false,
        directory: "/tmp/launch",
        explicitDirectory: false,
        root: "/tmp/launch",
        sessionDirectory: "/tmp/session",
        current: async () => "/tmp/current",
      }),
    ).toBe("/tmp/session")
  })

  test("local fresh sessions fall back to the launch directory", async () => {
    expect(
      await resolveRunDirectory({
        attach: false,
        directory: "/tmp/launch",
        explicitDirectory: false,
        root: "/tmp/root",
        sessionDirectory: undefined,
        current: async () => "/tmp/current",
      }),
    ).toBe("/tmp/launch")
  })

  test("local explicit directory keeps precedence over stored session directory", async () => {
    expect(
      await resolveRunDirectory({
        attach: false,
        directory: "/tmp/explicit",
        explicitDirectory: true,
        root: "/tmp/root",
        sessionDirectory: "/tmp/session",
        current: async () => "/tmp/current",
      }),
    ).toBe("/tmp/explicit")
  })

  test("attach mode keeps explicit directory precedence", async () => {
    expect(
      await resolveRunDirectory({
        attach: true,
        directory: "/tmp/explicit",
        explicitDirectory: true,
        root: "/tmp/root",
        sessionDirectory: "/tmp/session",
        current: async () => "/tmp/current",
      }),
    ).toBe("/tmp/explicit")
  })

  test("attach mode falls back to session directory when no directory is provided", async () => {
    expect(
      await resolveRunDirectory({
        attach: true,
        directory: undefined,
        explicitDirectory: false,
        root: "/tmp/root",
        sessionDirectory: "/tmp/session",
        current: async () => "/tmp/current",
      }),
    ).toBe("/tmp/session")
  })

  test("local relative files resolve from effective session cwd", () => {
    expect(
      resolveRunFilePath({
        attach: false,
        root: "/tmp/launch",
        cwd: "/tmp/session",
        filePath: "note.md",
      }),
    ).toBe("/tmp/session/note.md")
  })

  test("attach relative files keep local launch root semantics", () => {
    expect(
      resolveRunFilePath({
        attach: true,
        root: "/tmp/launch",
        cwd: "/tmp/session",
        filePath: "note.md",
      }),
    ).toBe("/tmp/launch/note.md")
  })

  test("local continue without explicit directory lists project-wide before rebinding", () => {
    expect(resolveContinueListQuery({ attach: false, explicitDirectory: false })).toEqual({ scope: "project" })
  })

  test("local continue with explicit directory keeps directory-scoped discovery", () => {
    expect(resolveContinueListQuery({ attach: false, explicitDirectory: true })).toBeUndefined()
  })

  test("attach continue keeps existing discovery behavior", () => {
    expect(resolveContinueListQuery({ attach: true, explicitDirectory: false })).toBeUndefined()
  })
})
