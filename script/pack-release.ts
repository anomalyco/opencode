// Runs only in the credential-free build job. Signing and publishing consume its output as data.
import { $ } from "bun"
import { cp, mkdir } from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
process.chdir(root)
const version = process.env.OPENCODE_VERSION
if (!version) throw new Error("OPENCODE_VERSION is required")
const out = path.join(root, "dist/release")
await mkdir(`${out}/npm`, { recursive: true })
await mkdir(`${out}/archives`, { recursive: true })
const manifests = (await $`git ls-files -z -- '*package.json'`.text()).split("\0").filter(Boolean)
for (const name of manifests) {
  const file = Bun.file(name)
  const pkg = await file.json()
  if (pkg.version) await Bun.write(file, JSON.stringify({ ...pkg, version }, null, 2) + "\n")
}

await $`bun packages/opencode/script/build.ts --skip-smoke`
const binaries: Record<string, string> = {}
for await (const file of new Bun.Glob("opencode-*/package.json").scan("packages/opencode/dist")) {
  const dir = path.join(root, "packages/opencode/dist", path.dirname(file))
  const pkg = await Bun.file(path.join(dir, "package.json")).json()
  binaries[pkg.name] = version
  await $`bun pm pack --destination ${out}/npm`.cwd(dir)
  if (pkg.os.includes("linux")) await $`tar -czf ${out}/archives/${pkg.name}.tar.gz -C ${dir}/bin opencode`
}

const wrapper = `${out}/wrapper`
await mkdir(`${wrapper}/bin`, { recursive: true })
await cp("packages/opencode/script/postinstall.mjs", `${wrapper}/postinstall.mjs`)
await cp("LICENSE", `${wrapper}/LICENSE`)
await Bun.write(`${wrapper}/bin/opencode.exe`, '#!/bin/sh\necho "opencode-ai requires its postinstall script" >&2\nexit 1\n')
await $`chmod 755 ${wrapper}/bin/opencode.exe`
await Bun.write(`${wrapper}/package.json`, JSON.stringify({ name: "opencode-ai", version, license: "MIT", os: ["darwin", "linux", "win32"], cpu: ["arm64", "x64"], bin: { opencode: "./bin/opencode.exe" }, scripts: { postinstall: "node ./postinstall.mjs" }, optionalDependencies: binaries }))
await $`bun pm pack --destination ${out}/npm`.cwd(wrapper)

await $`bun packages/sdk/js/script/build.ts`
await $`bun run build`.cwd("packages/plugin")
function distExports(value: string | Record<string, string>): object {
  if (typeof value === "string") {
    const base = value.replace("./src/", "./dist/").replace(/\.ts$/, "")
    return { import: `${base}.js`, types: `${base}.d.ts` }
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, distExports(entry)]))
}
for (const dir of ["packages/sdk/js", "packages/plugin"]) {
  const file = Bun.file(`${dir}/package.json`)
  const pkg = await file.json()
  await Bun.write(file, JSON.stringify({ ...pkg, exports: distExports(pkg.exports) }, null, 2))
  await $`bun pm pack --destination ${out}/npm`.cwd(dir)
}
await $`bun script/pack.ts`.cwd("packages/ui")
await cp(`packages/ui/opencode-ai-ui-${version}.tgz`, `${out}/npm/opencode-ai-ui-${version}.tgz`)
