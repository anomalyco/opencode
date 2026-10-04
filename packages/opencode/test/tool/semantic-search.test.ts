import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer } from "effect"
import { SemanticSearchTool } from "../../src/tool/semantic-search"
import { SemanticEmbedder } from "@opencode-ai/core/semantic/embedder"
import { SemanticCache } from "@opencode-ai/core/semantic/cache"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { Git } from "@/git"
import { SessionID, MessageID } from "../../src/session/schema"
import {
  disposeAllInstances,
  provideInstance,
  testInstanceStoreLayer,
  TestInstance,
} from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import type * as Tool from "../../src/tool/tool"

afterEach(async () => {
  await disposeAllInstances()
})

const baseToolLayer = () =>
  LayerNode.compile(
    LayerNode.group([
      CrossSpawnSpawner.node,
      FSUtil.node,
      Ripgrep.node,
      Truncate.node,
      Agent.node,
      Git.node,
      SemanticEmbedder.node,
      SemanticCache.node,
    ]),
  )

const it = testEffect(Layer.mergeAll(baseToolLayer(), testInstanceStoreLayer))

const createCtx = (onAsk?: (req: any) => void): Tool.Context => ({
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: (req) => {
    if (onAsk) onAsk(req)
    return Effect.void
  },
})

describe("tool.semantic_search", () => {
  it.instance("registers with correct id, description, and schema", () =>
    Effect.gen(function* () {
      const tool = yield* SemanticSearchTool
      expect(tool.id).toBe("semantic_search")
      const def = yield* tool.init()
      expect(def.description).toContain("Semantic code search tool")
      expect(def.parameters).toBeDefined()
    }),
  )

  it.instance("auto-approves permission with wildcard always pattern", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        Bun.write(
          path.join(test.directory, "auth.ts"),
          "export function verifyToken(jwt: string) { return jwt.length > 0; }",
        ),
      )

      let askPayload: any = null
      const ctx = createCtx((req) => {
        askPayload = req
      })

      const tool = yield* SemanticSearchTool
      const search = yield* tool.init()
      yield* search.execute(
        {
          query: "verifyToken jwt",
          path: test.directory,
        },
        ctx,
      )

      expect(askPayload).not.toBeNull()
      expect(askPayload.permission).toBe("semantic_search")
      expect(askPayload.always).toEqual(["*"])
      expect(askPayload.patterns).toEqual(["verifyToken jwt"])
    }),
  )

  it.instance("falls back to keyword search when embedder is offline or unavailable", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        Bun.write(
          path.join(test.directory, "database.ts"),
          "export class PostgresPool {\n  async query(sql: string) {\n    return sql;\n  }\n}",
        ),
      )

      const ctx = createCtx()
      const tool = yield* SemanticSearchTool
      const search = yield* tool.init()

      const result = yield* search.execute(
        {
          query: "PostgresPool query",
          path: test.directory,
        },
        ctx,
      )

      expect(result.metadata).toBeDefined()
      expect(result.metadata.matches).toBeGreaterThan(0)
      expect(result.output).toContain("PostgresPool")
    }),
  )

  it.instance("returns empty message when no files match path or query", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const ctx = createCtx()
      const tool = yield* SemanticSearchTool
      const search = yield* tool.init()

      const result = yield* search.execute(
        {
          query: "nonexistent_token_xyz_12345",
          path: test.directory,
        },
        ctx,
      )

      expect(result.metadata.matches).toBe(0)
      expect(result.output).toContain("No")
    }),
  )

  it.instance("performs vector similarity ranking when mock embedder is provided", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        Bun.write(
          path.join(test.directory, "auth_service.ts"),
          "export class AuthenticationService {\n  validateUserPassword(u: string, p: string) {\n    return true;\n  }\n}",
        ),
      )
      yield* Effect.promise(() =>
        Bun.write(
          path.join(test.directory, "styles.css"),
          "body { background: #000; color: #fff; }",
        ),
      )

      // Mock embedder layer returning distinct vectors
      const mockVectorA = [1.0, 0.0, 0.0]
      const mockVectorB = [0.0, 1.0, 0.0]
      const mockEmbedderLayer = Layer.succeed(
        SemanticEmbedder.Service,
        SemanticEmbedder.Service.of({
          isAvailable: () => Effect.succeed(true),
          embedOne: (text: string) =>
            Effect.succeed(text.includes("auth") || text.includes("User") ? mockVectorA : mockVectorB),
          embed: (texts: readonly string[]) =>
            Effect.succeed(
              texts.map((t) => (t.includes("auth") || t.includes("User") ? mockVectorA : mockVectorB)),
            ),
        }),
      )

      const ctx = createCtx()
      const tool = yield* SemanticSearchTool
      const search = yield* tool.init()

      const result = yield* search
        .execute(
          {
            query: "authenticate user",
            path: test.directory,
            include: "*.ts",
          },
          ctx,
        )
        .pipe(Effect.provide(mockEmbedderLayer))

      expect(result.metadata.fallback).toBe(false)
      expect(result.metadata.matches).toBe(1)
      expect(result.output).toContain("AuthenticationService")
    }),
  )
})
