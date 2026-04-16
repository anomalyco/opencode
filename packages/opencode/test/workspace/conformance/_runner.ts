// Backend conformance runner. Picks the Backend implementation from
// OPENCODE_CONFORMANCE_BACKEND (local / throwing / vercel), registers
// one `describe` per `conformance(name, body)` call, and fails the
// run if any test fails or zero tests ran.

import { afterAll, beforeAll, describe, test } from "bun:test"
import { Effect, Exit, Layer, ManagedRuntime, Scope } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import * as CrossSpawnSpawner from "../../../src/effect/cross-spawn-spawner"
import { LocalBackend } from "../../../src/workspace/backends/local"
import { VercelBackend } from "../../../src/workspace/backends/vercel"
import { THROWING_BACKEND_MARKER, ThrowingBackend } from "../../../src/workspace/testing/throwing-backend"
import type { Workspace as WorkspaceTypes } from "../../../src/workspace/types"
import { Workspace } from "../../../src/workspace"
import { WorkspaceRouter } from "../../../src/workspace/router"
import {
  WorkspaceBus,
  WorkspaceFormat,
  WorkspaceLsp,
} from "../../../src/workspace/internal-services"
import { WorkspaceError } from "../../../src/workspace/workspace-error"
import { Sandbox } from "@vercel/sandbox"

export type BackendKind = "local" | "throwing" | "vercel"

const rawKind = (process.env["OPENCODE_CONFORMANCE_BACKEND"] ?? "").trim().toLowerCase()
export const BACKEND_KIND: BackendKind = ((): BackendKind => {
  if (rawKind === "local" || rawKind === "throwing" || rawKind === "vercel") return rawKind
  return "local"
})()

export interface ConformanceContext {
  readonly kind: BackendKind
  readonly backend: WorkspaceTypes.Backend
  // Primitives (L3) wired over the selected backend via a test-only
  // WorkspaceRouter layer. Use this instead of `backend` to exercise
  // the same surface tools consume.
  readonly ws: Workspace.Primitives.Interface
  /**
   * The Workspace.Service.Tag interface (Primitives + null orchestration).
   * Used by service-write-ok.test.ts to assert the writeFile →
   * {diagnostics} contract.
   */
  readonly svc: Workspace.Service.Interface
  /**
   * How long the watch test should wait for an event before giving
   * up. Local backends use the upstream parcel watcher which fires in
   * <100ms; vercel polls every `watchPollMs` and round-trips through
   * the sandbox API, so the test budget needs to be `pollMs * 3` or
   * more.
   */
  readonly watchTimeoutMs: number
  /**
   * Expect the effect to fail at the Backend seam on the throwing
   * backend, or succeed on local / vercel. Returns the success value
   * on local / vercel, or a marker object on throwing.
   */
  readonly expectSubstrateOrSuccess: <A, E>(
    eff: Effect.Effect<A, E>,
  ) => Promise<A | { marker: typeof THROWING_BACKEND_MARKER }>
  /**
   * Same shape as expectSubstrateOrSuccess but for effects that carry
   * the L3 WorkspaceError channel instead of the raw BackendError one.
   * The throwing backend's BackendError is mapped through Primitives
   * into a WorkspaceError whose `cause` preserves the marker string,
   * so we look inside the cause rather than the tagged error.
   */
  readonly expectWorkspaceSubstrateOrSuccess: <A, E>(
    eff: Effect.Effect<A, E>,
  ) => Promise<A | { marker: typeof THROWING_BACKEND_MARKER }>
}

// Narrowing guard for the throwing-backend marker returned by
// `expectSubstrateOrSuccess` / `expectWorkspaceSubstrateOrSuccess`.
export const isMarker = (v: unknown): v is { marker: string } =>
  typeof v === "object" && v !== null && "marker" in (v as object)

// ---------------- counters ----------------

const counters = { pass: 0, fail: 0, skip: 0 }

// ---------------- backend lifecycle ----------------

interface RuntimeState {
  readonly backend: WorkspaceTypes.Backend
  readonly release: () => Promise<void>
  readonly watchTimeoutMs: number
}

let runtimeState: RuntimeState | null = null
let runtimeInitPromise: Promise<RuntimeState> | null = null

const initLocal = async (): Promise<RuntimeState> => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "opencode-conformance-local-"))
  const rt = ManagedRuntime.make(CrossSpawnSpawner.defaultLayer)
  const scope = Effect.runSync(Scope.make())
  const backend = await rt.runPromise(
    LocalBackend.make({ worktree: tmp }).pipe(Effect.provideService(Scope.Scope, scope)),
  )
  return {
    backend,
    watchTimeoutMs: 3000,
    release: async () => {
      try {
        await Effect.runPromise(Scope.close(scope, Exit.void))
      } catch {}
      try {
        await rt.dispose()
      } catch {}
      try {
        rmSync(tmp, { recursive: true, force: true })
      } catch {}
    },
  }
}

const initThrowing = async (): Promise<RuntimeState> => ({
  backend: ThrowingBackend.make(path.join(os.tmpdir(), "opencode-conformance-throwing")),
  watchTimeoutMs: 3000,
  release: async () => {},
})

const initVercel = async (): Promise<RuntimeState> => {
  const token = process.env["VERCEL_TOKEN"]
  const teamId = process.env["VERCEL_TEAM_ID"]
  const projectId = process.env["VERCEL_PROJECT_ID"]
  if (!token || !teamId || !projectId) {
    throw new Error(
      "vercel conformance requires VERCEL_TOKEN/VERCEL_TEAM_ID/VERCEL_PROJECT_ID",
    )
  }
  // One fresh sandbox per process invocation. Using a random testId
  // keeps concurrent file runs isolated from each other.
  const testId = `conformance-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const directory = `/conformance/${testId}`
  // Faster polling than the doc's 1000ms default to give the
  // hard-coded 3000ms test timeout (3 polls + jitter + sandbox RTT)
  // some slack on vercel.
  const watchPollMs = 500
  const backend = await Effect.runPromise(
    VercelBackend.make({
      token,
      teamId,
      projectId,
      directory,
      snapshotId: process.env["VERCEL_SANDBOX_IMAGE_ID"],
      timeoutMs: 10 * 60 * 1000,
      watchPollMs,
    }),
  )
  // Pre-create the workspace root so writeFile inside rootPath works
  // even when the sandbox starts blank.
  await Effect.runPromise(
    backend.mkDir(backend.rootPath, { recursive: true }).pipe(Effect.ignore),
  )
  return {
    backend,
    // Doc: the watch test should tolerate `pollMs * 3` latency on
    // vercel. Bump generously to absorb network jitter.
    watchTimeoutMs: Math.max(3000, watchPollMs * 5),
    release: async () => {
      try {
        const sb = await Sandbox.get({
          name: VercelBackend.nameFor(directory),
          token,
          teamId,
          projectId,
        })
        await sb.stop()
      } catch {}
    },
  }
}

const ensureRuntime = (): Promise<RuntimeState> => {
  if (runtimeState) return Promise.resolve(runtimeState)
  if (!runtimeInitPromise) {
    if (BACKEND_KIND === "vercel") {
      runtimeInitPromise = initVercel()
    } else if (BACKEND_KIND === "throwing") {
      runtimeInitPromise = initThrowing()
    } else {
      runtimeInitPromise = initLocal()
    }
    runtimeInitPromise.then((s) => {
      runtimeState = s
    })
  }
  return runtimeInitPromise
}

// ---------------- invariant installer ----------------

// The invariant runs once at process exit. bun:test's afterAll runs
// per-file, which means it fires before sibling conformance files have
// loaded, so the cumulative counters are not yet known. Installing a
// node `exit` handler lets us assert on the final totals after every
// test file has run.
let invariantInstalled = false

const installFinalInvariant = () => {
  if (invariantInstalled) return
  invariantInstalled = true

  // Per-file cleanup: release the backend + tmpdir if this file was the
  // last to touch it. Safe to call multiple times.
  afterAll(async () => {
    if (runtimeState) {
      const state = runtimeState
      runtimeState = null
      runtimeInitPromise = null
      await state.release()
    }
  })

  process.on("exit", () => {
    const { pass, fail } = counters
    if (fail > 0) {
      console.error(`conformance[${BACKEND_KIND}]: ${fail} test(s) failed`)
      process.exitCode = 1
      return
    }
    // Zero-passes means the test registrar never ran — treat as failure.
    if (pass === 0) {
      console.error(`conformance[${BACKEND_KIND}]: no tests ran`)
      process.exitCode = 1
    }
  })
}

// Test-only layer wiring: given a concrete Backend, build
// Workspace.Primitives.Service + Workspace.Service.Tag that forward
// to it. Fakes WorkspaceRouter with Layer.succeed — no Config/Instance
// involvement.

const fixedRouterLayer = (backend: WorkspaceTypes.Backend): Layer.Layer<WorkspaceRouter.Service> =>
  Layer.succeed(
    WorkspaceRouter.Service,
    WorkspaceRouter.Service.of({
      backend: Effect.succeed(backend) as Effect.Effect<WorkspaceTypes.Backend, WorkspaceError>,
    }),
  )

const buildPrimitivesAndService = async (
  backend: WorkspaceTypes.Backend,
): Promise<{
  ws: Workspace.Primitives.Interface
  svc: Workspace.Service.Interface
  release: () => Promise<void>
}> => {
  const layer = Layer.mergeAll(
    Workspace.Primitives.layer.pipe(Layer.provide(fixedRouterLayer(backend))),
    Workspace.Service.layer.pipe(
      Layer.provide(Workspace.Primitives.layer.pipe(Layer.provide(fixedRouterLayer(backend)))),
      Layer.provide(WorkspaceFormat.nullLayer),
      Layer.provide(WorkspaceBus.nullLayer),
      Layer.provide(WorkspaceLsp.nullLayer),
    ),
  )
  const rt = ManagedRuntime.make(layer)
  const ws = await rt.runPromise(Effect.gen(function* () {
    return yield* Workspace.Primitives.Service
  }))
  const svc = await rt.runPromise(Effect.gen(function* () {
    return yield* Workspace.Service.Tag
  }))
  return {
    ws,
    svc,
    release: async () => {
      try {
        await rt.dispose()
      } catch {}
    },
  }
}

// ---------------- public API ----------------

interface RegisterTest {
  (name: string, fn: (ctx: ConformanceContext) => void | Promise<void>): void
}

/**
 * Register a named conformance suite. `body` is invoked synchronously
 * at module-load time with a `test` helper that registers bun tests
 * lazily against the current backend. The backend is created in a
 * `beforeAll` and disposed at the end of the whole conformance run.
 */
export const conformance = (
  name: string,
  body: (register: RegisterTest, kind: BackendKind) => void,
): void => {
  installFinalInvariant()
  describe(`[conformance:${BACKEND_KIND}] ${name}`, () => {
    let ctxRef: ConformanceContext | null = null
    const suiteReleases: Array<() => Promise<void>> = []

    afterAll(async () => {
      while (suiteReleases.length) {
        const r = suiteReleases.pop()
        if (r) await r()
      }
    })

    beforeAll(async () => {
      const state = await ensureRuntime()
      const built = await buildPrimitivesAndService(state.backend)
      suiteReleases.push(built.release)
      const markerCheck = async <A, E>(eff: Effect.Effect<A, E>) => {
        if (BACKEND_KIND === "throwing") {
          const exit = await Effect.runPromiseExit(eff)
          if (Exit.isSuccess(exit)) {
            throw new Error(
              `expected substrate leak: effect succeeded on throwing backend with ${JSON.stringify(exit.value)}`,
            )
          }
          const repr = JSON.stringify(exit.cause)
          if (!repr.includes(THROWING_BACKEND_MARKER)) {
            throw new Error(`expected marker ${THROWING_BACKEND_MARKER} in cause, got ${repr}`)
          }
          return { marker: THROWING_BACKEND_MARKER as typeof THROWING_BACKEND_MARKER }
        }
        return (await Effect.runPromise(eff as Effect.Effect<A, E>)) as A
      }
      ctxRef = {
        kind: BACKEND_KIND,
        backend: state.backend,
        ws: built.ws,
        svc: built.svc,
        watchTimeoutMs: state.watchTimeoutMs,
        expectSubstrateOrSuccess: markerCheck,
        expectWorkspaceSubstrateOrSuccess: markerCheck,
      }
    })

    const register: RegisterTest = (n, fn) => {
      test(n, async () => {
        if (!ctxRef) throw new Error("conformance context uninitialised")
        try {
          await fn(ctxRef)
          counters.pass++
        } catch (err) {
          counters.fail++
          throw err
        }
      })
    }

    body(register, BACKEND_KIND)
  })
}
