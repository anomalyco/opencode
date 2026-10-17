import { Script } from "@opencode/script"
import { $ } from "bun"

// Shared by script/publish.ts and script/pack-npm.ts, so the libraries pack-npm builds see the same package versions
// and install as a build in publish would.
export async function packageJsons() {
  return Array.fromAsync(
    new Bun.Glob("**/package.json").scan({
      absolute: true,
    }),
  ).then((arr) => arr.filter((x) => !x.includes("node_modules") && !x.includes("dist")))
}

export async function prepareReleaseFiles(files: string[]) {
  for (const file of files) {
    let pkg = await Bun.file(file).text()
    pkg = pkg.replaceAll(/"version": "[^"]+"/g, `"version": "${Script.version}"`)
    console.log("updated:", file)
    await Bun.file(file).write(pkg)
  }

  await $`bun install`
}
