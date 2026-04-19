import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { ProviderID } from "@/provider/schema"
import { ModelID } from "@/provider/schema"
import { SessionID } from "@/session/schema"
import { errors } from "../../error"
import { lazy } from "@/util/lazy"
import { Effect } from "effect"
import { jsonRequest } from "./trace"
import * as AgentRouter from "@/agent/router"

const BossPresetProviderSchema = z.object({
  providerId: ProviderID.zod,
  accountKey: z.string().optional(),
  modelId: ModelID.zod,
  routing: z.enum(["sequential", "parallel", "fallback"]).optional(),
  priority: z.number().optional(),
})

const BossPresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  providers: z.array(BossPresetProviderSchema),
  settings: z.object({
    spawnWorkers: z.boolean().optional(),
    maxWorkers: z.number().optional(),
    notifyOnComplete: z.boolean().optional(),
  }),
})

export const BossRoutes = lazy(() =>
  new Hono()
    .post(
      "/route",
      describeRoute({
        summary: "Route request via Boss Agent",
        description: "Route a request to one or more providers based on a boss preset configuration.",
        operationId: "boss.route",
        responses: {
          200: {
            description: "Routing results",
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          preset: BossPresetSchema,
          sessionID: SessionID.zod,
          message: z.string(),
        }),
      ),
      async (c) =>
        jsonRequest("BossRoutes.route", c, function* () {
          const { preset, sessionID, message } = c.req.valid("json")
          const router = yield* AgentRouter.Service
          return yield* router.route({
            preset,
            sessionID,
            message,
          })
        }),
    )
)
