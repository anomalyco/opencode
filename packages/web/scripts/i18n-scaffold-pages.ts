import { mkdir } from "node:fs/promises"
import path from "node:path"
import { docsDir, locale } from "./i18n-common"

const root = docsDir
const shift = (file: string) => path.posix.normalize(path.posix.join("..", file))
const slugs = []
for await (const file of new Bun.Glob("*.mdx").scan({ cwd: root })) slugs.push(file)
slugs.sort()

let created = 0
for (const code of locale) {
  const dir = path.join(root, code)
  await mkdir(dir, { recursive: true })
  for (const slug of slugs) {
    const source = await Bun.file(path.join(root, slug)).text()
    const target = path.join(dir, slug)
    const exists = await Bun.file(target).exists()
    if (exists) continue
    const text = source
      .replace(/(from\s+["'])(\.[^"']*)(["'])/g, (_match, start, file, end) => `${start}${shift(file)}${end}`)
      .replace(/\]\(((?:\.\.\/)[^)]+)\)/g, (_match, file) => `](${shift(file)})`)
      .replace(/(href|src)\s*=\s*(["'])((?:\.\.\/)[^"']*)\2/g, (_match, attr, quote, file) => {
        return `${attr}=${quote}${shift(file)}${quote}`
      })
    await Bun.write(target, text)
    created += 1
  }
}

console.log(`Scaffolded ${locale.length} locales with ${slugs.length} root pages. Created ${created} files.`)
