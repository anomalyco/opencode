#!/usr/bin/env bun

import { $ } from "bun"
import { fileURLToPath } from "url"
import path from "path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

console.log("building enterprise...")
await $`bun run build`
console.log("enterprise build complete")
