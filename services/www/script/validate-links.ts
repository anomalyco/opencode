import path from "node:path"

const root = path.resolve(import.meta.dir, "../dist/client")
const files = await Array.fromAsync(new Bun.Glob("**/*.html").scan({ cwd: root, absolute: true }))
const failures = (
  await Promise.all(
    files.flatMap(async (file) => {
      const html = await Bun.file(file).text()
      const page = `https://opencode.local/${path.relative(root, file).replace(/index\.html$/, "")}`
      return Promise.all(
        Array.from(html.matchAll(/href="([^"]+)"/g), async (match) => {
          const url = new URL(match[1], page)
          if (url.origin !== "https://opencode.local") return

          const targetPath = path.join(root, decodeURIComponent(url.pathname))
          const target = (
            await Promise.all(
              [targetPath, path.join(targetPath, "index.html"), `${targetPath}.html`].map(async (candidate) =>
                (await Bun.file(candidate).exists()) ? candidate : undefined,
              ),
            )
          ).find((candidate) => candidate !== undefined)
          if (!target) return `${path.relative(root, file)}: missing ${url.pathname}`
          if (!url.hash || !target.endsWith(".html")) return

          const id = decodeURIComponent(url.hash.slice(1))
          if ((await Bun.file(target).text()).includes(`id="${id}"`)) return
          return `${path.relative(root, file)}: missing ${url.pathname}${url.hash}`
        }),
      )
    }),
  )
)
  .flat(2)
  .filter((failure) => failure !== undefined)

if (failures.length === 0) process.exit(0)
console.error([...new Set(failures)].sort().join("\n"))
process.exit(1)
