import { readdirSync, statSync } from "fs"
import { join, relative } from "path"

const EVOLUTION_SRC = "src/evolution"
const ERROR_REGISTRY_PATH = "docs/evolution/ERROR_REGISTRY.md"

const CLASS_PATTERNS = [
  /class\s+(\w+Error)\s+extends\s+Schema\.TaggedErrorClass/g,
  /class\s+(\w+Error)\s*\{[^}]*readonly\s+_tag\s*=/gs,
]

interface ErrorClass {
  name: string
  file: string
  line: number
}

async function findErrorClasses(): Promise<ErrorClass[]> {
  const files: string[] = []

  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const s = statSync(full)
      if (s.isDirectory()) walk(full)
      else if (entry.endsWith(".ts")) files.push(full)
    }
  }
  walk(EVOLUTION_SRC)

  const errors: ErrorClass[] = []

  for (const file of files) {
    const content = await Bun.file(file).text()
    const lines = content.split("\n")

    for (const pattern of CLASS_PATTERNS) {
      pattern.lastIndex = 0
      let match
      while ((match = pattern.exec(content)) !== null) {
        const name = match[1]

        if (!errors.some((e) => e.name === name && e.file === file)) {
          const lineIdx = lines.findIndex((l) => l.includes(name) && (l.includes("extends") || l.includes("_tag")))
          errors.push({ name, file: relative("src", file), line: lineIdx + 1 })
        }
      }
    }
  }

  return errors
}

async function readRegistry(): Promise<string> {
  return await Bun.file(ERROR_REGISTRY_PATH).text()
}

function isErrorRegistered(errorName: string, registry: string): boolean {
  const headingPattern = new RegExp(`###\\s+${escapeRegex(errorName)}\\b`)
  return headingPattern.test(registry)
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

async function main() {
  const errors = await findErrorClasses()
  const registry = await readRegistry()

  const unregistered: ErrorClass[] = []

  for (const err of errors) {
    if (!isErrorRegistered(err.name, registry)) {
      unregistered.push(err)
    }
  }

  if (unregistered.length > 0) {
    console.error("❌ ERROR: Unregistered error class(es) found:")
    for (const err of unregistered) {
      console.error(`   ${err.name} — defined at ${err.file}:${err.line} but missing from ${ERROR_REGISTRY_PATH}`)
    }
    console.error(`\nEach error class must be documented in ${ERROR_REGISTRY_PATH} with:`)
    console.error("   - Class name, category, source, constructor, fields, boundary status")
    console.error("   - See existing entries for format reference")
    process.exit(1)
  } else {
    const names = errors.map((e) => e.name).join(", ")
    console.log(`✅ All ${errors.length} error class(es) registered: ${names}`)
  }
}

main()
