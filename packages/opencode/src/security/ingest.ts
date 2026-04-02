import path from "path"
import { PDFParse } from "pdf-parse"
import { Glob } from "@/util/glob"
import { Filesystem } from "@/util/filesystem"

const SKIP = [".git", "node_modules", "dist", "build", "coverage", ".next", ".turbo", ".idea", ".vscode"]
const TEXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".env",
  ".md",
  ".txt",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".rb",
  ".php",
  ".tf",
  ".sql",
  ".sh",
  ".zsh",
  ".bash",
  ".xml",
  ".html",
  ".css",
  ".scss",
  ".dockerfile",
])

function skip(file: string) {
  const parts = file.split(path.sep)
  return SKIP.some((dir) => parts.includes(dir))
}

function ext(file: string) {
  const low = file.toLowerCase()
  const base = path.basename(low)
  if (base === "readme" || base === "license" || base === "dockerfile" || base === "makefile") return ".txt"
  if (base === ".gitignore" || base === ".dockerignore" || base === ".editorconfig") return ".txt"
  if (low.endsWith("dockerfile")) return ".dockerfile"
  return path.extname(low)
}

async function pdf(file: string) {
  const buf = await Filesystem.readArrayBuffer(file)
  const parser = new PDFParse({ data: buf })
  try {
    const out = await parser.getText()
    return out.text
  } finally {
    await parser.destroy().catch(() => {})
  }
}

export async function ingest(input: { path: string; max: number }) {
  const target = path.resolve(input.path)
  const stat = Filesystem.stat(target)
  if (!stat) throw new Error(`Input not found: ${input.path}`)

  if (!stat.isDirectory()) {
    if (ext(target) === ".pdf") {
      const text = await pdf(target)
      return { target, files: [{ path: target, text }], text: text.slice(0, input.max), clipped: text.length > input.max }
    }
    const text = await Filesystem.readText(target)
    return { target, files: [{ path: target, text }], text: text.slice(0, input.max), clipped: text.length > input.max }
  }

  const list = await Glob.scan("**/*", { cwd: target, absolute: true, include: "file", dot: false })
  const files: { path: string; text: string }[] = []
  let all = ""
  for (const file of list) {
    if (skip(file)) continue
    const kind = ext(file)
    if (kind === ".pdf") {
      const text = await pdf(file).catch(() => "")
      if (!text.trim()) continue
      files.push({ path: file, text })
    }
    if (!TEXT.has(kind)) continue
    const text = await Filesystem.readText(file).catch(() => "")
    if (!text.trim()) continue
    files.push({ path: file, text })
  }

  for (const file of files) {
    const rel = path.relative(target, file.path) || path.basename(file.path)
    const block = `\n\n# FILE: ${rel}\n${file.text}`
    if ((all + block).length > input.max) {
      const remain = input.max - all.length
      if (remain > 0) all += block.slice(0, remain)
      return { target, files, text: all, clipped: true }
    }
    all += block
  }
  return { target, files, text: all, clipped: false }
}
