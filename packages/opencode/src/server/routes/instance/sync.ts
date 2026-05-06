import z from "zod"
import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { SyncEvent } from "@/sync"
import { Database } from "@/storage/db"
import { asc } from "drizzle-orm"
import { and } from "drizzle-orm"
import { not } from "drizzle-orm"
import { or } from "drizzle-orm"
import { lte } from "drizzle-orm"
import { eq } from "drizzle-orm"
import { EventTable } from "@/sync/event.sql"
import { lazy } from "@/util/lazy"
import * as Log from "@opencode-ai/core/util/log"
import { Workspace } from "@/control-plane/workspace"
import { AppRuntime } from "@/effect/app-runtime"
import { Instance } from "@/project/instance"
import { errors } from "../../error"
import { Session } from "@/session/session"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { SessionID } from "@/session/schema"

const ReplayEvent = z.object({
  id: z.string(),
  aggregateID: z.string(),
  seq: z.number().int().min(0),
  type: z.string(),
  data: z.record(z.string(), z.unknown()),
})
const SessionPayload = z.object({
  sessionID: SessionID.zod,
})

const log = Log.create({ service: "server.sync" })

export const SyncRoutes = lazy(() =>
  new Hono()
    .post(
      "/start",
      describeRoute({
        summary: "Start workspace sync",
        description: "Start sync loops for workspaces in the current project that have active sessions.",
        operationId: "sync.start",
        responses: {
          200: {
            description: "Workspace sync started",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        void AppRuntime.runPromise(
          Workspace.Service.use((workspace) => workspace.startWorkspaceSyncing(Instance.project.id)),
        )
        return c.json(true)
      },
    )
    .post(
      "/replay",
      describeRoute({
        summary: "Replay sync events",
        description: "Validate and replay a complete sync event history.",
        operationId: "sync.replay",
        responses: {
          200: {
            description: "Replayed sync events",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    sessionID: z.string(),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          directory: z.string(),
          events: z.array(ReplayEvent).min(1),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        const events = body.events
        const source = events[0].aggregateID

        log.info("sync replay requested", {
          sessionID: source,
          events: events.length,
          first: events[0]?.seq,
          last: events.at(-1)?.seq,
          directory: body.directory,
        })
        await AppRuntime.runPromise(SyncEvent.use.replayAll(events))

        log.info("sync replay complete", {
          sessionID: source,
          events: events.length,
          first: events[0]?.seq,
          last: events.at(-1)?.seq,
        })

        return c.json({
          sessionID: source,
        })
      },
    )
    .post(
      "/steal",
      describeRoute({
        summary: "Steal session into workspace",
        description: "Update a session to belong to the current workspace through the sync event system.",
        operationId: "sync.steal",
        responses: {
          200: {
            description: "Session stolen into workspace",
            content: {
              "application/json": {
                schema: resolver(SessionPayload),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", SessionPayload),
      async (c) => {
        const body = c.req.valid("json")
        const workspaceID = WorkspaceContext.workspaceID
        if (!workspaceID) throw new Error("Cannot steal session without workspace context")

        SyncEvent.run(Session.Event.Updated, {
          sessionID: body.sessionID,
          info: {
            workspaceID,
          },
        })

        log.info("sync session stolen", {
          sessionID: body.sessionID,
          workspaceID,
        })

        return c.json({
          sessionID: body.sessionID,
        })
      },
    )
    .post(
      "/history",
      describeRoute({
        summary: "List sync events",
        description:
          "List sync events for all aggregates. Keys are aggregate IDs the client already knows about, values are the last known sequence ID. Events with seq > value are returned for those aggregates. Aggregates not listed in the input get their full history.",
        operationId: "sync.history.list",
        responses: {
          200: {
            description: "Sync events",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      id: z.string(),
                      aggregate_id: z.string(),
                      seq: z.number(),
                      type: z.string(),
                      data: z.record(z.string(), z.unknown()),
                    }),
                  ),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", z.record(z.string(), z.number().int().min(0))),
      async (c) => {
        const body = c.req.valid("json")
        const exclude = Object.entries(body)
        const where =
          exclude.length > 0
            ? not(or(...exclude.map(([id, seq]) => and(eq(EventTable.aggregate_id, id), lte(EventTable.seq, seq))))!)
            : undefined
        const rows = Database.use((db) => db.select().from(EventTable).where(where).orderBy(asc(EventTable.seq)).all())
        return c.json(rows)
      },
    ),
)
