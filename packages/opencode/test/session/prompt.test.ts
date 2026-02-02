import path from "path"
import { describe, expect, test } from "bun:test"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageV2 } from "../../src/session/message-v2"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("SessionPrompt ordering", () => {
  test("keeps @file order with read output parts", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "a.txt"), "28\n")
        await Bun.write(path.join(dir, "b.txt"), "42\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const template = "What numbers are written in files @a.txt and @b.txt ?"
        const parts = await SessionPrompt.resolvePromptParts(template)
        const fileParts = parts.filter((part) => part.type === "file")

        expect(fileParts.map((part) => part.filename)).toStrictEqual(["a.txt", "b.txt"])

        const message = await SessionPrompt.prompt({
          sessionID: session.id,
          parts,
          noReply: true,
        })
        const stored = await MessageV2.get({ sessionID: session.id, messageID: message.info.id })
        const items = stored.parts
        const aPath = path.join(tmp.path, "a.txt")
        const bPath = path.join(tmp.path, "b.txt")
        const sequence = items.flatMap((part) => {
          if (part.type === "text") {
            if (part.text.includes(aPath)) return ["input:a"]
            if (part.text.includes(bPath)) return ["input:b"]
            if (part.text.includes("00001| 28")) return ["output:a"]
            if (part.text.includes("00001| 42")) return ["output:b"]
            return []
          }
          if (part.type === "file") {
            if (part.filename === "a.txt") return ["file:a"]
            if (part.filename === "b.txt") return ["file:b"]
          }
          return []
        })

        expect(sequence).toStrictEqual(["input:a", "output:a", "file:a", "input:b", "output:b", "file:b"])

        await Session.remove(session.id)
      },
    })
  })
})
