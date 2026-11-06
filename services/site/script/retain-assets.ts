// Keeps the hashed scripts, stylesheets and fonts of the last 20 builds a deploy replaced in its
// assets, each for up to a week after it stopped being live, so a page rendered by an earlier build
// still loads the code for the next page it opens. Workers Static Assets serve only the deployed version's files and have no
// skew protection, so without this every deploy turned the open tabs' next navigation into a
// missing chunk and a full reload.
//
// The live site lists what it serves in /_build/retained.json: its own hashed files (`live`) and the
// earlier builds' it still carries (`retired`, each with when it stopped being live). script/build.ts
// calls this to read that list, download the carried files from the live site into the new build's
// assets and write the next list. Cloudflare stores assets by content hash, so carried files add
// entries to the upload manifest but no upload. If the list can't be read (the first deploy, an
// outage, a local build offline), the build carries nothing and goes on.
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"

/** How long a file stays after the last build that served it was replaced, for at most `builds` replaced builds. */
const retention = 7 * 24 * 60 * 60 * 1000
const builds = 20
/** Files named by a hash of their contents: immutable in public/_headers, safe to keep beside newer builds. */
const hashed = /^(_build\/assets\/|docs\/_build\/|textjs\/(chunk|lite|picker|yoga)-)[\w./-]+$/
const ledgerPath = "_build/retained.json"

const Ledger = z.object({
  live: z.array(z.string()),
  retired: z.record(z.string(), z.string()),
})

/** Carries the files `origin` still needs from earlier builds into `assets` and writes the next list. */
export async function retainAssets(assets: string, origin: string) {
  const live = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: assets }))).filter((file) => hashed.test(file))
  const own = new Set(live)
  const previous = await readLedger(origin)
  const now = new Date()
  const candidates = new Map([
    ...Object.entries(previous.retired),
    // The live build stops being live with this deploy.
    ...previous.live.map((file) => [file, now.toISOString()] as const),
  ])
  // Every deploy retires its files at one time, so the times name the replaced builds.
  const kept = new Set(
    [...new Set(candidates.values())]
      .filter((at) => now.getTime() - Date.parse(at) < retention)
      .toSorted()
      .slice(-builds),
  )
  const wanted = [...candidates].filter(
    ([file, at]) => kept.has(at) && hashed.test(file) && !file.split("/").includes("..") && !own.has(file),
  )
  const fetched = await mapLimit(wanted, 16, async ([file, at]) => {
    const bytes = await download(`${origin}/${file}`)
    if (!bytes) return
    await mkdir(path.dirname(path.join(assets, file)), { recursive: true })
    await Bun.write(path.join(assets, file), bytes)
    return { file, at, bytes: bytes.length }
  })
  const retired = fetched.filter((entry) => entry !== undefined)
  await Bun.write(
    path.join(assets, ledgerPath),
    JSON.stringify({ live, retired: Object.fromEntries(retired.map((entry) => [entry.file, entry.at])) }),
  )
  const megabytes = (retired.reduce((total, entry) => total + entry.bytes, 0) / 1e6).toFixed(1)
  const missing = wanted.length - retired.length
  console.log(
    `retain-assets: ${live.length} live, carried ${retired.length} from earlier builds (${megabytes} MB)` +
      (missing ? `; ${missing} couldn't be fetched from ${origin}` : ""),
  )
}

async function readLedger(origin: string) {
  const response = await fetch(`${origin}/${ledgerPath}?t=${Date.now()}`, { cache: "no-store" }).catch(() => undefined)
  const ledger = response?.ok ? Ledger.safeParse(await response.json().catch(() => undefined)) : undefined
  if (ledger?.success) return ledger.data
  const reason = ledger ? "unreadable" : response ? `HTTP ${response.status}` : "unreachable"
  console.warn(`retain-assets: ${origin}/${ledgerPath} ${reason}; carrying nothing from earlier builds`)
  return { live: [], retired: {} }
}

/** The file's bytes, trying twice; undefined once it's gone (404) or still failing. */
async function download(url: string, attempt = 1): Promise<Uint8Array | undefined> {
  const response = await fetch(url).catch(() => undefined)
  const bytes = response?.ok ? await response.bytes().catch(() => undefined) : undefined
  if (bytes || response?.status === 404 || attempt === 2) return bytes
  return download(url, attempt + 1)
}

async function mapLimit<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>) {
  const results: R[] = []
  const queue = items.entries()
  const worker = async () => {
    for (const [index, item] of queue) results[index] = await run(item)
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
