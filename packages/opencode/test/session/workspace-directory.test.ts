import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Session } from "../../src/session"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("session.addWorkspaceDirectory", () => {
  test("adds external directory permission for session", async () => {
    await using outside = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "docs"), { recursive: true })
      },
    })
    await using project = await tmpdir({ git: true })

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const session = await Session.create({})
        const directory = path.join(outside.path, "docs")
        const real = await fs.realpath(directory)
        const result = await Session.addWorkspaceDirectory({
          sessionID: session.id,
          path: directory,
        })

        expect(result.added).toBe(true)
        expect(result.directory).toBe(real)
        expect(result.glob).toBe(path.join(real, "*"))
        expect(result.session.permission?.some((rule) => rule.permission === "external_directory")).toBe(true)
      },
    })
  })

  test("expands tilde path", async () => {
    await using home = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "workspace"), { recursive: true })
      },
    })
    await using project = await tmpdir({ git: true })

    const prior = process.env.HOME
    process.env.HOME = home.path

    try {
      await Instance.provide({
        directory: project.path,
        fn: async () => {
          const session = await Session.create({})
          const result = await Session.addWorkspaceDirectory({
            sessionID: session.id,
            path: "~/workspace",
          })

          expect(result.added).toBe(true)
          expect(result.directory).toBe(path.join(home.path, "workspace"))
        },
      })
    } finally {
      process.env.HOME = prior
    }
  })

  test("returns added=false when directory already exists", async () => {
    await using outside = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "outside"), { recursive: true })
      },
    })
    await using project = await tmpdir({ git: true })

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const session = await Session.create({})
        const target = path.join(outside.path, "outside")

        await Session.addWorkspaceDirectory({
          sessionID: session.id,
          path: target,
        })
        const result = await Session.addWorkspaceDirectory({
          sessionID: session.id,
          path: target,
        })

        expect(result.added).toBe(false)
      },
    })
  })

  test("rejects missing directory", async () => {
    await using project = await tmpdir({ git: true })

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const session = await Session.create({})
        await expect(
          Session.addWorkspaceDirectory({
            sessionID: session.id,
            path: path.join(project.path, "missing-dir"),
          }),
        ).rejects.toThrow("Directory not found")
      },
    })
  })

  test("rejects file path", async () => {
    await using project = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "file.txt"), "hello")
      },
    })

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const session = await Session.create({})
        await expect(
          Session.addWorkspaceDirectory({
            sessionID: session.id,
            path: path.join(project.path, "file.txt"),
          }),
        ).rejects.toThrow("Path is not a directory")
      },
    })
  })

  test("canonicalizes symlinked directories", async () => {
    await using outside = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "target"), { recursive: true })
        await fs.symlink(path.join(dir, "target"), path.join(dir, "link"))
      },
    })
    await using project = await tmpdir({ git: true })

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const session = await Session.create({})
        const link = path.join(outside.path, "link")
        const target = path.join(outside.path, "target")
        const real = await fs.realpath(target)

        const first = await Session.addWorkspaceDirectory({
          sessionID: session.id,
          path: link,
        })
        const second = await Session.addWorkspaceDirectory({
          sessionID: session.id,
          path: target,
        })

        expect(first.added).toBe(true)
        expect(first.directory).toBe(real)
        expect(second.added).toBe(false)
      },
    })
  })
})
