#!/usr/bin/env bun
import { $ } from "bun"
import { fileURLToPath } from "node:url"
import { pack } from "./pack.js"
import { verifyPackage } from "./verify-package.js"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const published = async (name: string, version: string) =>
  (await $`npm view ${name}@${version} version`.nothrow()).exitCode === 0

// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- package.json is validated by the package schema and build checks.
const pkg = JSON.parse(await Bun.file("package.json").text()) as { readonly name: string; readonly version: string }

if (await published(pkg.name, pkg.version)) {
  console.log(`already published ${pkg.name}@${pkg.version}`)
} else {
  const archive = await pack()
  try {
    await verifyPackage(archive)
    await $`npm publish ${archive} --tag beta --access public --provenance`
  } finally {
    await Bun.file(archive).delete()
  }
}
