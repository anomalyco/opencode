import { $ } from "bun"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../../..")

// Release outputs land at the repository root, where the release workflow uploads them.
export const npmDir = path.join(root, "dist", "npm")
export const archiveDir = path.join(root, "dist", "archives")

type Manifest = {
  name: string
  version: string
  exports: Record<string, string>
  imports?: Record<string, Record<string, string>>
}

/**
 * Builds the package in `directory`, points its TypeScript exports at the build output, and packs it
 * into dist/npm. `types` is where the build writes declarations; `source` keeps `import` on the
 * TypeScript sources for packages that ship them.
 */
export async function pack(directory: string, options: { types?: string; source?: boolean } = {}) {
  const types = options.types ?? "./dist/"
  const file = path.join(directory, "package.json")
  const original = await Bun.file(file).text()
  // SAFETY: release packages declare a name, a version, and string export targets.
  const pkg = JSON.parse(original) as Manifest
  const declaration = (value: string) => value.replace("./src/", types).replace(/\.tsx?$/, ".d.ts")
  const output = (value: string) => value.replace("./src/", "./dist/").replace(/\.tsx?$/, ".js")
  const tarball = path.join(npmDir, `${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}.tgz`)

  await $`bun run build`.cwd(directory)

  const exports = Object.fromEntries(
    Object.entries(pkg.exports).map(([key, value]) => {
      if (!/\.tsx?$/.test(value)) return [key, value]

      return [key, { import: options.source ? value : output(value), types: declaration(value) }]
    }),
  )
  const imports = pkg.imports
    ? Object.fromEntries(
        Object.entries(pkg.imports).map(([key, conditions]) => [
          key,
          Object.fromEntries(
            Object.entries(conditions).map(([condition, value]) => [
              condition,
              condition === "types" ? declaration(value) : output(value),
            ]),
          ),
        ]),
      )
    : undefined

  await mkdir(npmDir, { recursive: true })
  await rm(tarball, { force: true })
  await Bun.write(file, JSON.stringify({ ...pkg, exports, ...(imports ? { imports } : {}) }, null, 2) + "\n")

  try {
    await $`bun pm pack --destination ${npmDir}`.cwd(directory)
  } finally {
    await Bun.write(file, original)
  }

  return tarball
}
