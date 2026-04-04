import { pickClasses } from "./pick-classes"

const SCORE = {
  index: 0.95,
  tag: 0.9,
  definition: 0.88,
  usage: 0.65,
  text: 0.05,
  grep: 0.35,
} as const

export type Hit = {
  file: string
  line: number
  comp?: string
  owner?: string
  origin?: string
  score?: number
  ambiguous?: boolean
  candidates?: Array<{ file: string; line: number; component?: string; owner?: string }>
}

type Match = {
  path: { text: string }
  line_number?: number | null
}

type Files = {
  normalize(input: string): string
  load(input: string): Promise<void>
  get(input: string):
    | {
        content?: {
          type: string
          content?: string
        }
      }
    | undefined
}

type Client = {
  find: {
    text(input: { pattern: string }): Promise<{ data?: Match[] }>
  }
}

type Info = {
  component?: string
  source?: { component?: string }
  definition?: { component?: string }
  textContent?: string
  searchHint?: string[]
  classes?: string
}

type TagOpts = {
  text?: string
  search?: string[]
  classes?: string
}

type TagHit = Hit & {
  score: number
}

export function createResolver(files: Files, client: Client) {
  const textCache = new Map<string, Hit | null>()
  const textRun = new Map<string, Promise<Hit | null>>()
  const defCache = new Map<string, Hit | null>()
  const defRun = new Map<string, Promise<Hit | null>>()
  const useCache = new Map<string, Hit | null>()
  const useRun = new Map<string, Promise<Hit | null>>()
  const fileCache = new Map<string, string | null>()
  const fileRun = new Map<string, Promise<string | null>>()
  const tagCache = new Map<string, TagHit | null>()
  const tagRun = new Map<string, Promise<TagHit | null>>()
  let rev = 0

  const escape = (input: string) => input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

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

  const readText = async (input: string) => {
    const file = normalizePath(input)
    if (fileCache.has(file)) return fileCache.get(file) ?? null
    const pending = fileRun.get(file)
    if (pending) return pending
    const cur = rev
    const run = files
      .load(file)
      .then(() => {
        if (cur !== rev) return null
        const content = files.get(file)?.content
        const text = content?.type === "text" && typeof content.content === "string" ? content.content : null
        fileCache.set(file, text)
        return text
      })
      .catch(() => {
        if (cur !== rev) return null
        fileCache.set(file, null)
        return null
      })
      .finally(() => {
        fileRun.delete(file)
      })
    fileRun.set(file, run)
    return run
  }

  const scanTag = async (input: string, comp: string, opts?: TagOpts): Promise<TagHit | null> => {
    const file = normalizePath(input)
    const terms = [
      opts?.text?.trim(),
      ...(opts?.search ?? []).map((item) => (item.startsWith("#") ? item.slice(1) : item).trim()),
      ...pickClasses(opts?.classes),
    ].filter((item, idx, all): item is string => !!item && item.length > 1 && all.indexOf(item) === idx)
    const key = `${file}\n${comp}\n${terms.join("\n")}`
    if (tagCache.has(key)) return tagCache.get(key) ?? null
    const pending = tagRun.get(key)
    if (pending) return pending
    const cur = rev
    const run = readText(file)
      .then((text) => {
        if (cur !== rev) return null
        if (!text) {
          tagCache.set(key, null)
          return null
        }
        const out: { index: number; line: number }[] = []
        const re = new RegExp(`<${escape(comp)}(?=[\\s>/])`, "g")
        let line = 1
        let last = 0
        let match: RegExpExecArray | null
        while ((match = re.exec(text))) {
          line += text.slice(last, match.index).split("\n").length - 1
          out.push({ index: match.index, line })
          last = match.index
          if (match.index === re.lastIndex) re.lastIndex++
        }
        if (!out.length) {
          if (cur !== rev) return null
          tagCache.set(key, null)
          return null
        }
        const focus = opts?.text?.trim()?.toLowerCase()
        const score = (item: { index: number; line: number }) => {
          const open = text.indexOf(">", item.index)
          const end =
            open === -1
              ? Math.min(text.length, item.index + 1600)
              : /\/\>\s*$/.test(text.slice(item.index, open + 1))
                ? open + 1
                : (() => {
                    const close = text.indexOf(`</${comp}>`, open + 1)
                    return close === -1 ? Math.min(text.length, item.index + 1600) : close + comp.length + 3
                  })()
          const area = text.slice(item.index, end).toLowerCase()
          return terms.reduce((sum, term) => {
            const low = term.toLowerCase()
            if (!area.includes(low)) return sum
            return sum + (low === focus ? 8 : low.length > 4 ? 3 : 2)
          }, 0)
        }
        const chosen = out.slice(1).reduce<{ index: number; line: number; score: number }>(
          (best, item) => {
            const next = score(item)
            if (next > best.score) return { ...item, score: next }
            return best
          },
          { ...out[0], score: score(out[0]) },
        )
        const hit = {
          file,
          line: chosen.line,
          comp,
          origin: "tag",
          score: chosen.score > 0 ? Math.min(0.95, SCORE.tag + Math.min(0.05, chosen.score * 0.005)) : SCORE.tag,
        }
        if (cur !== rev) return null
        tagCache.set(key, hit)
        console.log("[Design] Found <" + comp + "> in:", file, "line:", hit.line)
        return hit
      })
      .finally(() => {
        tagRun.delete(key)
      })
    tagRun.set(key, run)
    return run
  }

  const findTag = async (input: string, comp: string, opts?: TagOpts): Promise<Hit | null> => {
    const hit = await scanTag(input, comp, opts)
    if (!hit) return null
    return { file: hit.file, line: hit.line, comp: hit.comp, origin: "tag", score: hit.score ?? SCORE.tag }
  }

  const findTagInFiles = async (inputs: string[], comp: string, opts?: TagOpts): Promise<Hit | null> => {
    const seen = new Set<string>()
    let best: TagHit | null = null
    for (const input of inputs) {
      const file = normalizePath(input)
      if (seen.has(file)) continue
      seen.add(file)
      const hit = await scanTag(file, comp, opts)
      if (!hit) continue
      if (!best || hit.score > best.score) best = hit
    }
    if (!best) return null
    return { file: best.file, line: best.line, comp: best.comp, origin: "tag", score: best.score ?? SCORE.tag }
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

        const hit = {
          file: match.path.text,
          line: match.line_number ?? 1,
          comp,
          origin: "definition",
          score: SCORE.definition,
          ambiguous: user.length > 1,
          candidates:
            user.length > 1
              ? user.slice(0, 5).map((item) => ({
                  file: item.path.text,
                  line: item.line_number ?? 1,
                  component: comp,
                }))
              : undefined,
        }
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
          const hit = {
            file: match.path.text,
            line: match.line_number ?? 1,
            comp,
            origin: "usage",
            score: SCORE.usage,
          }
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
          const hit = {
            file: match.path.text,
            line: match.line_number ?? 1,
            origin: "text",
            score: SCORE.text,
          }
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
    const comp = info.component ?? info.source?.component ?? info.definition?.component
    if (comp) {
      const use = await findUsage(comp)
      if (use) return use
      const def = await findDefinition(comp)
      if (def) return def
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
      return {
        file: match.path.text,
        line: match.line_number ?? 1,
        origin: "grep",
        score: SCORE.grep,
      }
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
    fileCache.clear()
    fileRun.clear()
    tagCache.clear()
    tagRun.clear()
  }

  return {
    normalizePath,
    isSourceFile,
    fileDefinesComponent,
    findTag,
    findTagInFiles,
    findDefinition,
    findUsage,
    grepFallback,
    reset,
  }
}
