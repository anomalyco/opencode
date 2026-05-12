import { readFile } from "node:fs/promises"
import { ModuleKind, ScriptTarget, transpileModule } from "typescript"

const cache = new Map<string, { source: string; execute: (input: unknown) => unknown }>()

function compile(source: string) {
  const js = transpileModule(source, {
    compilerOptions: {
      module: ModuleKind.ESNext,
      target: ScriptTarget.ESNext,
    },
  }).outputText
  if (/^\s*import\s/m.test(js)) throw new Error("Script imports are not supported in session script mode")
  const code = js.replace(/\bexport\s+default\s+/m, "return ")
  if (code === js) return
  return new Function(code)()
}

export async function loadScriptDefault(filepath: string) {
  const source = await readFile(filepath, "utf8").catch(() => "")
  if (!source.trim()) return
  const existing = cache.get(filepath)
  if (existing && existing.source === source) return existing.execute
  const value = compile(source)
  if (typeof value !== "function") return
  const execute = (input: unknown) => value(input)
  cache.set(filepath, {
    source,
    execute,
  })
  return execute
}
