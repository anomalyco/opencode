import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { runtime, runPromiseInstance } from "../../src/effect/runtime"
import { Auth } from "../../src/auth/effect"
import { Instances } from "../../src/effect/instances"
import { Instance } from "../../src/project/instance"
import { ProviderAuth } from "../../src/provider/auth"
import { Vcs } from "../../src/project/vcs"
import { Question } from "../../src/question"
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

  test("instance services with global deps share the global (ProviderAuth → Auth)", async () => {
    await using one = await tmpdir({ git: true })
    await using two = await tmpdir({ git: true })

    // ProviderAuth depends on Auth via defaultLayer.
    // The instance service itself should be different per directory,
    // but the underlying Auth should be shared.
    const paOne = await Instance.provide({
      directory: one.path,
      fn: () => grabInstance(ProviderAuth.Service),
    })

    const paTwo = await Instance.provide({
      directory: two.path,
      fn: () => grabInstance(ProviderAuth.Service),
    })

    // Different directories → different ProviderAuth instances.
    expect(paOne).not.toBe(paTwo)

    // But the global Auth is the same object in both.
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
        expect(await grabInstance(Vcs.Service)).toBe(await grabInstance(Vcs.Service))
        expect(await grabInstance(Question.Service)).toBe(await grabInstance(Question.Service))
      },
    })
  })

  test("different directories get different service instances", async () => {
    await using one = await tmpdir({ git: true })
    await using two = await tmpdir({ git: true })

    const vcsOne = await Instance.provide({
      directory: one.path,
      fn: () => grabInstance(Vcs.Service),
    })

    const vcsTwo = await Instance.provide({
      directory: two.path,
      fn: () => grabInstance(Vcs.Service),
    })

    expect(vcsOne).not.toBe(vcsTwo)
  })

  test("disposal rebuilds services with a new instance", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const before = await grabInstance(Question.Service)

        await runtime.runPromise(Instances.use((map) => map.invalidate(Instance.directory)))

        const after = await grabInstance(Question.Service)
        expect(after).not.toBe(before)
      },
    })
  })
})
