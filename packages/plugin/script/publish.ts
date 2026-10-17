#!/usr/bin/env bun
import { NpmLibraries } from "@opencode/script/npm"
import { $ } from "bun"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

async function published(name: string, version: string) {
  return (await $`npm view ${name}@${version} version`.nothrow()).exitCode === 0
}

const originalText = await Bun.file("package.json").text()
const pkg = JSON.parse(originalText) as {
  name: string
  version: string
  exports: Record<string, string>
  imports: Record<string, Record<string, string>>
}
const tarball = `${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}.tgz`
const carried = await NpmLibraries.carried(tarball)

if (!carried) await $`bun run build`
if (!NpmLibraries.packDir && (await published(pkg.name, pkg.version))) {
  console.log(`already published ${pkg.name}@${pkg.version}`)
} else if (carried) {
  await NpmLibraries.publish(carried)
} else {
  for (const [key, value] of Object.entries(pkg.exports)) {
    const file = value.replace("./src/", "./dist/").replace(".ts", "")
    // @ts-ignore
    pkg.exports[key] = {
      import: file + ".js",
      types: file + ".d.ts",
    }
  }
  pkg.imports = Object.fromEntries(
    Object.entries(pkg.imports).map(([key, conditions]) => [
      key,
      Object.fromEntries(
        Object.entries(conditions).map(([condition, value]) => [
          condition,
          value.replace("./src/", "./dist/").replace(/\.ts$/, ".js"),
        ]),
      ),
    ]),
  )
  await Bun.write("package.json", JSON.stringify(pkg, null, 2))
  try {
    await $`bun pm pack`
    await NpmLibraries.publish(tarball)
  } finally {
    await Bun.write("package.json", originalText)
  }
}
