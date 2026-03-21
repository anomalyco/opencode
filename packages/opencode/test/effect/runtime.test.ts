import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { runtime, runPromiseInstance } from "../../src/effect/runtime"
import { Auth } from "../../src/auth/effect"
import { Instances } from "../../src/effect/instances"
import { File } from "../../src/file/service"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

/**
 * Integration tests for the Effect runtime and LayerMap-based instance system.
 *
 * Each instance service layer has `.pipe(Layer.fresh)` at its definition site
 * so it is always rebuilt per directory, while shared dependencies are provided
 * outside the fresh boundary and remain memoizable.
 *
 * These tests verify the invariants using object identity (===) on the real
 * production services — not mock services or return-value checks.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const grabInstance = (service: any) => runPromiseInstance(service.use(Effect.succeed))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const grabGlobal = (service: any) => runtime.runPromise(service.use(Effect.succeed))

describe("effect/runtime", () => {
  afterEach(async () => {
    await Instance.disposeAll()
  })

  test("global services are shared across directories", async () => {
    await using one = await tmpdir({ git: true })
    await using two = await tmpdir({ git: true })

    // Auth is a global service — it should be the exact same object
    // regardless of which directory we're in.
    const authOne = await Instance.provide({
      directory: one.path,
      fn: () => grabGlobal(Auth.Service),
    })

    const authTwo = await Instance.provide({
      directory: two.path,
      fn: () => grabGlobal(Auth.Service),
    })

    expect(authOne).toBe(authTwo)
  })

  test("global services are shared with the same auth dependency", async () => {
    await using one = await tmpdir({ git: true })
    await using two = await tmpdir({ git: true })

    const authOne = await Instance.provide({
      directory: one.path,
      fn: () => grabGlobal(Auth.Service),
    })
    const authTwo = await Instance.provide({
      directory: two.path,
      fn: () => grabGlobal(Auth.Service),
    })
    expect(authOne).toBe(authTwo)
  })

  test("instance services are shared within the same directory", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(await grabInstance(File.Service)).toBe(await grabInstance(File.Service))
      },
    })
  })

  test("different directories get different service instances", async () => {
    await using one = await tmpdir({ git: true })
    await using two = await tmpdir({ git: true })

    const vcsOne = await Instance.provide({
      directory: one.path,
      fn: () => grabInstance(File.Service),
    })

    const vcsTwo = await Instance.provide({
      directory: two.path,
      fn: () => grabInstance(File.Service),
    })

    expect(vcsOne).not.toBe(vcsTwo)
  })

  test("disposal rebuilds services with a new instance", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const before = await grabInstance(File.Service)

        await runtime.runPromise(Instances.use((map) => map.invalidate(Instance.directory)))

        const after = await grabInstance(File.Service)
        expect(after).not.toBe(before)
      },
    })
  })
})
