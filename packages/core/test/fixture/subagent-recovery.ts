import type { FileSystem } from "@opencode/core/filesystem"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Database } from "@opencode/core/database/database"
import { Job } from "@opencode/core/job"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import type { LocationServices } from "@opencode/core/location-services"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionRunner } from "@opencode/core/session/runner/index"
import { SessionTable } from "@opencode/core/session/sql"
import { SubagentJob } from "@opencode/core/session/subagent-job"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Context, Deferred, Effect, Exit, Layer, LayerMap, Scope } from "effect"

const parent = Session.ID.make("ses_process_parent")
const children = [Session.ID.make("ses_process_child_one"), Session.ID.make("ses_process_child_two")]
const mode = process.argv[2]
const path = process.argv[3]
if ((mode !== "shutdown" && mode !== "recover") || !path) throw new Error("Expected mode and fixture database path")

const result = await Effect.runPromise(
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
    const executionScope = yield* Scope.make()
    yield* Scope.addFinalizer(scope, Scope.close(executionScope, Exit.void))
    const running = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const started: Session.ID[] = []
    const runner = Layer.succeed(SessionRunner.Service, {
      drain: ({ sessionID }) =>
        Effect.gen(function* () {
          started.push(sessionID)
          if (started.length === children.length + 1) yield* Deferred.succeed(running, undefined)
          yield* Deferred.await(release)
          return SessionRunner.DrainResult.Complete()
        }),
    })
    const context = yield* Layer.buildWithScope(
      AppNodeBuilder.build(
        LayerNode.group([SessionRestart.node, SessionExecution.node, SubagentJob.node, Job.node, Database.node]),
        [
          Database.node.replace(Database.configured({ path })),
          SessionExecution.node.replace(
            SessionExecution.node.mapLayer((layer) => Layer.effectContext(Layer.buildWithScope(layer, executionScope))),
          ),
          LocationServiceMap.node.replace(
            Layer.effect(
              LocationServiceMap.Service,
              LayerMap.make(
                () =>
                  // The fixture's Location only needs the model-runner boundary.
                  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
                  runner as unknown as Layer.Layer<LocationServices, FileSystem.DirectoryNotFoundError>,
              ),
            ),
          ),
        ],
      ),
      scope,
    )
    const database = Context.get(context, Database.Service)
    const jobs = Context.get(context, Job.Service)
    const subagents = Context.get(context, SubagentJob.Service)
    const execution = Context.get(context, SessionExecution.Service)
    const restart = Context.get(context, SessionRestart.Service)

    if (mode === "shutdown") {
      yield* database.db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .run()
      yield* database.db
        .insert(SessionTable)
        .values(
          [parent, ...children].map((id) => ({
            id,
            parent_id: id === parent ? null : parent,
            project_id: Project.ID.global,
            slug: id,
            directory: "/project",
            version: "test",
          })),
        )
        .run()
      yield* execution.wake(parent)
      yield* Effect.forEach(children, (childSessionID) =>
        Effect.gen(function* () {
          const recovery = {
            kind: "subagent" as const,
            parentSessionID: parent,
            childSessionID,
            agent: "general",
            description: "Process recovery",
          }
          yield* subagents.start(recovery)
          yield* subagents.background(recovery)
        }),
      )
      yield* Deferred.await(running)
      const before = yield* jobs.pendingBackground
      // Reproduce teardown while completion observers are still alive.
      yield* Scope.close(executionScope, Exit.void)
      yield* Effect.forEach(children, (id) => jobs.wait({ id }))
      yield* Scope.close(scope, Exit.void)
      return { before: before.map((marker) => marker.notificationID) }
    }

    yield* restart.resumeSuspendedSessions
    yield* Deferred.await(running)
    const attempts = yield* database.db
      .select({ id: SessionTable.id, attempts: SessionTable.resume_attempts })
      .from(SessionTable)
      .all()
    yield* Deferred.succeed(release, undefined)
    yield* Effect.forEach(children, (id) => jobs.wait({ id }))
    yield* execution.awaitIdle(parent)
    // Exercise notification idempotency even if the sweep races a completion observer.
    yield* restart.resumeSuspendedSessions
    return {
      started: [...started],
      attempts: attempts.map((row) => row.attempts),
      notices: (yield* SessionInbox.list(database.db, parent)).map((notice) => ({
        id: notice.id,
        payload: notice.payload,
      })),
      pending: (yield* jobs.pendingBackground).length,
    }
  }).pipe(Effect.scoped, Effect.timeout("10 seconds")),
)
console.log(JSON.stringify(result))
