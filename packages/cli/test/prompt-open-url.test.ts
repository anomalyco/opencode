import { expect, test } from "bun:test"
import { Effect } from "effect"
import { openUrl } from "../src/ui/prompt"

test("openUrl swallows browser launch failures", async () => {
  // Non-http links make the opener reject, the same way a missing xdg-open does.
  await expect(Effect.runPromise(openUrl("file:///does-not-matter"))).resolves.toBeUndefined()
})
