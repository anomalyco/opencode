import { expect, test } from "bun:test"
import { Glob } from "bun"
import path from "node:path"

// Code Mode uses the language only through psychoscript's public Effect entry point.

test("Code Mode imports psychoscript only through psychoscript/effect", async () => {
  const src = path.join(import.meta.dir, "..", "src")
  const files = await Array.fromAsync(new Glob("**/*.ts").scan({ cwd: src }))
  const deep = (
    await Promise.all(
      files.map(async (file) =>
        [...(await Bun.file(path.join(src, file)).text()).matchAll(/"(psychoscript(?:\/(?!effect")[^"]*)?)"/g)].map(
          (match) => `${file} imports ${match[1]}`,
        ),
      ),
    )
  ).flat()
  expect(deep).toEqual([])
})
