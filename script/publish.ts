#!/usr/bin/env bun

import { $ } from "bun"
import prompts from "prompts"

const env = await prompts({
  type: "select",
  name: "value",
  message: "Select environment:",
  choices: [
    { title: "Production", value: "production" },
    { title: "Snapshot", value: "snapshot" },
  ],
})

const snapshot = env.value === "snapshot"
const version = snapshot
  ? `0.0.0-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
  : process.env["OPENCODE_VERSION"]
if (!version) {
  throw new Error("OPENCODE_VERSION is required")
}
process.env["OPENCODE_VERSION"] = version

const tree = await $`git add . && git write-tree`.text().then((x) => x.trim())
for await (const file of new Bun.Glob("**/package.json").scan({
  absolute: true,
})) {
  let pkg = await Bun.file(file).text()
  pkg = pkg.replaceAll(/"version": "[^"]+"/g, `"version": "${version}"`)
  await Bun.file(file).write(pkg)
}

await import(`../packages/opencode/script/publish.ts`)
await import(`../packages/sdk/js/script/publish.ts`)
await import(`../packages/plugin/script/publish.ts`)
// await import(`../packages/sdk/stainless/generate.ts`)

if (!snapshot) {
  await $`git commit -am "release: v${version}"`
  await $`git tag v${version}`
  await $`git push origin HEAD --tags --no-verify`
}
if (snapshot) {
  await $`git checkout -b snapshot-${version}`
  await $`git commit --allow-empty -m "Snapshot release v${version}"`
  await $`git tag v${version}`
  await $`git push origin v${version} --no-verify`
  await $`git checkout dev`
  await $`git branch -D snapshot-${version}`
  for await (const file of new Bun.Glob("**/package.json").scan({
    absolute: true,
  })) {
    $`await git checkout ${tree} ${file}`
  }
}
