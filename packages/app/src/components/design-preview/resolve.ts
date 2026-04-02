import { pickClasses } from "./pick-classes"

export type Hit = {
  file: string
  line: number
  comp?: string
}

type Match = {
  path: { text: string }
  line_number?: number | null
}

type Files = {
  normalize(input: string): string
}

type Client = {
  find: {
    text(input: { pattern: string }): Promise<{ data?: Match[] }>
  }
}

type Info = {
  component?: string
  source?: { component?: string }
  textContent?: string
  searchHint?: string[]
  classes?: string
}

export function createResolver(files: Files, client: Client) {
  const textCache = new Map<string, Hit | null>()
  const textRun = new Map<string, Promise<Hit | null>>()
  const defCache = new Map<string, Hit | null>()
  const defRun = new Map<string, Promise<Hit | null>>()
  const useCache = new Map<string, Hit | null>()
  const useRun = new Map<string, Promise<Hit | null>>()
  let rev = 0

  const normalizePath = (file: string) => {
    return files.normalize(
      file
        .replace(/^https?:\/\/[^/]+\//, "")
        .replace(/^turbopack:\/\/\[project\]\//, "")
        .replace(/^webpack-internal:\/\/\/\.?\//, "")
        .replace(/^webpack:\/\/\/\.?\//, "")
        .replace(/^webpack:\/\/[^/]*\/\.?\//, "")
        .replace(/^\(.*?\)\/\.?\//, "")
        .replace(/^\/@fs/, "")
        .replace(/^\/@(id|vite)\//, "")
        .replace(/\\/g, "/"),
    )
  }

  const isSourceFile = (path: string) => {
    const name = path.split("/").pop() ?? ""
    if (path.includes("node_modules/") || path.includes("node_modules\\")) return false
    if (path.includes(".vite/deps/") || path.includes(".vite/chunks/")) return false
    if (path.includes(".pnpm/") || path.includes(".yarn/cache")) return false
    if (/^[0-9a-f]{4,}\.(js|mjs)$/.test(name)) return false
    if (/\.[0-9a-f]{6,}\.(js|mjs)$/.test(name)) return false
    if (/^(main|app|vendor|framework|commons|webpack|polyfills?)-[0-9a-f]+\.(js|mjs)$/.test(name)) return false
    if (path.includes("static/chunks/") || path.includes("_next/") || path.includes(".next/")) return false
    if (path.includes("/build/static/")) return false
    if (/\.(tsx?|jsx?|vue|svelte|astro|html)$/.test(name)) return true
    if (/\.(js|mjs)$/.test(name) && (path.includes("/dist/") || path.includes("/build/"))) return false
    return true
  }

  const isUserFile = (path: string) => {
    return (
      !path.includes("node_modules/") &&
      !path.includes("node_modules\\") &&
      !path.includes(".vite/deps/") &&
      !path.includes(".vite/chunks/") &&
      !path.includes(".pnpm/") &&
      !path.includes(".yarn/cache") &&
      /\.(tsx|jsx|ts|js|vue|svelte|html)$/.test(path)
    )
  }

  const fileDefinesComponent = (file: string, comp: string) => {
    if (!comp) return true
    const name = (file.split("/").pop() ?? "").replace(/\.(tsx?|jsx?|vue|svelte)$/, "")
    const low = comp.toLowerCase()
    if (name.toLowerCase() === low) return true
    if (name.toLowerCase().replace(/[-_]/g, "") === low) return true
    if (name === "index") return true
    if (["page", "layout", "template", "loading", "error", "not-found"].includes(name)) return true
    return false
  }

  const findDefinition = async (comp: string): Promise<Hit | null> => {
    if (defCache.has(comp)) return defCache.get(comp) ?? null
    const pending = defRun.get(comp)
    if (pending) return pending
    const patterns = [`function ${comp}`, `const ${comp}`, `export default function ${comp}`, `export function ${comp}`]
    const cur = rev
    const run = (async () => {
      for (const pattern of patterns) {
        const res = await client.find.text({ pattern }).catch(() => null)
        if (cur !== rev) return null
        const hits = res?.data ?? []
        if (!hits.length) continue

        const user = hits.filter((m) => isUserFile(m.path.text))
        const exact = user.find((m) => {
          const file = (m.path.text.split("/").pop() ?? "").replace(/\.(tsx?|jsx?|vue|svelte)$/, "")
          return (
            file.toLowerCase() === comp.toLowerCase() || file.toLowerCase().replace(/[-_]/g, "") === comp.toLowerCase()
          )
        })
        const match = exact ?? user[0]
        if (!match?.path.text) continue

        const hit = { file: match.path.text, line: match.line_number ?? 1, comp }
        defCache.set(comp, hit)
        console.log("[Design] Found definition of", comp, "at:", match.path.text, "line:", hit.line, "via:", pattern)
        return hit
      }
      defCache.set(comp, null)
      return null
    })().finally(() => {
      defRun.delete(comp)
    })
    defRun.set(comp, run)
    return run
  }

  const findUsage = async (comp: string): Promise<Hit | null> => {
    if (useCache.has(comp)) return useCache.get(comp) ?? null
    const pending = useRun.get(comp)
    if (pending) return pending
    const cur = rev
    const run = client.find
      .text({ pattern: `<${comp}` })
      .then(
        (res) => {
          if (cur !== rev) return null
          const hits = res.data ?? []
          const match = hits.filter((m) => isUserFile(m.path.text))[0]
          if (!match?.path.text) {
            useCache.set(comp, null)
            return null
          }
          const hit = { file: match.path.text, line: match.line_number ?? 1, comp }
          useCache.set(comp, hit)
          console.log("[Design] Found usage of <" + comp + "> at:", match.path.text, "line:", hit.line)
          return hit
        },
        () => {
          if (cur !== rev) return null
          useCache.set(comp, null)
          return null
        },
      )
      .finally(() => {
        useRun.delete(comp)
      })
    useRun.set(comp, run)
    return run
  }

  const findByText = async (text: string): Promise<Hit | null> => {
    if (!text || text.length < 4) return null
    if (textCache.has(text)) return textCache.get(text) ?? null
    const pending = textRun.get(text)
    if (pending) return pending
    const cur = rev
    const run = client.find
      .text({ pattern: text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") })
      .then(
        (res) => {
          if (cur !== rev) return null
          const hits = res.data ?? []
          const match = hits.find((m) => isUserFile(m.path.text))
          if (!match?.path.text) {
            textCache.set(text, null)
            return null
          }
          const hit = { file: match.path.text, line: match.line_number ?? 1 }
          textCache.set(text, hit)
          console.log("[Design] Found by text content:", match.path.text, "line:", match.line_number)
          return hit
        },
        () => {
          if (cur !== rev) return null
          textCache.set(text, null)
          return null
        },
      )
      .finally(() => {
        textRun.delete(text)
      })
    textRun.set(text, run)
    return run
  }

  const grepFallback = async (info: Info): Promise<Hit | null> => {
    const comp = info.component ?? info.source?.component
    if (comp) {
      const def = await findDefinition(comp)
      if (def) return def
      const use = await findUsage(comp)
      if (use) return use
    }
    if (info.textContent) {
      const text = await findByText(info.textContent)
      if (text) return text
    }

    const terms: string[] = []
    for (const name of info.searchHint ?? []) {
      if (name.startsWith("#")) continue
      if (name.length > 2 && !terms.includes(name)) terms.push(name)
    }
    for (const name of pickClasses(info.classes)) {
      if (!terms.includes(name)) terms.push(name)
    }
    if (!terms.length) return null

    for (const pattern of terms) {
      const res = await client.find.text({ pattern }).catch(() => null)
      const hits = res?.data ?? []
      const match = hits.find((m) => isUserFile(m.path.text))
      if (!match?.path.text) continue
      console.log("[Design] grep fallback found:", match.path.text, "via term:", pattern)
      return { file: match.path.text, line: match.line_number ?? 1 }
    }

    return null
  }

  const reset = () => {
    rev++
    textCache.clear()
    textRun.clear()
    defCache.clear()
    defRun.clear()
    useCache.clear()
    useRun.clear()
  }

  return {
    normalizePath,
    isSourceFile,
    fileDefinesComponent,
    findDefinition,
    findUsage,
    grepFallback,
    reset,
  }
}
