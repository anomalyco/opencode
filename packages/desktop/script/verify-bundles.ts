import path from "node:path"
import { Script, SourceTextModule } from "node:vm"

const targets = ["main", "preload"] as const

// Parses every built main and preload bundle without executing it, catching syntax and early
// redeclaration errors even in chunks that the app loads lazily at runtime.
export async function verifyBundles(outDir: string) {
  const glob = new Bun.Glob("**/*.{js,cjs,mjs}")
  const failures: string[] = []

  for (const target of targets) {
    const dir = path.join(outDir, target)
    const files = await Array.fromAsync(glob.scan({ cwd: dir, onlyFiles: true })).catch(() => [])

    if (files.length === 0) throw new Error(`Expected built chunks in ${dir}, found none`)

    const errors = await Promise.all(
      files.sort().map(async (file) => {
        const label = `${target}/${file.replaceAll("\\", "/")}`
        const error = parseError(await Bun.file(path.join(dir, file)).text(), label)

        return error ? `${label}: ${error}` : undefined
      }),
    )

    failures.push(...errors.filter((item): item is string => item !== undefined))
  }

  if (failures.length > 0) throw new Error(`Desktop bundle syntax check failed:\n${failures.join("\n")}`)
}

function parseError(code: string, identifier: string) {
  const source = code.replace(/^#!.*\r?\n/, "\n")

  try {
    if (identifier.endsWith(".cjs")) {
      new Script(`(function (exports, require, module, __filename, __dirname) { ${source}\n})`, {
        filename: identifier,
      })

      return undefined
    }

    new SourceTextModule(source, { identifier })

    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
