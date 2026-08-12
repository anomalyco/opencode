import { rm } from "node:fs/promises"
import { initializeInstance } from "../instance/instance.js"
import { checkScript } from "../script/tooling.js"

export async function check(file: string) {
  const artifacts = await initializeInstance()
  try {
    try {
      await checkScript(artifacts, file)
    } catch (error) {
      const source = await Bun.file(file).slice(0, 256 * 1024).text().catch(() => "")
      const hint = effectScriptHint(source, message(error))
      if (hint !== undefined) throw new Error(`${message(error)}\n\n${hint}`, { cause: error })
      throw error
    }
  } finally {
    await rm(artifacts, { recursive: true, force: true })
  }
}

export function effectScriptHint(source: string, diagnostics: string) {
  if (!/\bPromise(?:Like)?</.test(diagnostics)) return undefined
  if (!/\bdefineScript\s*\(/.test(source)) return undefined
  const relevant = diagnosticSource(source, diagnostics)
  if (/\.waitFor\s*\(/.test(relevant))
    return `${heading}

Instead of:
  ui.waitFor(async (state) => state.focused.editor)

Use:
  ui.waitFor((state) => Effect.succeed(state.focused.editor))`
  if (/\bsetup\s*:|\basync\s+setup\s*\(/.test(relevant))
    return `${heading}

Instead of:
  setup: async ({ fs }) => {
    await fs.writeFile("src/example.ts", "export {}")
  }

Use:
  setup: ({ fs }) => fs.writeFile("src/example.ts", "export {}")`
  if (/\brun\s*:|\basync\s+run\s*\(/.test(relevant))
    return `${heading}

Instead of:
  run: async ({ ui }) => {
    await ui.submit("Hello")
  }

Use:
  run: ({ ui }) =>
    Effect.gen(function* () {
      yield* ui.submit("Hello")
    })`
  return undefined
}

const heading = "OpenCode Drive scripts are Effect-only. Promise callbacks are not supported."

function diagnosticSource(source: string, diagnostics: string) {
  const lines = source.split("\n")
  const numbers = [...diagnostics.matchAll(/(?::(\d+):\d+|\((\d+),\d+\))/g)]
    .map((match) => Number(match[1] ?? match[2]))
    .filter((line) => Number.isInteger(line) && line > 0)
  return numbers.length === 0
    ? source
    : numbers.map((line) => lines[line - 1] ?? "").join("\n")
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
