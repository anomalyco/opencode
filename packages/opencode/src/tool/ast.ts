import { Lang, parse, pattern, type NapiConfig, type SgNode } from "@ast-grep/napi"
import path from "path"
import z from "zod"
import { Ripgrep } from "../file/ripgrep"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"

export const AstLang = z.enum(["typescript", "tsx", "javascript", "jsx"])
export type AstLang = z.infer<typeof AstLang>

export type AstHit = {
  path: string
  line: number
  text: string
  mtime: number
}

const MAX_TEXT = 2000

const langs = {
  typescript: { lang: Lang.TypeScript, globs: ["*.ts"] },
  tsx: { lang: Lang.Tsx, globs: ["*.tsx"] },
  javascript: { lang: Lang.JavaScript, globs: ["*.js"] },
  jsx: { lang: Lang.Tsx, globs: ["*.jsx"] },
} as const satisfies Record<AstLang, { lang: Lang; globs: string[] }>

export function langInfo(lang: AstLang) {
  return langs[lang]
}

export function resolveTarget(input?: string) {
  const next = input ?? Instance.directory
  return path.isAbsolute(next) ? next : path.resolve(Instance.directory, next)
}

export function buildMatcher(lang: AstLang, input: string) {
  try {
    return pattern(langInfo(lang).lang, input.replaceAll("\r\n", "\n"))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Invalid AST pattern: ${msg}`)
  }
}

function snippet(input: string) {
  const next = input.replace(/\r?\n/g, "\\n")
  return next.length > MAX_TEXT ? next.slice(0, MAX_TEXT) + "..." : next
}

function nodeHit(file: string, mtime: number, node: SgNode) {
  return {
    path: file,
    line: node.range().start.line + 1,
    text: snippet(node.text()),
    mtime,
  }
}

async function scanFile(input: { file: string; lang: AstLang; matcher: NapiConfig; abort?: AbortSignal; mtime?: number }) {
  input.abort?.throwIfAborted()
  try {
    const root = parse(langInfo(input.lang).lang, await Filesystem.readText(input.file))
    const mtime = input.mtime ?? Filesystem.stat(input.file)?.mtime.getTime() ?? 0
    return root.root().findAll(input.matcher).map((node) => nodeHit(input.file, mtime, node))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to parse ${input.file}: ${msg}`)
  }
}

async function scanDir(input: { path: string; lang: AstLang; matcher: NapiConfig; abort?: AbortSignal }) {
  const out: AstHit[] = []
  for await (const rel of Ripgrep.files({
    cwd: input.path,
    glob: langInfo(input.lang).globs,
    signal: input.abort,
  })) {
    input.abort?.throwIfAborted()
    const file = path.join(input.path, rel)
    const stat = Filesystem.stat(file)
    if (!stat?.isFile()) continue
    out.push(...(await scanFile({ file, lang: input.lang, matcher: input.matcher, abort: input.abort, mtime: stat.mtime.getTime() })))
  }
  return out
}

export async function searchAst(input: { path: string; lang: AstLang; matcher: NapiConfig; abort?: AbortSignal }) {
  const stat = Filesystem.stat(input.path)
  if (!stat) throw new Error(`Path not found: ${input.path}`)
  if (stat.isDirectory()) return scanDir(input)
  if (!stat.isFile()) return []
  return scanFile({ file: input.path, lang: input.lang, matcher: input.matcher, abort: input.abort, mtime: stat.mtime.getTime() })
}
