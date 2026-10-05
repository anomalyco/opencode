import { afterEach, expect, test } from "bun:test"
import {
  contenderFinished,
  contenderPool,
  type ServiceContender,
  spawnServiceContender,
} from "../src/service-contender"
import { defaultEnsureTiming } from "../src/service-timing"

const spawned: ServiceContender[] = []
afterEach(() => {
  spawned.splice(0).forEach((contender) => {
    contender.release()
    contender.child.kill("SIGKILL")
  })
})

test("remembers the first startup failure and reports it once no attempt is left", async () => {
  const pool = contenderPool({ ...defaultEnsureTiming, spawnDelay: 0 })
  const survivor = running()
  const failed = failing("first failure")
  pool.add(survivor)
  pool.add(failed)
  await finished(failed)

  expect(pool.reap()).toBeUndefined()
  expect(pool.failure()?.message).toContain("first failure")
  expect(pool.shouldRecruit(false)).toBe(false)

  survivor.child.kill("SIGKILL")
  await finished(survivor)
  expect(pool.reap()?.message).toContain("first failure")
})

test("evicting a replaced owner forgets its failure and restarts the spawn clock", async () => {
  const pool = contenderPool({ ...defaultEnsureTiming, spawnDelay: 60_000 })
  const owner = running()
  const failed = failing("old failure")
  pool.add(owner)
  pool.add(failed)
  await finished(failed)
  expect(pool.reap()).toBeUndefined()
  expect(pool.failure()).toBeDefined()

  pool.evict(owner.child.pid!)

  expect(pool.failure()).toBeUndefined()
  expect(pool.reap()).toBeUndefined()
  expect(pool.shouldRecruit(false)).toBe(true)
  expect(owner.child.exitCode).toBeNull()
})

test("an unanswered registration gets one spawn delay before an attempt competes", () => {
  const timing = { ...defaultEnsureTiming, spawnDelay: 60_000 }
  expect(contenderPool(timing).shouldRecruit(false)).toBe(true)

  const registered = contenderPool(timing)
  expect(registered.shouldRecruit(true)).toBe(false)
  registered.recruitNow()
  expect(registered.shouldRecruit(true)).toBe(true)
})

test("keeps at most two attempts alive", async () => {
  const pool = contenderPool({ ...defaultEnsureTiming, spawnDelay: 0 })
  const exiting = clean()
  pool.add(running())
  pool.add(exiting)
  expect(pool.shouldRecruit(false)).toBe(false)

  await finished(exiting)
  expect(pool.reap()).toBeUndefined()
  expect(pool.shouldRecruit(false)).toBe(true)
})

test("clean exits back off up to the maximum spawn delay", async () => {
  const pool = contenderPool({ ...defaultEnsureTiming, spawnDelay: 200, maxSpawnDelay: 300 })
  const exiting = clean()
  pool.add(exiting)
  const start = Date.now()
  await finished(exiting)
  expect(pool.reap()).toBeUndefined()

  // The base delay (200 ms) has passed, but the backed-off delay (300 ms) has not, unless a
  // loaded machine overslept past it.
  await Bun.sleep(Math.max(0, 250 - (Date.now() - start)))
  if (Date.now() - start < 290) expect(pool.shouldRecruit(false)).toBe(false)
  // Doubling would give 400 ms; the cap allows an attempt at 300 ms.
  await Bun.sleep(Math.max(0, 320 - (Date.now() - start)))
  expect(pool.shouldRecruit(false)).toBe(true)
})

test("an answering service resets the backoff to the base spawn delay", async () => {
  const pool = contenderPool({ ...defaultEnsureTiming, spawnDelay: 200, maxSpawnDelay: 1_000 })
  const exiting = clean()
  pool.add(exiting)
  const start = Date.now()
  await finished(exiting)
  expect(pool.reap()).toBeUndefined()

  pool.serviceAnswered()
  // Backed off, the next attempt would wait 400 ms; after the reset it waits the base 200 ms.
  await Bun.sleep(Math.max(0, 250 - (Date.now() - start)))
  expect(pool.shouldRecruit(false)).toBe(true)
})

function spawn(code: string) {
  const contender = spawnServiceContender(process.execPath, ["-e", code])
  spawned.push(contender)
  return contender
}

function running() {
  return spawn("setTimeout(() => {}, 60_000)")
}

function failing(message: string) {
  return spawn(`console.error(${JSON.stringify(message)}); process.exit(1)`)
}

function clean() {
  return spawn("process.exit(0)")
}

async function finished(contender: ServiceContender) {
  while (!contenderFinished(contender)) await Bun.sleep(5)
}
