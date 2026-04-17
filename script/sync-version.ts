#!/usr/bin/env bun

import semver from "semver"
import path from "path"

const root = path.resolve(import.meta.dir, "..")
const file = path.join(root, "VERSION")
const input = process.argv[2]?.trim()
const next = input?.replace(/^v(?=\d)/, "")

if (input && !semver.valid(next)) {
  throw new Error(`invalid version: ${input}`)
}

if (next) {
  await Bun.write(file, `${next}\n`)
}

const version = await Bun.file(file)
  .text()
  .then((x) => x.trim())

if (!semver.valid(version)) {
  throw new Error(`invalid VERSION: ${version}`)
}

const scan = async (glob: string) =>
  Array.fromAsync(new Bun.Glob(glob).scan({ cwd: root, absolute: true })).then((list) =>
    list.filter((item) => !item.includes("/node_modules/") && !item.includes("/dist/")),
  )

const files = [
  ...(await scan("packages/**/package.json")),
  ...(await scan("sdks/**/package.json")),
]

for (const item of files) {
  const text = await Bun.file(item).text()
  if (!/"version"\s*:\s*"[^"]+"/.test(text)) continue
  const next = text.replace(/"version"\s*:\s*"[^"]+"/, `"version": "${version}"`)
  if (next === text) continue
  await Bun.write(item, `${next.trimEnd()}\n`)
  console.log(`updated: ${path.relative(root, item)}`)
}

const toml = path.join(root, "packages/extensions/zed/extension.toml")
const zed = await Bun.file(toml).text()
const fixed = zed
  .replace(/^version = "[^"]+"/m, `version = "${version}"`)
  .replaceAll(/releases\/download\/v[^/]+\//g, `releases/download/v${version}/`)

if (fixed !== zed) {
  await Bun.write(toml, `${fixed.trimEnd()}\n`)
  console.log(`updated: ${path.relative(root, toml)}`)
}

console.log(`version: ${version}`)
