type Pkg = {
  scripts?: Record<string, string | undefined>
  dependencies?: Record<string, string | undefined>
  devDependencies?: Record<string, string | undefined>
}

const ports = [3000, 3001, 5173, 4173, 4321, 8080, 8000, 6006]

function uniq(list: string[]) {
  const seen = new Set<string>()
  return list.filter((item) => {
    if (seen.has(item)) return false
    seen.add(item)
    return true
  })
}

function urls(text: string) {
  return [...text.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/[^\s"'`]*)?/gi)].map((item) =>
    item[0]!.replace(/\/+$/, ""),
  )
}

function nums(text: string) {
  return [
    ...text.matchAll(
      /(?:--port(?:=|\s+)|(?:^|\s)-p\s+|(?:^|\s)(?:PORT|port)=)(\d{2,5})(?=\s|$|["'])/g,
    ),
  ].map((item) => item[1]!)
}

function port(pkg?: Pkg) {
  const deps = {
    ...pkg?.dependencies,
    ...pkg?.devDependencies,
  }

  if (deps.next) return "3000"
  if (deps["react-scripts"]) return "3000"
  if (deps.remix || deps["@remix-run/dev"]) return "3000"
  if (deps.nuxt || deps.nuxi) return "3000"
  if (deps.storybook || deps["@storybook/react"] || deps["@storybook/vue3"]) return "6006"
  if (deps.astro) return "4321"
  if (deps.vite || deps["vitepress"] || deps["@sveltejs/kit"] || deps["solid-start"]) return "5173"
}

function gather(text?: string) {
  if (!text) return []
  return uniq([...urls(text), ...nums(text).map((item) => `http://localhost:${item}`)])
}

export function infer(input: { cmd?: string; pkg?: Pkg }) {
  const list = [
    ...gather(input.cmd),
    ...gather(input.pkg?.scripts?.dev),
    ...gather(input.pkg?.scripts?.start),
  ]

  const hit = port(input.pkg)
  if (hit) list.push(`http://localhost:${hit}`)

  list.push(...ports.map((item) => `http://localhost:${item}`))
  return uniq(list)
}
