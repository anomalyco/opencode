import path from "path"

const argv = Bun.argv.slice(2)
const arg = argv[0] ?? "optional-packages.txt"
const root = process.cwd()
const lock = path.join(root, "bun.lock")
const file = path.isAbsolute(arg) ? arg : path.join(root, arg)

const mask = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const doc = await Bun.file(lock).text()
const text = await Bun.file(file).text()
const hashesPath = path.join(root, "nix/hashes.json")
let optional: Record<string, { version?: string; sha512?: string; sha?: string }> = {}

try {
  // Pre-seeded metadata keeps optional bundles reproducible without network calls.
  const data = await Bun.file(hashesPath).text()
  const parsed = JSON.parse(data ?? "{}")
  if (parsed && typeof parsed.optional === "object" && parsed.optional !== null) {
    optional = parsed.optional as typeof optional
  }
} catch (error) {
  console.error(`missing-hashes\t${hashesPath}\t${(error as Error).message}`)
  process.exit(1)
}

const names = text
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.length > 0)

if (names.length === 0) {
  process.exit(0)
}

const lines: string[] = []

for (const name of names) {
  const safe = mask(name)
  const verMatch = doc.match(new RegExp(`"${safe}": "([^"]+)"`))
  const stored = optional[name] ?? {}
  const ver = stored.version ?? verMatch?.[1]
  if (!ver) {
    console.error(`missing-version\t${name}`)
    process.exit(1)
  }
  if (stored.version && verMatch && stored.version !== verMatch[1]) {
    console.error(`version-mismatch\t${name}\t${stored.version}\t${verMatch[1]}`)
    process.exit(1)
  }
  const verSafe = mask(ver)
  const shaHit = doc.match(new RegExp(`"${safe}@${verSafe}"[^\\n]*"(sha512-[^"]+)"`))
  const sha = stored.sha512 ?? stored.sha ?? shaHit?.[1]
  if (!sha) {
    console.error(`missing-sha\t${name}\t${ver}`)
    process.exit(1)
  }
  lines.push(`${name}\t${ver}\t${sha}`)
}

if (lines.length > 0) {
  await Bun.write(Bun.stdout, lines.join("\n") + "\n")
}
