#!/usr/bin/env bun

import { $ } from "bun"
import { fileURLToPath } from "node:url"

process.chdir(fileURLToPath(new URL("..", import.meta.url)))

await $`rm -rf dist`
await $`bun tsc -p tsconfig.build.json`
await $`bun build src/lua-sandbox.ts --format=esm --target=node --outfile=dist/lua-sandbox.js`
await Bun.write("dist/lua-sandbox.d.ts", Bun.file("lua/sandbox.d.ts"))
await Bun.write("dist/LICENSE.luaparse", Bun.file("node_modules/luaparse/LICENSE"))
