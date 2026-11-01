import { afterEach, expect, test } from "bun:test"
import {
  contenderFinished,
  contenderPool,
  ownerState,
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
  expect(pool.shouldRecruit("absent")).toBe(false)

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
  expect(pool.shouldRecruit("absent")).toBe(true)
  expect(owner.child.exitCode).toBeNull()
})

test("a live owner that stops answering is never contested, and other owners get one spawn delay", () => {
  const timing = { ...defaultEnsureTiming, spawnDelay: 60_000 }
  expect(contenderPool(timing).shouldRecruit("absent")).toBe(true)

  const dead = contenderPool(timing)
  expect(dead.shouldRecruit("gone")).toBe(false)
  dead.recruitNow()
  expect(dead.shouldRecruit("gone")).toBe(true)

  // A live owner holds its port, so an attempt could only fail to bind and report that as the
  // startup failure of the whole ensure(). Only the recovery window may replace it.
  const unanswered = contenderPool(timing)
  expect(unanswered.shouldRecruit("unanswered")).toBe(false)
  unanswered.recruitNow()
  expect(unanswered.shouldRecruit("unanswered")).toBe(false)

  // A registration whose PID belongs to another process is no owner at all: it gets one spawn
  // delay and then a replacement, as before.
  const refusing = contenderPool(timing)
  expect(refusing.shouldRecruit("refusing")).toBe(false)
  refusing.recruitNow()
  expect(refusing.shouldRecruit("refusing")).toBe(true)
})

test("classifies a registered owner by what the probe learned", () => {
  const owner = { id: "owner", url: "http://127.0.0.1:4096", pid: 4242 }
  const answered = { timedOut: false, stalled: false }

  expect(ownerState(undefined, answered, false)).toBe("absent")
  expect(ownerState(owner, answered, false)).toBe("gone")
  expect(ownerState(owner, { timedOut: true, stalled: false }, true)).toBe("unanswered")
  // A probe that spanned a suspend says nothing about the owner, so it must not be contested.
  expect(ownerState(owner, { timedOut: false, stalled: true }, true)).toBe("unanswered")
  expect(ownerState(owner, answered, true)).toBe("refusing")
})

test("keeps at most two attempts alive", async () => {
  const pool = contenderPool({ ...defaultEnsureTiming, spawnDelay: 0 })
  const exiting = clean()
  pool.add(running())
  pool.add(exiting)
  expect(pool.shouldRecruit("absent")).toBe(false)

  await finished(exiting)
  expect(pool.reap()).toBeUndefined()
  expect(pool.shouldRecruit("absent")).toBe(true)
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
  if (Date.now() - start < 290) expect(pool.shouldRecruit("absent")).toBe(false)
  // Doubling would give 400 ms; the cap allows an attempt at 300 ms.
  await Bun.sleep(Math.max(0, 320 - (Date.now() - start)))
  expect(pool.shouldRecruit("absent")).toBe(true)
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
  expect(pool.shouldRecruit("absent")).toBe(true)
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
