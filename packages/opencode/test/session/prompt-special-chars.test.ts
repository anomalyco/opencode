import path from "path"
import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "url"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { AppRuntime } from "../../src/effect/app-runtime"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

function sessionCreate(input?: Session.CreateInput) {
  return AppRuntime.runPromise(Session.Service.use((svc) => svc.create(input)))
}

function sessionRemove(id: Session.Info["id"]) {
  return AppRuntime.runPromise(Session.Service.use((svc) => svc.remove(id)))
}

function resolvePromptParts(template: string) {
  return AppRuntime.runPromise(SessionPrompt.Service.use((svc) => svc.resolvePromptParts(template)))
}

function sessionPrompt(input: SessionPrompt.PromptInput) {
  return AppRuntime.runPromise(SessionPrompt.Service.use((svc) => svc.prompt(input)))
}

describe("session.prompt special characters", () => {
  test("handles filenames with # character", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "file#name.txt"), "special content\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await sessionCreate({})
        const template = "Read @file#name.txt"
        const parts = await resolvePromptParts(template)
        const fileParts = parts.filter((part) => part.type === "file")

        expect(fileParts.length).toBe(1)
        expect(fileParts[0].filename).toBe("file#name.txt")

        // Verify the URL is properly encoded (# should be %23)
        expect(fileParts[0].url).toContain("%23")

        // Verify the URL can be correctly converted back to a file path
        const decodedPath = fileURLToPath(fileParts[0].url)
        expect(decodedPath).toBe(path.join(tmp.path, "file#name.txt"))

        const message = await sessionPrompt({
          sessionID: session.id,
          parts,
          noReply: true,
        })

        // Verify the file content was read correctly from stored message parts
        const textParts = message.parts.filter((part) => part.type === "text")
        const hasContent = textParts.some((part) => part.text.includes("special content"))
        expect(hasContent).toBe(true)

        await sessionRemove(session.id)
      },
    })
  })
})
