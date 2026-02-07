import path from "node:path"
import { docsDir, selected } from "./i18n-common"

const root: string[] = []
for await (const file of new Bun.Glob("*.mdx").scan({ cwd: docsDir })) {
  root.push(file)
}
root.sort()

if (root.length === 0) {
  console.error("No root docs pages found in src/content/docs")
  process.exit(1)
}

const target = selected()
const errors: string[] = []

for (const code of target) {
  const dir = path.join(docsDir, code)
  for (const slug of root) {
    const file = path.join(dir, slug)
    if (await Bun.file(file).exists()) {
      continue
    }
    errors.push(`missing page: src/content/docs/${code}/${slug}`)
  }
}

if (errors.length === 0) {
  console.log(`docs page parity OK for ${target.length} locales (${root.length} slugs each).`)
  process.exit(0)
}

console.error("docs page parity failed:")
for (const error of errors) {
  console.error(`- ${error}`)
}
process.exit(1)
