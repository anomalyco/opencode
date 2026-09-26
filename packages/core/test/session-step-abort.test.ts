import { expect } from "bun:test"
import { LanguageModel, LLM } from "@opencode/ai"
import { OpenAIChat } from "@opencode/ai/protocols/openai-chat"
import { LLMClient, type StreamOptions } from "@opencode/ai/route/client"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionTable } from "@opencode/core/session/sql"
import { Snapshot } from "@opencode/core/snapshot"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionStep } from "@opencode/core/session/runner/step"
import { ToolOutput } from "@opencode/core/tool-output"
import { Money } from "@opencode/schema/money"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Deferred, Effect, Fiber, Layer, Stream } from "effect"
import { testEffect } from "./lib/effect"

// Regression test for #51169: interrupting a step must abort the language model call signal.
// The client streams nothing, so the step sits waiting on the provider and the test can
// interrupt it before any event arrives.
const captured: { options?: StreamOptions } = {}
const started: { deferred?: Deferred.Deferred<void> } = {}

const llmLayer = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    compact: () => Effect.die("Unexpected compaction"),
    stream: (_request, options) => {
      captured.options = options
      return Stream.unwrap(
        Effect.sync(() => {
          if (started.deferred) Deferred.doneUnsafe(started.deferred, Effect.void)
          return Stream.never
        }),
      )
    },
    generate: () => Effect.die("Unexpected generate"),
  }),
)

const it = testEffect(
  Layer.merge(
    AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SessionProjector.node, ToolOutput.node]), [
      Bus.node.replace(Bus.configured({ persist: true })),
    ]),
    llmLayer,
  ),
)

it.effect("aborting the model call signal when the step is interrupted", () =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const sessionID = Session.ID.create()
    const assistantMessageID = SessionMessage.ID.create()
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .run()
    yield* db
      .insert(SessionTable)
      .values({ id: sessionID, project_id: Project.ID.global, slug: "abort", directory: "/project", version: "test" })
      .run()
    const model = SessionRunnerModel.resolved(
      LanguageModel.make({ id: "test-model", provider: "test", route: OpenAIChat.route }),
      {
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        limit: { context: 100_000, output: 1_000 },
        cost: [
          {
            input: Money.USDPerMillionTokens.make(1),
            output: Money.USDPerMillionTokens.make(2),
            cache: { read: Money.USDPerMillionTokens.make(0.1), write: Money.USDPerMillionTokens.make(0.5) },
          },
        ],
      },
    )
    const steps = yield* SessionStep.make.pipe(
      Effect.provide(
        Layer.mock(Snapshot.Service)({
          capture: () => Effect.succeed(Snapshot.ID.make("before")),
          files: () => Effect.succeed([]),
        }),
      ),
    )
    started.deferred = Deferred.makeUnsafe<void>()

    const fiber = yield* steps
      .attempt({
        isLocationClosed: () => false,
        sessionID,
        assistantMessageID,
        agent: Agent.defaultID,
        model,
        prepared: {
          retry: () => Effect.void,
          request: LLM.request({ model: model.model, prompt: "Run until interrupted" }),
          options: {},
          executeTool: () => Effect.die("Unexpected tool call"),
        },
        retry: (_cause, _error, retry) =>
          Effect.succeed(retry ? { retry: true, attempt: 2, delay: 0 } : { retry: false }),
        recoverContinuation: true,
        recoverOverflow: Effect.succeed(false),
      })
      .pipe(Effect.forkScoped)

    yield* Deferred.await(started.deferred!)
    const signal = captured.options?.abortSignal
    expect(signal).toBeDefined()
    expect(signal?.aborted).toBeFalse()

    yield* Fiber.interrupt(fiber)
    expect(signal?.aborted).toBeTrue()
  }),
)
