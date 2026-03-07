#!/usr/bin/env bun

import path from "path"

const missing: string[] = []

for await (const file of new Bun.Glob("**/bunfig.toml").scan(".")) {
  if (file.includes("/node_modules/")) continue
  const text = await Bun.file(file).text()
  const preload = [...text.matchAll(/preload\s*=\s*\[([\s\S]*?)\]/g)].flatMap((x) => {
    if (!x[1]) return []
    return [...x[1].matchAll(/"([^"]+)"/g)].flatMap((y) => (y[1] ? [y[1]] : []))
  })

  for (const item of preload) {
    const target = path.resolve(path.dirname(file), item)
    if (await Bun.file(target).exists()) continue
    missing.push(`${file}: ${item}`)
  }
}

if (missing.length === 0) {
  console.log("All Bun preload files exist")
  process.exit(0)
}

console.error("Missing Bun preload files:")
for (const item of missing) console.error(`- ${item}`)
process.exit(1)
