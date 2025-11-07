import { join } from "path"
import { lstat, lutimes, readdir, utimes } from "fs/promises"

const argv = Bun.argv.slice(2)
const root = process.cwd()
const base = argv[0] ?? "node_modules"
const target = join(root, base)
const epochRaw = Bun.env.SOURCE_DATE_EPOCH ?? "1"
const epoch = Number.parseInt(epochRaw, 10)

if (!Number.isFinite(epoch)) {
  console.error(`[normalize-node-modules] invalid SOURCE_DATE_EPOCH: ${epochRaw}`)
  process.exit(1)
}

const seen = new Set<string>()
const stack = [target]

while (stack.length > 0) {
  const next = stack.pop()
  if (!next) continue
  if (seen.has(next)) continue
  seen.add(next)
  const info = await lstat(next)
  if (info.isDirectory()) {
    const entries = await readdir(next)
    for (const entry of entries) {
      stack.push(join(next, entry))
    }
  }
  if (info.isSymbolicLink()) {
    await lutimes(next, epoch, epoch)
    continue
  }
  await utimes(next, epoch, epoch)
}

console.log("[normalize-node-modules] normalized timestamps for", seen.size, "paths")
