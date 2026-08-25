#!/usr/bin/env bun

import { $ } from "bun"
import { rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"

process.chdir(fileURLToPath(new URL("..", import.meta.url)))

await rm("dist", { recursive: true, force: true })
await $`bun tsc -p tsconfig.build.json`
const files = await Array.fromAsync(new Bun.Glob("**/*.ts").scan({ cwd: "src" })).then((items) =>
  items.map((item) => `src/${item}`),
)
const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun" })
await Promise.all(
  files.map(async (file) =>
    Bun.write(
      file.replace(/^src\//, "dist/").replace(/\.ts$/, ".js"),
      await transpiler.transform(await Bun.file(file).text()),
    ),
  ),
)
