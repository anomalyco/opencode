import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Backup } from "@/backup"
import { AppRuntime } from "@/effect/app-runtime"
import { Instance } from "@/project/instance"
import { SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { errors } from "../../error"
import { lazy } from "@/util/lazy"

const SessionPayload = z.object({
  sessionID: SessionID.zod,
})

const ImportPayload = z.object({
  payload: Backup.Payload.zod,
})

const SessionResponse = z.object({
  sessionID: SessionID.zod,
})

export const BackupRoutes = lazy(() =>
  new Hono()
    .post(
      "/list",
      describeRoute({
        summary: "List backup sessions",
        description: "List all local sessions available for backup export.",
        operationId: "backup.list",
        responses: {
          200: {
            description: "Sessions",
            content: {
              "application/json": {
                schema: resolver(z.array(Session.Info.zod)),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await AppRuntime.runPromise(Backup.Service.use((backup) => backup.list(Instance.project.id))))
      },
    )
    .post(
      "/export",
      describeRoute({
        summary: "Export session backup",
        description: "Return the full JSON backup payload for a single session.",
        operationId: "backup.export",
        responses: {
          200: {
            description: "Backup payload",
            content: {
              "application/json": {
                schema: resolver(Backup.Payload.zod),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("json", SessionPayload),
      async (c) => {
        const body = c.req.valid("json")
        return c.json(
          await AppRuntime.runPromise(Backup.Service.use((backup) => backup.exportSession(body.sessionID, Instance.project.id))),
        )
      },
    )
    .post(
      "/import",
      describeRoute({
        summary: "Import session backup",
        description: "Restore a single session from a JSON backup payload.",
        operationId: "backup.import",
        responses: {
          200: {
            description: "Imported session",
            content: {
              "application/json": {
                schema: resolver(SessionResponse),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", ImportPayload),
      async (c) => {
        const body = c.req.valid("json")
        return c.json({
          sessionID: await AppRuntime.runPromise(
            Backup.Service.use((backup) => backup.importSession(structuredClone(body.payload) as Backup.Payload, Instance.project.id)),
          ),
        })
      },
    ),
)
