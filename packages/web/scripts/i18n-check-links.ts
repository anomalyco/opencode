import path from "node:path"
import { docsDir } from "./i18n-common"

const markdown = /\]\(\/docs\/[\S)]*\)/g
const html = /href\s*=\s*(["'])\/docs\/[\s\S]*?\1/g

const errors: string[] = []
for await (const file of new Bun.Glob("**/*.mdx").scan({ cwd: docsDir })) {
  const text = await Bun.file(path.join(docsDir, file)).text()
  const lines = text.split("\n")
  for (const [row, line] of lines.entries()) {
    markdown.lastIndex = 0
    html.lastIndex = 0
    if (!markdown.test(line) && !html.test(line)) continue
    errors.push(`${path.join("src/content/docs", file)}:${row + 1}: ${line.trim()}`)
  }
}

if (errors.length === 0) {
  console.log("No locale-breaking /docs/ links found.")
  process.exit(0)
}

console.error("Found locale-breaking absolute /docs/ links:")
for (const line of errors) {
  console.error(`- ${line}`)
}
process.exit(1)
