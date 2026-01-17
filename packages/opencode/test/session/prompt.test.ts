import { $ } from "bun"
import { describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

// Helper to create a git-initialized tmpdir with local git config
async function tmpdirWithGit<T>(options?: { init?: (dir: string) => Promise<T> }) {
  const tmp = await tmpdir({ init: options?.init })
  await $`git init`.cwd(tmp.path).quiet()
  await $`git config user.email "test@test.com"`.cwd(tmp.path).quiet()
  await $`git config user.name "Test"`.cwd(tmp.path).quiet()
  await $`git commit --allow-empty -m "root"`.cwd(tmp.path).quiet()
  return tmp
}

describe("session.prompt file parts", () => {
  test("handles missing file reference gracefully", async () => {
    await using tmp = await tmpdirWithGit()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const missingFile = path.join(tmp.path, "deleted-file.txt")

        const message = await SessionPrompt.prompt({
          sessionID: session.id,
          parts: [
            {
              type: "file",
              mime: "text/plain",
              filename: "deleted-file.txt",
              url: pathToFileURL(missingFile).href,
            },
          ],
          noReply: true,
        })

        // message is { info, parts } - check the parts directly
        const textPart = message.parts.find((p) => p.type === "text" && p.text?.includes("not found"))

        expect(textPart).toBeDefined()
        expect(textPart?.text).toContain("File not found")
        expect(textPart?.text).toContain("deleted-file.txt")

        await Session.remove(session.id)
      },
    })
  })

  test("handles missing image file reference gracefully", async () => {
    await using tmp = await tmpdirWithGit()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const missingImage = path.join(tmp.path, "deleted-image.png")

        const message = await SessionPrompt.prompt({
          sessionID: session.id,
          parts: [
            {
              type: "file",
              mime: "image/png",
              filename: "deleted-image.png",
              url: pathToFileURL(missingImage).href,
            },
          ],
          noReply: true,
        })

        // message is { info, parts } - check the parts directly
        const textPart = message.parts.find((p) => p.type === "text" && p.text?.includes("not found"))

        expect(textPart).toBeDefined()
        expect(textPart?.text).toContain("File not found")
        expect(textPart?.text).toContain("deleted-image.png")

        await Session.remove(session.id)
      },
    })
  })

  test("processes existing file reference successfully", async () => {
    await using tmp = await tmpdirWithGit({
      init: async (dir) => {
        await Bun.write(path.join(dir, "existing-file.txt"), "hello world")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const existingFile = path.join(tmp.path, "existing-file.txt")

        const message = await SessionPrompt.prompt({
          sessionID: session.id,
          parts: [
            {
              type: "file",
              mime: "text/plain",
              filename: "existing-file.txt",
              url: pathToFileURL(existingFile).href,
            },
          ],
          noReply: true,
        })

        // message is { info, parts } - check the parts directly
        const contentPart = message.parts.find((p) => p.type === "text" && p.text?.includes("hello world"))

        expect(contentPart).toBeDefined()

        await Session.remove(session.id)
      },
    })
  })
})
