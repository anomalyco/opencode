import { $ } from "bun"
import { copyFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { Script } from "./index.js"

// publish.yml's pack-npm job builds and packs the npm libraries while the CLI builds, and its publish job publishes
// those tarballs. Without either variable, a library's script/publish.ts builds, packs and publishes in place.
const packDir = process.env["OPENCODE_NPM_PACK_DIR"]
const tarballs = process.env["OPENCODE_NPM_TARBALLS"]

// The library scripts script/publish.ts runs besides the CLI's, in its order. A library missing here still builds and
// publishes in place.
const names = [
  "schema",
  "codemode",
  "theme",
  "ai",
  "util",
  "protocol",
  "client",
  "plugin",
  "plugin-browser",
  "core",
  "simulation",
  "server",
  "sdk",
  "ui",
]

export const NpmLibraries = {
  names,
  // Set in pack-npm: the library scripts skip the npm view check, pack into this directory and publish nothing.
  packDir,
  // Set in publish: the directory holding pack-npm's tarballs.
  tarballs,

  // The tarball pack-npm built for this package, if publish has it.
  async carried(tarball: string) {
    if (!tarballs) return undefined
    const file = join(tarballs, basename(tarball))
    if (!(await Bun.file(file).exists())) return undefined
    return file
  },

  // Publishes the tarball. In pack-npm, copies it to the pack directory instead.
  async publish(tarball: string) {
    if (packDir) return copyFile(tarball, join(packDir, basename(tarball)))
    await $`npm publish ${tarball} --tag ${Script.channel} --access public`
  },

  // Fails unless the directory holds every library's tarball, packed from that package for this version. Runs from
  // the repository root.
  async verify(directory: string) {
    const problems = await Promise.all(
      names.map(async (name) => {
        const pkg: { name: string } = await Bun.file(`packages/${name}/package.json`).json()
        const file = join(directory, `${pkg.name.replace("@", "").replace("/", "-")}-${Script.version}.tgz`)
        if (!(await Bun.file(file).exists())) return `${file} is missing`
        const packed: { name: string; version: string } = await $`tar -xzOf ${file} package/package.json`.quiet().json()
        if (packed.name === pkg.name && packed.version === Script.version) return undefined
        return `${file} holds ${packed.name}@${packed.version}, expected ${pkg.name}@${Script.version}`
      }),
    ).then((items) => items.filter((item) => item !== undefined))
    if (problems.length > 0) throw new Error(`npm library tarballs do not match this release:\n${problems.join("\n")}`)
    console.log(`verified ${names.length} npm library tarballs in ${directory}`)
  },
}
