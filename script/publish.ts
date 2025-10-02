#!/usr/bin/env bun

import { $ } from "bun"
import { createOpencodeClient, createOpencodeServer } from "@opencode-ai/sdk"
if (process.versions.bun !== "1.2.21") {
  throw new Error("This script requires bun@1.2.21")
}

let notes = []

console.log("=== publishing ===\n")

const snapshot = process.env["OPENCODE_SNAPSHOT"] === "true"
const version = await (async () => {
  if (snapshot) return `0.0.0-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
  if (process.env["OPENCODE_VERSION"]) return process.env["OPENCODE_VERSION"]
  const [major, minor, patch] = (await $`gh release list --limit 1 --json tagName --jq '.[0].tagName'`.text())
    .trim()
    .replace(/^v/, "")
    .split(".")
    .map((x) => Number(x) || 0)
  const t = process.env["OPENCODE_BUMP"]?.toLowerCase()
  if (t === "major") return `${major + 1}.0.0`
  if (t === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
})()
process.env["OPENCODE_VERSION"] = version
console.log("version:", version)

if (!snapshot) {
  const previous = await fetch("https://api.github.com/repos/sst/opencode/releases/latest")
    .then((res) => {
      if (!res.ok) throw new Error(res.statusText)
      return res.json()
    })
    .then((data) => data.tag_name)

  const server = await createOpencodeServer()
  const client = createOpencodeClient({ baseUrl: server.url })
  const session = await client.session.create()
  console.log("generating changelog since " + previous)
  const raw = await client.session
    .prompt({
      path: {
        id: session.data!.id,
      },
      body: {
        model: {
          providerID: "opencode",
          modelID: "kimi-k2",
        },
        parts: [
          {
            type: "text",
            text: `
          Analyze the commits between ${previous} and HEAD.

          We care about changes to
          - packages/opencode
          - packages/sdk
          - packages/plugin

          We do not care about anything else

          Return a changelog of all notable user facing changes.

          - Do NOT make general statements about "improvements", be very specific about what was changed.
          - Do NOT include any information about code changes if they do not affect the user facing changes.
          
          IMPORTANT: ONLY return a bulleted list of changes, do not include any other information. Do not include a preamble like "Based on my analysis..."

          <example>
          - Added ability to @ mention agents
          - Fixed a bug where the TUI would render improperly on some terminals
          </example>
          `,
          },
        ],
      },
    })
    .then((x) => x.data?.parts?.find((y) => y.type === "text")?.text)
  for (const line of raw?.split("\n") ?? []) {
    if (line.startsWith("- ")) {
      notes.push(line)
    }
  }
  server.close()
}

const pkgjsons = await Array.fromAsync(
  new Bun.Glob("**/package.json").scan({
    absolute: true,
  }),
).then((arr) => arr.filter((x) => !x.includes("node_modules") && !x.includes("dist")))

const tree = await $`git add . && git write-tree`.text().then((x) => x.trim())
for (const file of pkgjsons) {
  let pkg = await Bun.file(file).text()
  pkg = pkg.replaceAll(/"version": "[^"]+"/g, `"version": "${version}"`)
  console.log("updated:", file)
  await Bun.file(file).write(pkg)
}
await $`bun install`

console.log("\n=== opencode ===\n")
await import(`../packages/opencode/script/publish.ts`)

console.log("\n=== sdk ===\n")
await import(`../packages/sdk/js/script/publish.ts`)

console.log("\n=== plugin ===\n")
await import(`../packages/plugin/script/publish.ts`)

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)

if (!snapshot) {
  await $`git commit -am "release: v${version}"`
  await $`git tag v${version}`
  await $`git fetch origin`
  await $`git cherry-pick HEAD..origin/dev`.nothrow()
  await $`git push origin HEAD --tags --no-verify --force`

  await $`gh release create v${version} --title "v${version}" --notes ${notes.join("\n") ?? "No notable changes"} ./packages/opencode/dist/*.zip`
}
if (snapshot && false) {
  await $`git checkout -b snapshot-${version}`
  await $`git commit --allow-empty -m "Snapshot release v${version}"`
  await $`git tag v${version}`
  await $`git push origin v${version} --no-verify`
  await $`git checkout dev`
  await $`git branch -D snapshot-${version}`
  for (const file of pkgjsons) {
    await $`git checkout ${tree} ${file}`
  }
}
