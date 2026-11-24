import { expect, test } from "bun:test"
import path from "node:path"
import { directory, render } from "../script/generate-api-skill"

test("the opencode skill's API reference matches openapi.json", async () => {
  const files = await render()
  // Bun's glob yields native separators, so Windows lists `api\agent.md` where `render` names `api/agent.md`.
  const current = (await Array.fromAsync(new Bun.Glob("**/*.md").scan({ cwd: directory }))).map((file) =>
    file.replaceAll(path.sep, "/"),
  )
  expect(current.toSorted()).toEqual(Object.keys(files).toSorted())
  for (const [file, content] of Object.entries(files)) {
    // Run `bun run generate` from packages/protocol (or `bun run generate:api-skill` from packages/core) when this fails.
    expect(await Bun.file(path.join(directory, file)).text()).toBe(content)
  }
})
