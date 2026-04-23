import { describe, expect, test } from "bun:test"
import path from "node:path"
import { fileURLToPath } from "node:url"

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../e2e")

function hasPrompt(src: string) {
  if (!src.includes("withProject(")) return false
  if (src.includes("withNoReplyPrompt(")) return false
  if (src.includes("session.promptAsync({") && !src.includes("noReply: true")) return true
  if (!src.includes("promptSelector")) return false
  return src.includes('keyboard.press("Enter")') || src.includes('prompt.press("Enter")')
}

describe("e2e llm guard", () => {
  test("withProject specs do not submit prompt replies", async () => {
    const bad: string[] = []

    for await (const file of new Bun.Glob("**/*.spec.ts").scan({ cwd: dir, absolute: true })) {
      const src = await Bun.file(file).text()
      if (!hasPrompt(src)) continue
      bad.push(path.relative(dir, file))
    }

    expect(bad).toEqual([])
  })
})
