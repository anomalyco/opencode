import { TeamMemory } from "@/team/memory"
import { SessionID } from "@/session/schema"
import { MemoryTranslate } from "@/team/memory-translate"
import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"

export function applyProjectTeamRoutes(app: Hono) {
  return app
    .get(
      "/current/orchestration",
      describeRoute({
        summary: "Get orchestration state",
        description: "Retrieve current project memory entries for orchestration UI.",
        operationId: "project.orchestration",
        responses: {
          200: {
            description: "Current project orchestration state",
            content: {
              "application/json": {
                schema: resolver(z.object({ memory: z.array(TeamMemory.Entry) })),
              },
            },
          },
        },
      }),
      async (c) => {
        const memory = await TeamMemory.list({ limit: 500 })
        return c.json({ memory })
      },
    )
    .delete(
      "/current/memory/:id",
      describeRoute({
        summary: "Delete a memory entry",
        description: "Remove a memory entry by id. The entry is permanently deleted with a tombstone record.",
        operationId: "project.removeMemory",
        responses: {
          200: {
            description: "Removed entry id",
            content: {
              "application/json": {
                schema: resolver(z.object({ id: z.string() })),
              },
            },
          },
        },
      }),
      async (c) => {
        const id = c.req.param("id")
        await TeamMemory.remove({
          id,
          reason: "user-delete",
          sensitive: true,
          sessionID: SessionID.make("session_project_route_delete"),
          actor: "user",
        })
        return c.json({ id })
      },
    )
    .post(
      "/current/memory/translate",
      describeRoute({
        summary: "Translate memory UI fields",
        description: "Translate user-facing memory fields for the current project using the configured locale.",
        operationId: "project.translateMemory",
        responses: {
          200: {
            description: "Memory translation result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    count: z.number().int().min(0),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const count = await MemoryTranslate.translate({ all: true, wait: true })
        return c.json({ count })
      },
    )
}
