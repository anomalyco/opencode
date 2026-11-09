import { expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { openUrl } from "../src/ui/prompt"

test("suppresses browser open failures so the printed URL stays usable", async () => {
  const exit = await Effect.runPromiseExit(openUrl("not-a-browser-url"))
  expect(Exit.isSuccess(exit)).toBe(true)
})
