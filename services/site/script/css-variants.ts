// Writes src/component/site/css-variants.json: each settings attribute and the one value production
// renders for it (the default settings; null when it is left off), on the site root and on the
// elements the pre-paint rules name. script/css-variants-plugin.ts drops, from the production CSS
// only, every rule that needs another value. Run after changing a setting's default or adding a
// settings attribute; test/css-variants.test.ts fails while the file is out of date.
import path from "node:path"
import { cssVariants } from "../src/component/site/css-variants"

const file = path.join(import.meta.dir, "../src/component/site/css-variants.json")
const variants = cssVariants()
// One element's attribute a line.
await Bun.write(
  file,
  JSON.stringify(variants, null, 2).replace(/\[\n\s+(.+),\n\s+(.+),\n\s+(.+)\n\s+\]/g, "[$1, $2, $3]") + "\n",
)
console.log(
  `css-variants.json: ${Object.keys(variants.root).length} root attributes, ${variants.scoped.length} on other elements`,
)
