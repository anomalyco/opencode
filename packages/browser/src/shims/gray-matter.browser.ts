import yaml from "js-yaml"

type FrontmatterData = Record<string, unknown>

interface GrayMatterFile<T extends FrontmatterData = FrontmatterData> {
  content: string
  data: T
  excerpt: string
  orig: string
  empty?: string
  isEmpty?: boolean
  language?: string
  matter?: string
}

type GrayMatterInput = string | { content: string }
type GrayMatterOptions = {
  delimiters?: string | [string, string]
  language?: string
}

function resolveDelimiters(options?: GrayMatterOptions): [string, string] {
  if (!options?.delimiters) return ["---", "---"]
  if (Array.isArray(options.delimiters)) return options.delimiters
  return [options.delimiters, options.delimiters]
}

function toFile(input: GrayMatterInput): GrayMatterFile {
  const content = typeof input === "string" ? input : input.content
  return {
    content,
    data: {},
    excerpt: "",
    orig: content,
  }
}

function parseFrontmatter<T extends FrontmatterData = FrontmatterData>(
  input: GrayMatterInput,
  options?: GrayMatterOptions,
): GrayMatterFile<T> {
  const file = toFile(input) as GrayMatterFile<T>
  const [open, close] = resolveDelimiters(options)

  if (file.content === "") {
    return file
  }

  if (!file.content.startsWith(open)) {
    return file
  }

  const newlineMatch = /^\r?\n/.exec(file.content.slice(open.length))
  if (!newlineMatch) {
    return file
  }

  const frontmatterStart = open.length + newlineMatch[0].length
  const closeMarker = `\n${close}`
  let closeIndex = file.content.indexOf(closeMarker, frontmatterStart)
  if (closeIndex === -1 && file.content.startsWith(`${open}\r\n`)) {
    closeIndex = file.content.indexOf(`\r\n${close}`, frontmatterStart)
  }
  if (closeIndex === -1) {
    return file
  }

  const rawMatter = file.content.slice(frontmatterStart, closeIndex)
  file.matter = rawMatter
  file.language = options?.language ?? "yaml"

  const stripped = rawMatter.replace(/^\s*#[^\n]+/gm, "").trim()
  if (stripped === "") {
    file.isEmpty = true
    file.empty = file.orig
    file.data = {} as T
  } else {
    const parsed = yaml.load(rawMatter)
    file.data = (parsed && typeof parsed === "object" ? parsed : {}) as T
  }

  let body = file.content.slice(closeIndex + closeMarker.length)
  if (body.startsWith("\r\n")) body = body.slice(2)
  else if (body.startsWith("\n")) body = body.slice(1)
  file.content = body
  return file
}

function stringifyFrontmatter(
  input: GrayMatterInput,
  data: FrontmatterData = {},
  options?: GrayMatterOptions,
): string {
  const file = parseFrontmatter(input, options)
  const [open, close] = resolveDelimiters(options)
  const frontmatter = yaml.dump(data, {
    lineWidth: -1,
    noRefs: true,
  }).trimEnd()
  if (!frontmatter) {
    return file.content
  }
  if (!file.content) {
    return `${open}\n${frontmatter}\n${close}\n`
  }
  return `${open}\n${frontmatter}\n${close}\n${file.content}`
}

type GrayMatterFn = typeof parseFrontmatter & {
  cache: Record<string, GrayMatterFile>
  clearCache(): void
  language(str: string): { raw: string; name: string }
  read(_filepath: string): never
  stringify(input: GrayMatterInput, data?: FrontmatterData, options?: GrayMatterOptions): string
  test(str: string, options?: GrayMatterOptions): boolean
}

const matter = parseFrontmatter as GrayMatterFn

matter.cache = {}
matter.clearCache = () => {
  matter.cache = {}
}
matter.test = (str: string, options?: GrayMatterOptions) => {
  const [open] = resolveDelimiters(options)
  return str.startsWith(open)
}
matter.language = (str: string) => {
  const raw = str.slice(0, str.search(/\r?\n/))
  return {
    raw,
    name: raw.trim(),
  }
}
matter.read = () => {
  throw new Error("gray-matter.read is unavailable in browser mode")
}
matter.stringify = stringifyFrontmatter

export default matter
