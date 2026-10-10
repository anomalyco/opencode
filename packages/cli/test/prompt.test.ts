import { expect, test } from "bun:test"
import { Effect } from "effect"
import { openUrl } from "../src/ui/prompt"

test("continues when the browser cannot be opened", async () => {
  await expect(Effect.runPromise(openUrl("file:///etc/hosts"))).resolves.toBeUndefined()
})
