import { describe, expect } from "bun:test"
import { Deferred, Effect, Layer, Option, Schedule, Schema, Stream } from "effect"
import { AIError, InvalidRequestError, LanguageModel, type LLMRequest } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols/openai-chat"
import { TestLLM } from "@opencode/ai/testing"
import { Agent } from "@opencode/core/agent"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Job } from "@opencode/core/job"
import { KV } from "@opencode/core/kv"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { GoalPlugin } from "@opencode/core/plugin/goal"
import { PluginHost } from "@opencode/core/plugin/host"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { Goal } from "@opencode/schema/goal"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "../fixture/global"
import { offlineModels } from "../fixture/models"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const llmLayer = TestLLM.testLayer({ fallback: TestLLM.text("Working on it", "work") })
const it = testEffect(
  Layer.merge(
    llmLayer,
    AppNodeBuilder.build(LayerNode.group([Session.node, LocationServiceMap.node, Job.node, KV.node]), [
      Global.node.replace(tempGlobalLayer),
      offlineModels,
      Watcher.node.replace(Watcher.configured({ enabled: false })),
      LayerNodePlatform.llmClient.replace(llmLayer),
      SessionRunnerModel.node.replace(
        Layer.succeed(SessionRunnerModel.Service, {
          resolve: () =>
            Effect.succeed(
              SessionRunnerModel.resolved(
                LanguageModel.make({ id: "goal", provider: "test", route: OpenAIChat.route }),
                {
                  capabilities: { tools: true, input: ["text"], output: ["text"] },
                  cost: [],
                  limit: { context: 200_000, output: 32_000 },
                },
              ),
            ),
        }),
      ),
    ]),
  ),
)

const model = Model.Ref.make({ id: Model.ID.make("goal"), providerID: Provider.ID.make("test") })

describe("goal plugin", () => {
  it.live("keeps working in one execution until the reviewer finds the goal met", () =>
    Effect.gen(function* () {
      const session = yield* project()
      const sessions = yield* Session.Service
      const verdicts = reviewer(
        '{"verdict":"continue","reason":"The parser test still fails.","next_step":"Fix the date parser."}',
        '```json\n{"verdict":"done","reason":"All 12 tests pass."}\n```',
      )
      yield* serve(verdicts.respond)

      yield* sessions.command({ sessionID: session.id, command: "goal", text: "  Make the test suite pass  " })
      yield* sessions.wait(session.id)

      expect(verdicts.asked()).toBe(2)
      expect(yield* goal(session.id)).toMatchObject({
        objective: "Make the test suite pass",
        status: "complete",
        reason: "All 12 tests pass.",
        rounds: 1,
      })
      const messages = yield* sessions.messages({ sessionID: session.id, order: "asc" })
      // The kickoff is a notice, so timelines show the objective rather than the whole template.
      expect(messages.filter((message) => message.type === "user")).toEqual([])
      const notices = messages.filter((message) => message.type === "synthetic")
      expect(notices).toMatchObject([
        { metadata: { source: "goal", goalID: expect.any(String) } },
        { metadata: { source: "goal", goalID: expect.any(String) } },
      ])
      // Only the kickoff has a description, so timelines show it and hide the continuation.
      expect(notices.map((message) => message.type === "synthetic" && message.description)).toEqual([
        "Goal: Make the test suite pass",
        undefined,
      ])
      expect(notices[0]?.type === "synthetic" && notices[0].text).toContain(
        "<untrusted_objective>\nMake the test suite pass\n</untrusted_objective>",
      )
      expect(notices[1]?.type === "synthetic" && notices[1].text).toContain(
        "The parser test still fails.\nNext step: Fix the date parser.",
      )
      // Continuations run inside the same execution, so the Session went idle once.
      expect(messages.filter((message) => message.type === "idle")).toMatchObject([{ outcome: "succeeded" }])
    }),
  )

  for (const scenario of [
    {
      // The first round with this reason made progress; the three repeats after it did not.
      name: "the reviewer keeps giving the same reason, even with tool calls",
      tools: true,
      reasons: Array<string>(4).fill("The flaky test still fails."),
    },
    {
      name: "rounds keep passing without tool calls",
      tools: false,
      reasons: ["Two tests fail.", "One test fails.", "The lint step fails."],
    },
  ])
    it.live(`pauses when ${scenario.name}`, () =>
      Effect.gen(function* () {
        const session = yield* project()
        const sessions = yield* Session.Service
        const verdicts = reviewer(
          ...scenario.reasons.map((reason) => JSON.stringify({ verdict: "continue", reason })),
          '{"verdict":"done","reason":"Unreachable."}',
        )
        yield* serve(scenario.tools ? withTools(verdicts) : verdicts.respond)

        yield* sessions.command({ sessionID: session.id, command: "goal", text: "Fix the flaky test" })
        yield* sessions.wait(session.id)

        // The third stalled round in a row pauses instead of sending another continuation.
        expect(verdicts.asked()).toBe(scenario.reasons.length)
        expect(yield* goal(session.id)).toMatchObject({
          status: "paused",
          reason: `Not making progress: ${scenario.reasons.at(-1)}`,
          rounds: scenario.reasons.length - 1,
        })
      }),
    )

  it.live("keeps going while each round calls tools and finds a new reason", () =>
    Effect.gen(function* () {
      const session = yield* project()
      const sessions = yield* Session.Service
      const verdicts = reviewer(
        '{"verdict":"continue","reason":"Two tests fail."}',
        '{"verdict":"continue","reason":"One test fails."}',
        '{"verdict":"continue","reason":"The lint step fails."}',
        '{"verdict":"done","reason":"Everything passes."}',
      )
      yield* serve(withTools(verdicts))

      yield* sessions.command({ sessionID: session.id, command: "goal", text: "Make CI green" })
      yield* sessions.wait(session.id)

      expect(verdicts.asked()).toBe(4)
      expect(yield* goal(session.id)).toMatchObject({ status: "complete", rounds: 3, stalls: 0 })
    }),
  )

  it.live("pauses when the reviewer gives no usable verdict twice", () =>
    Effect.gen(function* () {
      const session = yield* project()
      const sessions = yield* Session.Service
      const verdicts = reviewer("Looks good to me.", "I think so.")
      yield* serve(verdicts.respond)

      yield* sessions.command({ sessionID: session.id, command: "goal", text: "Ship it" })
      yield* sessions.wait(session.id)

      expect(verdicts.asked()).toBe(2)
      expect(yield* goal(session.id)).toMatchObject({
        status: "paused",
        reason: "The goal reviewer gave no usable verdict",
      })
    }),
  )

  it.live("waits for a background subagent instead of judging", () =>
    Effect.gen(function* () {
      const session = yield* project()
      const sessions = yield* Session.Service
      const jobs = yield* Job.Service
      const child = yield* sessions.create({ parentID: session.id, title: "Explore", agent: Agent.ID.make("build") })
      const done = yield* Deferred.make<string>()
      yield* jobs.start({
        id: child.id,
        type: "subagent",
        recovery: {
          kind: "subagent",
          parentSessionID: session.id,
          childSessionID: child.id,
          agent: "explore",
          description: "Explore",
        },
        run: Deferred.await(done),
      })
      yield* jobs.background(child.id)
      const verdicts = reviewer('{"verdict":"done","reason":"The report is written."}')
      yield* serve(verdicts.respond)

      yield* sessions.command({ sessionID: session.id, command: "goal", text: "Write the report" })
      yield* sessions.wait(session.id)
      expect(verdicts.asked()).toBe(0)
      expect(yield* goal(session.id)).toMatchObject({ status: "active", rounds: 0 })

      // The subagent's notice wakes the Session, and the reviewer runs once nothing is outstanding.
      yield* Deferred.succeed(done, "Found everything")
      yield* jobs.wait({ id: child.id })
      yield* sessions.synthetic({ sessionID: session.id, text: "Subagent finished" })
      yield* sessions.wait(session.id)
      expect(verdicts.asked()).toBe(1)
      expect(yield* goal(session.id)).toMatchObject({ status: "complete" })
    }),
  )

  it.live("does not wait on work a descendant owns, since only the descendant is woken", () =>
    Effect.gen(function* () {
      const session = yield* project()
      const sessions = yield* Session.Service
      const jobs = yield* Job.Service
      const child = yield* sessions.create({ parentID: session.id, title: "Explore", agent: Agent.ID.make("build") })
      const grandchild = yield* sessions.create({ parentID: child.id, title: "Dig", agent: Agent.ID.make("build") })
      yield* jobs.start({
        id: grandchild.id,
        type: "subagent",
        recovery: {
          kind: "subagent",
          parentSessionID: child.id,
          childSessionID: grandchild.id,
          agent: "explore",
          description: "Dig",
        },
        run: Effect.never,
      })
      yield* jobs.background(grandchild.id)
      yield* jobs.start({
        id: "child-shell",
        type: "shell",
        recovery: { kind: "shell", sessionID: child.id, shellID: "child-shell", command: "bun run build" },
        run: Effect.never,
      })
      yield* jobs.background("child-shell")
      const prompts: string[] = []
      const verdicts = reviewer(
        '{"verdict":"wait","reason":"bun run build is still running."}',
        '{"verdict":"done","reason":"The report is written."}',
      )
      yield* serve((request) => {
        if (isReview(request)) prompts.push(JSON.stringify(request.messages.at(-1)))
        return verdicts.respond(request)
      })

      yield* sessions.command({ sessionID: session.id, command: "goal", text: "Write the report" })
      yield* sessions.wait(session.id)

      // The grandchild reports to the child, so the reviewer runs. With none of the Session's own shells running,
      // "wait" is not offered and counts as an unusable answer.
      expect(verdicts.asked()).toBe(2)
      expect(prompts[0]).toContain("No background shells are running.")
      expect(yield* goal(session.id)).toMatchObject({ status: "complete", reason: "The report is written." })
    }),
  )

  it.live("drops the reviewer's verdict when the goal is paused while it runs", () =>
    Effect.gen(function* () {
      const session = yield* project()
      const sessions = yield* Session.Service
      const judging = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      yield* serve((request) =>
        isReview(request)
          ? Stream.fromEffect(Deferred.succeed(judging, undefined).pipe(Effect.andThen(Deferred.await(release)))).pipe(
              Stream.flatMap(() =>
                Stream.fromIterable(TestLLM.text('{"verdict":"continue","reason":"More to do."}', "review")),
              ),
            )
          : TestLLM.text("Working on it", "work"),
      )

      yield* sessions.command({ sessionID: session.id, command: "goal", text: "Rename the module" })
      yield* Deferred.await(judging)
      yield* sessions.command({ sessionID: session.id, command: "goal", text: "pause" })
      yield* Deferred.succeed(release, undefined)
      yield* sessions.wait(session.id)

      expect(yield* goal(session.id)).toMatchObject({ status: "paused", reason: "Paused by the user", rounds: 0 })
      expect(
        (yield* sessions.messages({ sessionID: session.id, order: "asc" })).flatMap((message) =>
          message.type === "synthetic" ? [message.description] : [],
        ),
      ).toEqual(["Goal: Rename the module"])
    }),
  )

  it.live("reminds the model of the goal after a compaction until a continuation restates it", () =>
    Effect.gen(function* () {
      const session = yield* project()
      const sessions = yield* Session.Service
      const llm = yield* TestLLM.Test
      const summarize = (request: LLMRequest) => JSON.stringify(request.messages.at(-1)).includes("summar")
      yield* serve((request) =>
        summarize(request) ? TestLLM.text("## Objective\n- Make CI green", "summary") : TestLLM.text("On it.", "work"),
      )
      yield* sessions.prompt({ sessionID: session.id, text: "Look at the failing CI job" })
      yield* sessions.wait(session.id)
      yield* setGoal(session.id, {
        id: "goal-compacted",
        objective: "Make CI green",
        status: "active",
        rounds: 2,
        maxRounds: 50,
        boot: "an-earlier-process",
        updatedAt: 0,
      })

      yield* sessions.compact({ sessionID: session.id })
      yield* sessions.wait(session.id)

      const before = (yield* llm.requests()).length
      yield* sessions.prompt({ sessionID: session.id, text: "Carry on" })
      yield* sessions.wait(session.id)
      const next = (yield* llm.requests()).slice(before).find((request) => !summarize(request) && !isReview(request))
      expect(JSON.stringify(next?.messages)).toContain("A goal is active for this session. Keep working toward it.")
      // The reminder goes before the user's prompt and is not saved to the Session.
      expect(JSON.stringify(next?.messages.at(-1))).toContain("Carry on")
      expect(
        (yield* sessions.messages({ sessionID: session.id, order: "asc" })).some(
          (message) => message.type === "synthetic" && message.text.includes("Keep working toward it."),
        ),
      ).toBe(false)
    }),
  )

  it.live("compacts and asks again when the reviewer's request is too large", () =>
    Effect.gen(function* () {
      const session = yield* project()
      const sessions = yield* Session.Service
      const reviews = { count: 0 }
      yield* serve((request) => {
        if (JSON.stringify(request.messages.at(-1)).includes("summar"))
          return TestLLM.text("## Objective\n- Make CI green", "summary")
        if (!isReview(request)) return TestLLM.text("Working on it", "work")
        reviews.count++
        return reviews.count === 1 ? overflow() : TestLLM.text('{"verdict":"done","reason":"CI is green."}', "review")
      })

      yield* sessions.command({ sessionID: session.id, command: "goal", text: "Make CI green" })
      yield* sessions.wait(session.id)

      expect(reviews.count).toBe(2)
      expect(yield* goal(session.id)).toMatchObject({ status: "complete", reason: "CI is green." })
      expect(
        (yield* sessions.messages({ sessionID: session.id, order: "asc" })).filter(
          (message) => message.type === "compaction",
        ),
      ).toMatchObject([{ status: "completed" }])
    }),
  )

  it.live("pauses when the reviewer's request is too large even after compacting", () =>
    Effect.gen(function* () {
      const session = yield* project()
      const sessions = yield* Session.Service
      yield* serve((request) => {
        if (JSON.stringify(request.messages.at(-1)).includes("summar"))
          return TestLLM.text("## Objective\n- Make CI green", "summary")
        return isReview(request) ? overflow() : TestLLM.text("Working on it", "work")
      })

      yield* sessions.command({ sessionID: session.id, command: "goal", text: "Make CI green" })
      yield* sessions.wait(session.id)

      expect(yield* goal(session.id)).toMatchObject({
        status: "paused",
        reason: "The goal reviewer's request is too large for the model",
      })
    }),
  )

  it.live("pauses an active goal when the user stops the session", () =>
    Effect.gen(function* () {
      const session = yield* project()
      const sessions = yield* Session.Service
      const llm = yield* TestLLM.Test
      const gate = yield* llm.gate()

      yield* sessions.command({ sessionID: session.id, command: "goal", text: "Refactor the store" })
      yield* gate.started
      yield* sessions.interrupt(session.id)
      yield* sessions.wait(session.id)

      expect(yield* eventually(goal(session.id), (state) => state?.status === "paused")).toMatchObject({
        reason: "Stopped by the user",
      })
    }),
  )

  it.live("pauses a goal set by an earlier server process instead of continuing it", () =>
    Effect.gen(function* () {
      const session = yield* project()
      const sessions = yield* Session.Service
      const verdicts = reviewer('{"verdict":"continue","reason":"Not yet."}')
      yield* serve(verdicts.respond)
      yield* setGoal(session.id, {
        id: "goal-earlier",
        objective: "Migrate the database",
        status: "active",
        rounds: 3,
        maxRounds: 20,
        boot: "an-earlier-process",
        updatedAt: 0,
      })

      yield* sessions.prompt({ sessionID: session.id, text: "Server came back" })
      yield* sessions.wait(session.id)

      expect(verdicts.asked()).toBe(0)
      expect(yield* goal(session.id)).toMatchObject({
        status: "paused",
        reason: "The server restarted while the goal was active",
      })
    }),
  )

  it.live("does not give a child session its parent's goal", () =>
    Effect.gen(function* () {
      const session = yield* project()
      const sessions = yield* Session.Service
      const llm = yield* TestLLM.Test
      const verdicts = reviewer('{"verdict":"blocked","reason":"Waiting on the user."}')
      yield* serve(verdicts.respond)
      const gate = yield* llm.gate()
      yield* sessions.command({ sessionID: session.id, command: "goal", text: "Tidy the docs" })
      yield* gate.started
      // Created while the parent's goal is active.
      const child = yield* sessions.create({ parentID: session.id, title: "Helper", agent: Agent.ID.make("build") })
      yield* gate.release
      yield* sessions.wait(session.id)
      expect(verdicts.asked()).toBe(1)

      expect(yield* goal(child.id)).toBeUndefined()
      yield* sessions.prompt({ sessionID: child.id, text: "Help out" })
      yield* sessions.wait(child.id)

      expect(verdicts.asked()).toBe(1)
    }),
  )

  it.live("pauses, resumes and clears a goal through its subcommands", () =>
    Effect.gen(function* () {
      const session = yield* project()
      const sessions = yield* Session.Service
      const verdicts = reviewer(
        '{"verdict":"paused","reason":"The user asked to stop for now."}',
        '{"verdict":"done","reason":"The changelog lists every PR."}',
      )
      yield* serve(verdicts.respond)

      yield* sessions.command({ sessionID: session.id, command: "goal", text: "Update the changelog" })
      yield* sessions.wait(session.id)
      expect(yield* goal(session.id)).toMatchObject({ status: "paused", reason: "The user asked to stop for now." })
      const paused = yield* sessions
        .command({ sessionID: session.id, command: "goal", text: "pause" })
        .pipe(Effect.exit)
      expect(paused._tag).toBe("Failure")

      yield* sessions.command({ sessionID: session.id, command: "goal", text: "Resume" })
      expect(yield* goal(session.id)).toMatchObject({ status: "active", rounds: 1 })
      yield* sessions.wait(session.id)
      expect(yield* goal(session.id)).toMatchObject({ status: "complete", rounds: 1 })
      const resumed = (yield* sessions.messages({ sessionID: session.id, order: "asc" })).filter(
        (message) => message.type === "synthetic",
      )
      expect(resumed.map((message) => message.type === "synthetic" && message.description)).toEqual([
        "Goal: Update the changelog",
        undefined,
      ])

      yield* sessions.command({ sessionID: session.id, command: "goal", text: "clear" })
      expect(yield* goal(session.id)).toBeUndefined()
    }),
  )
})

const REVIEW_MARKER = "You are now the reviewer for the session's goal"

// Answers reviewer requests from a script and every other request as ordinary assistant work.
function reviewer(...replies: ReadonlyArray<string>) {
  const queue = [...replies]
  const asked = { count: 0 }
  return {
    asked: () => asked.count,
    respond: (request: LLMRequest) => {
      if (!isReview(request)) return TestLLM.text("Working on it", "work")
      asked.count++
      return TestLLM.text(queue.shift() ?? '{"verdict":"done","reason":"Out of script."}', `review-${asked.count}`)
    },
  }
}

// Each round starts with a tool call and ends with text once the tool result is in.
function withTools(verdicts: ReturnType<typeof reviewer>) {
  return (request: LLMRequest) => {
    if (isReview(request)) return verdicts.respond(request)
    const last = JSON.stringify(request.messages.at(-1))
    return last.includes("tool") && !last.includes("untrusted_objective")
      ? TestLLM.text("Checked.", "work")
      : TestLLM.tool(`call-${verdicts.asked()}`, "missing_tool", {})
  }
}

function overflow() {
  return TestLLM.failAfter(
    new AIError({ reason: new InvalidRequestError({ message: "Too long", classification: "context-overflow" }) }),
  )
}

function isReview(request: LLMRequest) {
  return JSON.stringify(request.messages.at(-1)).includes(REVIEW_MARKER)
}

function serve(respond: (request: LLMRequest) => TestLLM.Response) {
  return TestLLM.Test.use((llm) => llm.serve(respond))
}

// The goal plugin's own storage, as the plugin host hands it to the plugin.
const goals = KV.Service.use((kv) => Effect.succeed(PluginHost.storage(kv, GoalPlugin.Plugin.id)))
const decodeGoal = Schema.decodeUnknownOption(Goal.State)

function goal(sessionID: Session.ID) {
  return goals.pipe(
    Effect.flatMap((storage) => storage.get(`session:${sessionID}`)),
    Effect.map((value) => Option.getOrUndefined(decodeGoal(value))),
  )
}

function setGoal(sessionID: Session.ID, state: Goal.State) {
  return goals.pipe(Effect.flatMap((storage) => storage.set(`session:${sessionID}`, state)))
}

// The interrupt watcher reacts to the bus stream, after the interrupted execution has settled.
function eventually<A, R>(effect: Effect.Effect<A, unknown, R>, done: (value: A) => boolean) {
  return effect.pipe(
    Effect.repeat({ until: done, schedule: Schedule.spaced("10 millis") }),
    Effect.timeout("10 seconds"),
    Effect.orDie,
  )
}

function project() {
  return Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const sessions = yield* Session.Service
    return yield* sessions.create({
      location: { directory: AbsolutePath.make(tmp.path) },
      title: "Goal session",
      agent: Agent.ID.make("build"),
      model,
    })
  })
}
