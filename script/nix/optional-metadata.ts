import path from "path"

const argv = Bun.argv.slice(2)
const arg = argv[0] ?? "optional-packages.txt"
const root = process.cwd()
const lock = path.join(root, "bun.lock")
const file = path.isAbsolute(arg) ? arg : path.join(root, arg)

const mask = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const doc = await Bun.file(lock).text()
const text = await Bun.file(file).text()

const names = text
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.length > 0)

if (names.length === 0) {
  process.exit(0)
}

const lines = names.map((name) => {
  const safe = mask(name)
  const verMatch = doc.match(new RegExp(`"${safe}": "([^"]+)"`))
  if (!verMatch) {
    console.error(`missing-version\t${name}`)
    process.exit(1)
  }
  const ver = verMatch[1]
  const verSafe = mask(ver)
  const shaHit = doc.match(new RegExp(`"${safe}@${verSafe}"[^\\n]*"(sha512-[^"]+)"`))
  if (!shaHit) {
    console.error(`missing-sha\t${name}\t${ver}`)
    process.exit(1)
  }
  return `${name}\t${ver}\t${shaHit[1]}`
})

await Bun.write(Bun.stdout, lines.join("\n"))
