#!/usr/bin/env bun
import { $ } from "bun"
import { readdir, rm } from "node:fs/promises"

await rm("dist", { recursive: true, force: true })
await $`bunx tsc --emitDeclarationOnly`

const build = await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  target: "node",
  format: "esm",
  packages: "external",
})
if (!build.success) throw new AggregateError(build.logs, "Failed to build @opencode-ai/http-recorder")

const publicFiles = new Set(["index.js", "index.d.ts", "effect.d.ts", "socket.d.ts", "types.d.ts"])
await Promise.all(
  (await readdir("dist")).filter((file) => !publicFiles.has(file)).map((file) => rm(`dist/${file}`, { force: true })),
)
