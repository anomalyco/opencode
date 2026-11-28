// Copies the site's OpenMono files into this app: each style's "latin", "cyrillic" and "rest" subsets that
// services/site/script/openmono.py builds from OpenMono 1.001, and their licence. Run it from packages/data/app
// after the site's files change, with the folder that holds them:
//
//   bun script/openmono.ts ../../../services/site/src/asset/fonts
//
// src/routes/index.css repeats each file's unicode-range in that file's @font-face rule. Every input is read and
// every rule is checked against the site's ranges before anything is written, so a missing file or a stale rule
// leaves this app's files as they were.
import path from "node:path"

const source = process.argv[2]
if (!source) throw new Error("Usage: bun script/openmono.ts <services/site/src/asset/fonts>")

const app = path.resolve(import.meta.dir, "..")
const groups = ["latin", "cyrillic", "rest"] as const
const fonts = ["regular", "bold", "italic", "bold-italic"].flatMap((style) =>
  groups.map((group) => ({ group, name: `openmono-${style}-${group}.woff2` })),
)
const names = [...fonts.map((font) => font.name), "OpenMono-OFL.txt", "openmono.json"]
const missing = (
  await Promise.all(names.map(async (name) => ((await Bun.file(path.join(source, name)).exists()) ? [] : [name])))
).flat()
if (missing.length) throw new Error(`Nothing was written. ${source} has no ${missing.join(", ")}`)

const ranges: Record<(typeof groups)[number], string> = await Bun.file(path.join(source, "openmono.json")).json()
const compact = (text: string) => text.replaceAll(/\s/g, "")
const rules = [...(await Bun.file(path.join(app, "src/routes/index.css")).text()).matchAll(/@font-face\s*\{[^}]*\}/g)]
const stale = fonts.flatMap((font) => {
  const rule = rules.find((match) => match[0].includes(`/${font.name}"`))?.[0]
  if (rule && compact(rule).includes(compact(`unicode-range: ${ranges[font.group]};`))) return []
  return [`${font.name}: ${rule ? "its rule needs" : "add a rule with"} unicode-range: ${ranges[font.group]}`]
})
if (stale.length) throw new Error(`Nothing was written. Update src/routes/index.css first:\n${stale.join("\n")}`)

const files = await Promise.all(
  names
    .filter((name) => name !== "openmono.json")
    .map(async (name) => ({ name, bytes: await Bun.file(path.join(source, name)).bytes() })),
)
const copied = await Promise.all(
  files.map(
    async (file) => `${file.name} ${await Bun.write(path.join(app, "src/asset/fonts", file.name), file.bytes)} bytes`,
  ),
)
console.log(copied.join("\n"))
