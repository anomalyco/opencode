// Copies the site's OpenMono files into this app: the regular and bold "latin", "cyrillic" and "rest" subsets that
// services/site/script/openmono.py builds from OpenMono 1.000, and their licence. Run it from packages/data/app
// after the site's files change, with the folder that holds them:
//
//   bun script/openmono.ts ../../../services/site/src/asset/fonts
//
// src/routes/index.css repeats each file's unicode-range, so this fails when the site's ranges are no longer the ones
// declared there.
import path from "node:path"

const source = process.argv[2]
if (!source) throw new Error("Usage: bun script/openmono.ts <services/site/src/asset/fonts>")

const app = path.resolve(import.meta.dir, "..")
const groups = ["latin", "cyrillic", "rest"] as const
const names = [
  ...["regular", "bold"].flatMap((weight) => groups.map((group) => `openmono-${weight}-${group}.woff2`)),
  "OpenMono-OFL.txt",
]
const copied = await Promise.all(
  names.map(
    async (name) =>
      `${name} ${await Bun.write(path.join(app, "src/asset/fonts", name), Bun.file(path.join(source, name)))} bytes`,
  ),
)
console.log(copied.join("\n"))

const compact = (text: string) => text.replaceAll(/\s/g, "")
const css = compact(await Bun.file(path.join(app, "src/routes/index.css")).text())
const ranges: Record<(typeof groups)[number], string> = await Bun.file(path.join(source, "openmono.json")).json()
const stale = groups.filter((group) => !css.includes(compact(`unicode-range: ${ranges[group]};`)))
if (stale.length)
  throw new Error(
    `src/routes/index.css: update the unicode-range of the ${stale.join(" and ")} faces to:\n${stale.map((group) => ranges[group]).join("\n")}`,
  )
