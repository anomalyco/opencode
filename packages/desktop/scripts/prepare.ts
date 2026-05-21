#!/usr/bin/env node
import { Script } from "@opencode-ai/script"
import { readFile, writeFile } from "node:fs/promises"

await import("./prebuild")

const pkg = JSON.parse(await readFile("./package.json", "utf-8"))
pkg.version = Script.version
await writeFile("./package.json", JSON.stringify(pkg, null, 2) + "\n")
console.log(`Updated package.json version to ${Script.version}`)
