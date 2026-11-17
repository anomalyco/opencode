#!/usr/bin/env bun

// Runs test262 files through the reference's own runner, `test/test262/run.ts` of the reference package, over the
// synced tree. The runner reads files next to itself, so a copy goes into the tree with its imports pointed back at
// the reference package; its harness and semantics are unchanged.
// Usage: bun test262/reference.ts <reference package> <synced tree> <list file> [prefix]
// Prints `pass\t<file>` or `fail\t<file>\t<reason>` for every `path  # ...` line of the list under the prefix.
import path from "node:path"

const [pkg, tree, list, prefix = ""] = process.argv.slice(2).map((arg, i) => (i < 3 ? path.resolve(arg) : arg))
if (pkg === undefined || tree === undefined || list === undefined) {
  console.error("usage: bun test262/reference.ts <reference package> <synced tree> <list file> [prefix]")
  process.exit(1)
}

const runner = await Bun.file(path.join(pkg, "test/test262/run.ts")).text()
const effect = Bun.resolveSync("effect", path.join(pkg, "src"))
await Bun.write(
  path.join(tree, "reference-run.ts"),
  runner
    .replaceAll('from "../../src/', `from "${path.join(pkg, "src")}/`)
    .replaceAll('from "effect"', `from "${effect}"`),
)
await Bun.write(path.join(tree, "skipped.txt"), Bun.file(path.join(pkg, "test/test262/skipped.txt")))
const { run } = await import(path.join(tree, "reference-run.ts"))

const files = (await Bun.file(list).text())
  .split("\n")
  .filter((line) => !line.startsWith("#") && line.includes("#"))
  .map((line) => line.slice(0, line.indexOf("#")).trim())
  .filter((file) => file.startsWith(prefix))
for (const file of files) {
  const outcome = await run(file).catch((error: unknown) => ({ status: "fail", reason: `runner error: ${error}` }))
  console.log(outcome.status === "pass" ? `pass\t${file}` : `fail\t${file}\t${outcome.reason.replace(/\s+/g, " ")}`)
}
