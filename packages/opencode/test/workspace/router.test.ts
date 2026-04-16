// WorkspaceRouter selection: Flag > Config > "local" default, per-Instance
// caching, credentials-missing handling on vercel.

import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { WorkspaceRouter } from "../../src/workspace/router"

const cfgWith = (workspace?: { backend: "local" | "vercel"; vercel?: Record<string, unknown> }) =>
  Layer.succeed(
    Config.Service,
    Config.Service.of({
      get: () => Effect.succeed({ workspace } as unknown as Config.Info),
    } as unknown as Config.Interface),
  )

const setFlag = (value: string | undefined) => {
  if (value === undefined) delete process.env["OPENCODE_WORKSPACE_BACKEND"]
  else process.env["OPENCODE_WORKSPACE_BACKEND"] = value
}

afterEach(async () => {
  setFlag(undefined)
  await Instance.disposeAll()
})

describe("WorkspaceRouter", () => {
  test("defaults to LocalBackend when no flag and no config", async () => {
    await Instance.provide({
      directory: "/tmp/opencode-router-test",
      fn: async () => {
        const rt = ManagedRuntime.make(WorkspaceRouter.layer.pipe(Layer.provide(cfgWith())))
        try {
          const backend = await rt.runPromise(
            Effect.gen(function* () {
              return yield* (yield* WorkspaceRouter.Service).backend
            }),
          )
          expect(backend.id).toBe("local")
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("config.workspace.backend=vercel selects vercel", async () => {
    await Instance.provide({
      directory: "/tmp/opencode-router-test",
      fn: async () => {
        const rt = ManagedRuntime.make(
          WorkspaceRouter.layer.pipe(
            Layer.provide(
              cfgWith({
                backend: "vercel",
                vercel: { token: "t", teamId: "tm", projectId: "p" },
              }),
            ),
          ),
        )
        try {
          const backend = await rt.runPromise(
            Effect.gen(function* () {
              return yield* (yield* WorkspaceRouter.Service).backend
            }),
          )
          expect(backend.id).toMatch(/^vercel:/)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("Flag overrides config (flag=local beats config=vercel)", async () => {
    setFlag("local")
    await Instance.provide({
      directory: "/tmp/opencode-router-test",
      fn: async () => {
        const rt = ManagedRuntime.make(
          WorkspaceRouter.layer.pipe(
            Layer.provide(
              cfgWith({
                backend: "vercel",
                vercel: { token: "t", teamId: "tm", projectId: "p" },
              }),
            ),
          ),
        )
        try {
          const backend = await rt.runPromise(
            Effect.gen(function* () {
              return yield* (yield* WorkspaceRouter.Service).backend
            }),
          )
          expect(backend.id).toBe("local")
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("unknown flag value falls through to config", async () => {
    setFlag("garbage")
    await Instance.provide({
      directory: "/tmp/opencode-router-test",
      fn: async () => {
        const rt = ManagedRuntime.make(
          WorkspaceRouter.layer.pipe(Layer.provide(cfgWith({ backend: "local" }))),
        )
        try {
          const backend = await rt.runPromise(
            Effect.gen(function* () {
              return yield* (yield* WorkspaceRouter.Service).backend
            }),
          )
          expect(backend.id).toBe("local")
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("vercel without credentials fails with WorkspaceError", async () => {
    const saved = {
      token: process.env["VERCEL_TOKEN"],
      teamId: process.env["VERCEL_TEAM_ID"],
      projectId: process.env["VERCEL_PROJECT_ID"],
    }
    delete process.env["VERCEL_TOKEN"]
    delete process.env["VERCEL_TEAM_ID"]
    delete process.env["VERCEL_PROJECT_ID"]
    try {
      await Instance.provide({
        directory: "/tmp/opencode-router-test",
        fn: async () => {
          const rt = ManagedRuntime.make(
            WorkspaceRouter.layer.pipe(Layer.provide(cfgWith({ backend: "vercel" }))),
          )
          try {
            const exit = await rt.runPromiseExit(
              Effect.gen(function* () {
                return yield* (yield* WorkspaceRouter.Service).backend
              }),
            )
            if (exit._tag === "Success") {
              throw new Error(`expected WorkspaceError, got success: ${JSON.stringify(exit.value)}`)
            }
            const repr = JSON.stringify(exit.cause)
            expect(repr).toContain("WorkspaceError")
            expect(repr).toContain("credentials")
          } finally {
            await rt.dispose()
          }
        },
      })
    } finally {
      if (saved.token !== undefined) process.env["VERCEL_TOKEN"] = saved.token
      if (saved.teamId !== undefined) process.env["VERCEL_TEAM_ID"] = saved.teamId
      if (saved.projectId !== undefined) process.env["VERCEL_PROJECT_ID"] = saved.projectId
    }
  })

  test("per-Instance cache: two reads resolve the same backend", async () => {
    await Instance.provide({
      directory: "/tmp/opencode-router-test",
      fn: async () => {
        const rt = ManagedRuntime.make(WorkspaceRouter.layer.pipe(Layer.provide(cfgWith())))
        try {
          const pair = await rt.runPromise(
            Effect.gen(function* () {
              const router = yield* WorkspaceRouter.Service
              const a = yield* router.backend
              const b = yield* router.backend
              return [a, b] as const
            }),
          )
          expect(pair[0]).toBe(pair[1])
        } finally {
          await rt.dispose()
        }
      },
    })
  })
})
