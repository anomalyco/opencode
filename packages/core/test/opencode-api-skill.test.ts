import { expect, test } from "bun:test"
import path from "node:path"
import { directory, render } from "../script/generate-api-skill"

test("the opencode skill's API reference matches openapi.json", async () => {
  const files = await render()
  // Bun.Glob yields native separators, so Windows lists `api\session.md` where render() keys `api/session.md`.
  const current = (await Array.fromAsync(new Bun.Glob("**/*.md").scan({ cwd: directory }))).map((file) =>
    file.split(path.sep).join("/"),
  )
  expect(current.toSorted()).toEqual(Object.keys(files).toSorted())
  for (const [file, content] of Object.entries(files)) {
    // Run `bun run generate` from packages/protocol (or `bun run generate:api-skill` from packages/core) when this fails.
    expect(await Bun.file(path.join(directory, file)).text()).toBe(content)
    // Keep individual group files small enough for progressive disclosure; split a group into a folder in SHOWN if it grows past 8 KB.
    if (file.startsWith("api/")) expect(Buffer.byteLength(content)).toBeLessThanOrEqual(8192)
  }
})
