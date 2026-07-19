import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { Issue } from "@/issue/issue"
import { provideTmpdirInstance, testInstanceStoreLayer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

// E2E tests for the auto-progress redesign (ADR-0002 Amendment 2026-07-18)
// using OpenCode Zen free models. The `opencode` provider auto-falls back to
// `apiKey: "public"` when no auth is configured (see src/provider/provider.ts),
// so these tests run without any API key — only network access is required.
//
// Set OPENCODE_SKIP_ZEN_E2E=1 to skip in offline CI.
const skip = process.env.OPENCODE_SKIP_ZEN_E2E === "1"
// `Issue.node` is included explicitly (not just transitively via
// `SessionPrompt → ToolRegistry → Issue`) so that the layer's declared
// output type contains `Issue.Service`. Otherwise TypeScript can't see
// that the layer provides it, and structural typing trips on the union
// of `Context.Service`-shaped tags.
//
// `testInstanceStoreLayer` + `CrossSpawnSpawner.node` are merged in so that
// `provideTmpdirInstance` (which uses `InstanceStore.Service` via
// `provideInstanceEffect` and `ChildProcessSpawner` via `tmpdirScoped`)
// resolves to the SAME instance the test layer uses.
//
// `SessionProjector.node` is included explicitly because `Session.create`
// only publishes `SessionV1.Event.Created` — the projector is the subscriber
// that persists it to `SessionTable`. Without it, `Session.get` (called by
// `prompt.prompt`) fails with "Session not found" because nothing wrote the
// row to the DB. `SessionProjector` is NOT a transitive dep of `Session.node`.
const it = testEffect(
  Layer.mergeAll(
    AppNodeBuilder.build(
      LayerNode.group([SessionPrompt.node, Session.node, SessionProjector.node, Issue.node, Ripgrep.node]),
    ),
    testInstanceStoreLayer,
    LayerNode.compile(CrossSpawnSpawner.node),
  ),
)
const live = skip ? it.live.skip : it.live

// Minimal config: the `opencode` provider is built-in and auto-loads its model
// catalogue from models.dev. Setting `model` is enough to point sessions at a
// free Zen model. `deepseek-v4-flash-free` supports tool calls (tool_call: true
// in models.dev), which is required for the agent to invoke issue_* tools.
const zenConfig: Partial<ConfigV1.Info> = {
  model: "opencode/deepseek-v4-flash-free",
}

// Allow every tool so the agent can call issue_add / issue_archive / issue_delete
// without per-call permission prompts that would block the loop.
const allowAllPermission = [{ permission: "*", pattern: "*", action: "allow" }] as const

describe("Issue tools E2E (OpenCode Zen free model)", () => {
  live(
    "agent creates an issue via issue_add",
    () =>
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            const prompt = yield* SessionPrompt.Service
            const sessions = yield* Session.Service
            const issueSvc = yield* Issue.Service

            const session = yield* sessions.create({
              title: "E2E: issue_add",
              permission: allowAllPermission,
            })

            yield* prompt.prompt({
              sessionID: session.id,
              agent: "build",
              parts: [
                {
                  type: "text",
                  text: 'Use the issue_add tool to create an issue with title "Zen E2E Test" and content "Created by agent". Do not use any other tools.',
                },
              ],
            })

            const issues = yield* issueSvc.get({ directory: dir, include_archived: true })
            expect(issues.some((i) => i.title === "Zen E2E Test")).toBe(true)
          }),
        { git: true, config: zenConfig },
      ),
    { timeout: 120_000 },
  )

  live(
    "agent archives an existing issue via issue_archive",
    () =>
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            const prompt = yield* SessionPrompt.Service
            const sessions = yield* Session.Service
            const issueSvc = yield* Issue.Service

            // Pre-seed an active issue (Backlog status)
            const created = yield* issueSvc.create({
              directory: dir,
              issue: { title: "To Archive", level: 0 },
            })

            const session = yield* sessions.create({
              title: "E2E: issue_archive",
              permission: allowAllPermission,
            })

            yield* prompt.prompt({
              sessionID: session.id,
              agent: "build",
              parts: [
                {
                  type: "text",
                  text: `Use the issue_archive tool to archive the issue with id "${created.id}" using outcome "done". Do not use any other tools.`,
                },
              ],
            })

            const issues = yield* issueSvc.get({ directory: dir, include_archived: true })
            const target = issues.find((i) => i.id === created.id)
            expect(target).toBeDefined()
            expect(target?.status).toBe("Done")
          }),
        { git: true, config: zenConfig },
      ),
    { timeout: 120_000 },
  )

  live(
    "agent cannot delete an active issue (issue_delete rejects with helpful error)",
    () =>
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            const prompt = yield* SessionPrompt.Service
            const sessions = yield* Session.Service
            const issueSvc = yield* Issue.Service

            // Pre-seed an active issue (Backlog status — not archived)
            const created = yield* issueSvc.create({
              directory: dir,
              issue: { title: "Active Issue", level: 0 },
            })

            const session = yield* sessions.create({
              title: "E2E: issue_delete active rejection",
              permission: allowAllPermission,
            })

            yield* prompt.prompt({
              sessionID: session.id,
              agent: "build",
              parts: [
                {
                  type: "text",
                  text: `Use the issue_delete tool to delete the issue with id "${created.id}". Do not use any other tools.`,
                },
              ],
            })

            // Per ADR-0002 D10-revised: issue_delete rejects Active issues with
            // IssueNotArchivedError. The issue must still exist with Backlog status.
            const issues = yield* issueSvc.get({ directory: dir, include_archived: true })
            expect(issues.some((i) => i.id === created.id)).toBe(true)
            expect(issues.find((i) => i.id === created.id)?.status).toBe("Backlog")
          }),
        { git: true, config: zenConfig },
      ),
    { timeout: 120_000 },
  )

  live(
    "agent deletes an archived issue via issue_delete",
    () =>
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            const prompt = yield* SessionPrompt.Service
            const sessions = yield* Session.Service
            const issueSvc = yield* Issue.Service

            // Pre-seed an archived issue (Done status — terminal state)
            const created = yield* issueSvc.create({
              directory: dir,
              issue: { title: "Archived Issue", level: 0 },
            })
            yield* issueSvc.archive({ directory: dir, id: created.id, outcome: "done" })

            const session = yield* sessions.create({
              title: "E2E: issue_delete archived",
              permission: allowAllPermission,
            })

            yield* prompt.prompt({
              sessionID: session.id,
              agent: "build",
              parts: [
                {
                  type: "text",
                  text: `Use the issue_delete tool to delete the issue with id "${created.id}". Do not use any other tools.`,
                },
              ],
            })

            // Per ADR-0002 D10-revised: archived issues can be hard-deleted.
            const issues = yield* issueSvc.get({ directory: dir, include_archived: true })
            expect(issues.some((i) => i.id === created.id)).toBe(false)
          }),
        { git: true, config: zenConfig },
      ),
    { timeout: 120_000 },
  )

  live(
    "agent lists active issues via issue_list (default excludes archived)",
    () =>
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            const prompt = yield* SessionPrompt.Service
            const sessions = yield* Session.Service
            const issueSvc = yield* Issue.Service

            // Seed: one Active L1, one Archived L1 (its subtree should be hidden)
            const activeL1 = yield* issueSvc.create({
              directory: dir,
              issue: { title: "Active L1", level: 0 },
            })
            const archivedL1 = yield* issueSvc.create({
              directory: dir,
              issue: { title: "Archived L1", level: 0 },
            })
            yield* issueSvc.archive({ directory: dir, id: archivedL1.id, outcome: "done" })

            const session = yield* sessions.create({
              title: "E2E: issue_list default",
              permission: allowAllPermission,
            })

            yield* prompt.prompt({
              sessionID: session.id,
              agent: "build",
              parts: [
                {
                  type: "text",
                  text: 'Use the issue_list tool (with no arguments) to list issues in the current project. Then reply with the count and titles as JSON. Do not use any other tools.',
                },
              ],
            })

            // Per ADR-0002 D8-revised: default issue_list filters archived
            // subtrees — only Active L1 should be visible.
            const issues = yield* issueSvc.get({ directory: dir, include_archived: false })
            expect(issues.some((i) => i.id === activeL1.id)).toBe(true)
            expect(issues.some((i) => i.id === archivedL1.id)).toBe(false)
          }),
        { git: true, config: zenConfig },
      ),
    { timeout: 120_000 },
  )

  live(
    "agent lists all issues via issue_list with include_archived",
    () =>
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            const prompt = yield* SessionPrompt.Service
            const sessions = yield* Session.Service
            const issueSvc = yield* Issue.Service

            const activeL1 = yield* issueSvc.create({
              directory: dir,
              issue: { title: "Active L1 for archive test", level: 0 },
            })
            const archivedL1 = yield* issueSvc.create({
              directory: dir,
              issue: { title: "Archived L1 for archive test", level: 0 },
            })
            yield* issueSvc.archive({ directory: dir, id: archivedL1.id, outcome: "canceled" })

            const session = yield* sessions.create({
              title: "E2E: issue_list include_archived",
              permission: allowAllPermission,
            })

            yield* prompt.prompt({
              sessionID: session.id,
              agent: "build",
              parts: [
                {
                  type: "text",
                  text: 'Use the issue_list tool with include_archived set to true to list all issues. Then reply with the count. Do not use any other tools.',
                },
              ],
            })

            // Per spec §5.1: include_archived=true returns everything.
            const issues = yield* issueSvc.get({ directory: dir, include_archived: true })
            expect(issues.some((i) => i.id === activeL1.id)).toBe(true)
            expect(issues.some((i) => i.id === archivedL1.id)).toBe(true)
          }),
        { git: true, config: zenConfig },
      ),
    { timeout: 120_000 },
  )
})
