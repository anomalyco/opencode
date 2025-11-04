#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "./package.json"
import { Script } from "@opencode-ai/script"

const binaries: Record<string, string> = {}
const platforms = [
  "darwin-arm64",
  "darwin-x64",
  "darwin-x64-baseline",
  "linux-arm64",
  "linux-x64",
  "linux-x64-baseline",
  "windows-x64",
]

// Use the version from the already-published platform packages
const platformVersion = "0.0.0-dev-codesurf-202511042145"

for (const platform of platforms) {
  binaries[`${pkg.name}-ai-${platform}`] = platformVersion
}

await $`mkdir -p ./dist/${pkg.name}`
await $`cp -r ./bin ./dist/${pkg.name}/bin`
await $`cp ./script/preinstall.mjs ./dist/${pkg.name}/preinstall.mjs`
await $`cp ./script/postinstall.mjs ./dist/${pkg.name}/postinstall.mjs`
await $`cp ./README.md ./dist/${pkg.name}/README.md`

await Bun.file(`./dist/${pkg.name}/package.json`).write(
  JSON.stringify(
    {
      name: pkg.name + "-ai",
      description: "CodeSurf - AI-powered code analysis and exploration tool. Built on OpenCode.",
      keywords: ["ai", "code", "analysis", "codesurf", "opencode", "coding-assistant"],
      repository: {
        type: "git",
        url: "https://github.com/sst/opencode",
      },
      bin: {
        [pkg.name]: `./bin/${pkg.name}`,
        surf: `./bin/surf`,
      },
      scripts: {
        preinstall: "bun ./preinstall.mjs || node ./preinstall.mjs",
        postinstall: "bun ./postinstall.mjs || node ./postinstall.mjs",
      },
      version: platformVersion,
      optionalDependencies: binaries,
    },
    null,
    2,
  ),
)

console.log("Main package created at dist/" + pkg.name)
console.log("Optional dependencies:", binaries)
