import fs from "fs/promises"
import { Flock } from "../../src/util/flock"

type Msg = {
  key: string
  dir: string
  staleMs?: number
  timeoutMs?: number
  baseDelayMs?: number
  maxDelayMs?: number
  holdMs?: number
  ready?: string
  active?: string
  done?: string
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

function input() {
  const raw = process.argv[2]
  if (!raw) {
    throw new Error("Missing flock worker input")
  }

  return JSON.parse(raw) as Msg
}

async function job(input: Msg) {
  if (input.ready) {
    await fs.writeFile(input.ready, String(process.pid))
  }

  if (input.active) {
    await fs.writeFile(input.active, String(process.pid), { flag: "wx" })
  }

  try {
    if (input.holdMs && input.holdMs > 0) {
      await sleep(input.holdMs)
    }

    if (input.done) {
      await fs.appendFile(input.done, "1\n")
    }
  } finally {
    if (input.active) {
      await fs.rm(input.active, { force: true })
    }
  }
}

async function main() {
  const msg = input()

  await Flock.withLock(msg.key, () => job(msg), {
    dir: msg.dir,
    staleMs: msg.staleMs,
    timeoutMs: msg.timeoutMs,
    baseDelayMs: msg.baseDelayMs,
    maxDelayMs: msg.maxDelayMs,
  })
}

await main().catch((err) => {
  const text = err instanceof Error ? (err.stack ?? err.message) : String(err)
  process.stderr.write(text)
  process.exit(1)
})
