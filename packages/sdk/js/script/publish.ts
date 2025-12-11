#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { $ } from "bun"

import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

await import("./build")

const pkg = await import("../package.json").then((m) => m.default)
const original = JSON.parse(JSON.stringify(pkg))
// exports are already in correct format with import/types pointing to dist
await Bun.write("package.json", JSON.stringify(pkg, null, 2))
await $`npm pack`
// Windows doesn't expand *.tgz, use explicit filename
const tgzName = `${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}.tgz`
await $`npm publish ${tgzName} --tag ${Script.channel} --access public`
await Bun.write("package.json", JSON.stringify(original, null, 2))
