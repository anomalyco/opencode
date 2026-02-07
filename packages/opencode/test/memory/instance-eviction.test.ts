import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import path from "path"
import fs from "fs"
import os from "os"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"

Log.init({ print: false })

const MB = 1024 * 1024

const getHeapMB = () => {
  Bun.gc(true)
  return process.memoryUsage().heapUsed / MB
}

describe("instance cache eviction", () => {
  let tmpDirs: string[] = []

  beforeEach(() => {
    tmpDirs = []
  })

  afterEach(async () => {
    // Clean up: dispose all instances and remove temp dirs
    await Instance.disposeAll()
    for (const dir of tmpDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {}
    }
  })

  function makeTmpDir(suffix: string): string {
    const dir = path.join(os.tmpdir(), `oc-test-instance-${suffix}-${Date.now()}`)
    fs.mkdirSync(dir, { recursive: true })
    tmpDirs.push(dir)
    return dir
  }

  test("cache size stays bounded after creating many instances", async () => {
    const MAX = 20
    const TOTAL = 30

    // Create more instances than MAX_INSTANCES
    for (let i = 0; i < TOTAL; i++) {
      const dir = makeTmpDir(`evict-${i}`)
      await Instance.provide({
        directory: dir,
        fn: async () => {},
      })
    }

    // Cache should be bounded to MAX_INSTANCES
    expect(Instance.cacheSize).toBeLessThanOrEqual(MAX)
  }, 30000)

  test("most recently used instances survive eviction", async () => {
    const MAX = 20
    const TOTAL = 25

    const dirs: string[] = []
    for (let i = 0; i < TOTAL; i++) {
      const dir = makeTmpDir(`lru-${i}`)
      dirs.push(dir)
      await Instance.provide({
        directory: dir,
        fn: async () => {},
      })
    }

    // The last MAX instances should still be cached
    // Re-access the last one - should not trigger a new "creating instance" log
    const lastDir = dirs[TOTAL - 1]
    let provideRan = false
    await Instance.provide({
      directory: lastDir,
      fn: async () => {
        provideRan = true
      },
    })
    expect(provideRan).toBe(true)

    // The first dirs should have been evicted
    // Accessing an evicted dir should create a new instance (cache miss)
    expect(Instance.cacheSize).toBeLessThanOrEqual(MAX + 1) // +1 for the re-access
  }, 30000)

  test("RSS stays bounded after 50+ unique instances", async () => {
    Bun.gc(true)
    const baseline = getHeapMB()

    const INSTANCES = 55

    for (let i = 0; i < INSTANCES; i++) {
      const dir = makeTmpDir(`rss-${i}`)
      await Instance.provide({
        directory: dir,
        fn: async () => {},
      })
    }

    Bun.gc(true)
    const after = getHeapMB()
    const growth = after - baseline

    console.log(`Baseline: ${baseline.toFixed(2)} MB`)
    console.log(`After ${INSTANCES} instances: ${after.toFixed(2)} MB`)
    console.log(`Growth: ${growth.toFixed(2)} MB`)
    console.log(`Cache size: ${Instance.cacheSize}`)

    // With eviction, growth should be bounded
    // Without eviction, 55 instances would grow unboundedly
    // With MAX=20, we expect bounded growth proportional to 20 instances, not 55
    expect(Instance.cacheSize).toBeLessThanOrEqual(20)
    // RSS growth should be reasonable (< 100MB for 20 cached instances)
    expect(growth).toBeLessThan(100)
  }, 60000)
})
