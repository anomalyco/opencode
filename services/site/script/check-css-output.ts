// Fails the build when the production CSS lowers light-dark(). The site's colour tokens are
// light-dark() pairs defined once on the site root, and a card or band that forces the dark scheme
// (color-scheme: dark) relies on them resolving there. The minifier's fallback for older browsers
// (--lightningcss-light/--lightningcss-dark variables) freezes every token at the root's theme, so
// the production page silently differs from the development server. vite.config.ts's cssTarget
// keeps light-dark() native; this guards against that target being lowered again.
//
// It also fails when a stylesheet outgrows its budget (gzipped): the shell's, which every page but the
// not-found page links and holds up its first paint for, the not-found page's, which it links alone,
// and each of the others, a group of pages' or one that loads on demand (script/stylesheet-groups.ts).
// Run after `vite build`, optionally with the output directory: `bun script/check-css-output.ts .output`.
import path from "node:path"
import { Glob } from "bun"

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "..", ".output"), "public")
const budgets = { shell: 27.5 * 1024, notFound: 26 * 1024, other: 10.5 * 1024 }
const lowered: string[] = []
const over: string[] = []
const shells: string[] = []
for await (const file of new Glob("**/*.css").scan(root)) {
  const css = await Bun.file(path.join(root, file)).text()
  if (css.includes("--lightningcss-")) lowered.push(file)
  if (!file.startsWith("_build/assets/")) continue
  const shell = path.basename(file).startsWith("shell-")
  if (shell) shells.push(file)
  const size = Bun.gzipSync(css, { level: 9 }).length
  const notFound = path.basename(file).startsWith("not-found-")
  const budget = shell ? budgets.shell : notFound ? budgets.notFound : budgets.other
  if (size > budget) over.push(`${file} ${(size / 1024).toFixed(1)} kB (budget ${(budget / 1024).toFixed(1)} kB)`)
}
if (lowered.length > 0) {
  console.error(`light-dark() was lowered (--lightningcss-* variables) in:\n${lowered.join("\n")}`)
  process.exit(1)
}
if (shells.length !== 1) {
  console.error(`expected one shell stylesheet, found ${shells.length}: ${shells.join(", ")}`)
  process.exit(1)
}
if (over.length > 0) {
  console.error(`stylesheets over budget (gzipped):\n${over.join("\n")}`)
  process.exit(1)
}
console.log("Production CSS keeps light-dark() native, and each stylesheet is within its budget.")
