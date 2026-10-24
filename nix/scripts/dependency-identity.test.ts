import { expect, test } from "bun:test"
import { readdir, realpath } from "node:fs/promises"
import { dirname, join } from "node:path"
import { migrateV1, resolveThemeDocument } from "../../packages/theme/src/tui/index.js"
import type { ThemeV1Json } from "../../packages/theme/src/tui/v1.js"
import { createColors, deriveInactiveColor, deriveTrailColors } from "../../packages/tui/src/ui/spinner.js"

const root = join(import.meta.dir, "../..")
const source: ThemeV1Json = await Bun.file(join(root, "packages/tui/src/theme/assets/opencode.json")).json()

test.each(["light", "dark"] as const)("theme colors survive spinner conversion in %s mode", (mode) => {
  const color = resolveThemeDocument(migrateV1(source), mode).hue.accent[800]
  const trail = deriveTrailColors(color)
  expect([trail[0].r, trail[0].g, trail[0].b, trail[0].a]).toEqual([color.r, color.g, color.b, 1])
  const inactive = deriveInactiveColor(color, 0.2)
  expect([inactive.r, inactive.g, inactive.b]).toEqual([color.r, color.g, color.b])
  expect(inactive.a).toBeCloseTo(0.2, 2)
  expect(createColors({ colors: [color], defaultColor: color, enableFading: false })(0, 7, 54, 8)).toEqual(color)
})

test("OpenTUI consumers resolve one runtime entrypoint", async () => {
  const consumers = ["theme", "tui", "cli", "merman", "latex", "plugin", "simulation"]
  const paths = await Promise.all(
    consumers.map((workspace) => realpath(Bun.resolveSync("@opentui/core", join(root, "packages", workspace)))),
  )
  expect(new Set(paths).size).toBe(1)

  for (const dependency of ["@opentui/solid", "@opentui/keymap"]) {
    const resolved = Bun.resolveSync(dependency, join(root, "packages/tui"))
    expect(await realpath(Bun.resolveSync("@opentui/core", dirname(resolved)))).toBe(paths[0])
  }
})

test.each([
  ["@ai-sdk/provider-utils", "zod"],
  ["@opentelemetry/core", "@opentelemetry/api"],
] as const)("%s keeps distinct %s peer contexts", async (name, peer) => {
  const store = join(root, "node_modules/.bun")
  const entries = (await readdir(store)).filter((entry) => entry.startsWith(name.replaceAll("/", "+") + "@"))
  const contexts = new Map<string, Set<string>>()

  for (const entry of entries) {
    const entryRoot = join(store, entry)
    const packagePath = join(entryRoot, "node_modules", name)
    const manifest = await Bun.file(join(packagePath, "package.json")).json()
    const peerPath = await realpath(join(entryRoot, "node_modules", peer))
    const peerManifest = await Bun.file(join(peerPath, "package.json")).json()
    const versions = contexts.get(manifest.version) ?? new Set<string>()
    versions.add(peerManifest.version)
    contexts.set(manifest.version, versions)
  }

  expect([...contexts.values()].some((versions) => versions.size > 1)).toBe(true)
})
