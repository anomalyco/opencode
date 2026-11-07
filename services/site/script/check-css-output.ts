// Fails the build when the production CSS lowers light-dark(). The site's colour tokens are
// light-dark() pairs defined once on the site root, and a card or band that forces the dark scheme
// (color-scheme: dark) relies on them resolving there. The minifier's fallback for older browsers
// (--lightningcss-light/--lightningcss-dark variables) freezes every token at the root's theme, so
// the production page silently differs from the development server. vite.config.ts's cssTarget
// keeps light-dark() native; this guards against that target being lowered again.
// Run after `vite build`, optionally with the output directory: `bun script/check-css-output.ts .output`.
import path from "node:path"
import { Glob } from "bun"

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "..", ".output"), "public")
const lowered: string[] = []
for await (const file of new Glob("**/*.css").scan(root)) {
  if ((await Bun.file(path.join(root, file)).text()).includes("--lightningcss-")) lowered.push(file)
}
if (lowered.length > 0) {
  console.error(`light-dark() was lowered (--lightningcss-* variables) in:\n${lowered.join("\n")}`)
  process.exit(1)
}
console.log("Production CSS keeps light-dark() native.")
