export interface MathSegmentText {
  kind: "text"
  text: string
}

export interface MathSegmentMath {
  kind: "math"
  tex: string
  raw: string
}

export type MathSegment = MathSegmentText | MathSegmentMath

export interface RenderedMath {
  png: Uint8Array
  width: number
  height: number
}

export function splitMathSegments(text: string): MathSegment[] {
  if (!text.includes("$$") && !text.includes("\\[")) return [{ kind: "text", text }]

  const out: MathSegment[] = []
  let start = 0
  let i = 0
  // closing pattern for the open fenced code block, e.g. ``` or ~~~~
  let fence: RegExp | undefined

  const pushText = (end: number) => {
    if (end > start) out.push({ kind: "text", text: text.slice(start, end) })
  }

  const math = (close: number, from: number, to: number) => {
    const tex = text.slice(from + 2, close)
    if (!tex.trim()) return false
    pushText(from)
    out.push({ kind: "math", tex, raw: text.slice(from, to) })
    i = to
    start = to
    return true
  }

  while (i < text.length) {
    if (i === 0 || text[i - 1] === "\n") {
      const marker = /^[ \t]*(`{3,}|~{3,})/.exec(text.slice(i))?.[1]
      if (marker) {
        if (!fence) fence = new RegExp(`^[ \\t]*${marker[0]}{${marker.length},}`)
        else if (fence.test(text.slice(i))) fence = undefined
      }
    }
    if (!fence) {
      if (text.startsWith("$$", i) && text[i - 1] !== "\\") {
        const close = findClosing(text, "$$", i + 2)
        if (close !== -1 && math(close, i, close + 2)) continue
      }
      if (text.startsWith("\\[", i)) {
        const close = text.indexOf("\\]", i + 2)
        if (close !== -1 && math(close, i, close + 2)) continue
      }
    }
    i++
  }
  pushText(text.length)
  return out
}

function findClosing(text: string, delimiter: string, from: number) {
  let i = from
  while (true) {
    const found = text.indexOf(delimiter, i)
    if (found === -1) return -1
    if (text[found - 1] === "\\") {
      i = found + delimiter.length
      continue
    }
    return found
  }
}

const cache = new Map<string, Promise<RenderedMath | null>>()
const CACHE_LIMIT = 128

export function renderMath(tex: string, options: { color: string; fontPx: number }) {
  const key = `${options.color}|${options.fontPx}|${tex}`
  const cached = cache.get(key)
  if (cached) return cached
  const rendered = render(tex, options).catch(() => null)
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!)
  cache.set(key, rendered)
  return rendered
}

async function render(tex: string, options: { color: string; fontPx: number }) {
  const [{ Resvg }, svg] = await Promise.all([resvg(), texToSvg(tex)])
  const viewBox = /viewBox="([-\d.eE]+)\s+([-\d.eE]+)\s+([\d.eE]+)\s+([\d.eE]+)"/.exec(svg)
  if (!viewBox) throw new Error("mathjax produced svg without viewBox")
  // mathjax svg viewBox uses 1000 units per em; pin absolute pixels so resvg
  // does not resolve ex units against its own font metrics
  const scale = options.fontPx / 1000
  const width = Math.ceil(Number(viewBox[3]) * scale)
  const height = Math.ceil(Number(viewBox[4]) * scale)
  const sized = svg.replace(
    /<svg[^>]*>/,
    (tag) =>
      tag
        .replace(/\swidth="[^"]*"/, ` width="${width}"`)
        .replace(/\sheight="[^"]*"/, ` height="${height}"`)
        .replace(/<svg/, `<svg color="${options.color}"`),
  )
  const rendered = new Resvg(sized, { background: "rgba(0,0,0,0)" }).render()
  return { png: rendered.asPng(), width: rendered.width, height: rendered.height }
}

let mathjaxReady: Promise<{
  convert: (tex: string) => string
}> | undefined

function texToSvg(tex: string) {
  mathjaxReady ??= (async () => {
    const { mathjax } = await import("mathjax-full/js/mathjax.js")
    const { TeX } = await import("mathjax-full/js/input/tex.js")
    const { SVG } = await import("mathjax-full/js/output/svg.js")
    const { liteAdaptor } = await import("mathjax-full/js/adaptors/liteAdaptor.js")
    const { RegisterHTMLHandler } = await import("mathjax-full/js/handlers/html.js")
    const { AllPackages } = await import("mathjax-full/js/input/tex/AllPackages.js")
    const adaptor = liteAdaptor()
    RegisterHTMLHandler(adaptor)
    const doc = mathjax.document("", {
      InputJax: new TeX({ packages: AllPackages }),
      OutputJax: new SVG({ fontCache: "none" }),
    })
    return {
      convert: (input: string) => adaptor.innerHTML(doc.convert(input, { display: true })),
    }
  })()
  return mathjaxReady.then((instance) => instance.convert(tex))
}

let resvgReady: Promise<typeof import("@resvg/resvg-wasm")> | undefined

function resvg() {
  resvgReady ??= (async () => {
    const [mod, wasm] = await Promise.all([
      import("@resvg/resvg-wasm"),
      import("@resvg/resvg-wasm/index_bg.wasm", { with: { type: "file" } }),
    ])
    await mod.initWasm(await Bun.file(wasm.default).arrayBuffer())
    return mod
  })()
  return resvgReady
}
