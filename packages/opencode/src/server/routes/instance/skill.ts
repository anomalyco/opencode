import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Skill } from "@/skill"
import { jsonRequest } from "./trace"

export function SkillRoutes() {
  return new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List skills",
        description: "Get a list of all available skills in the OpenCode system.",
        operationId: "app.skills",
        responses: {
          200: {
            description: "List of skills",
            content: {
              "application/json": {
                schema: resolver(Skill.Info.zod.array()),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("SkillRoutes.list", c, function* () {
          const skill = yield* Skill.Service
          return yield* skill.all()
        }),
    )
    .get(
      "/status",
      describeRoute({
        summary: "Get skill status",
        description: "Get the runtime status of all discovered skills.",
        operationId: "skill.status",
        responses: {
          200: {
            description: "Skill status",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), Skill.Status)),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("SkillRoutes.status", c, function* () {
          const skill = yield* Skill.Service
          return yield* skill.status()
        }),
    )
    .post(
      "/:name/enable",
      describeRoute({
        summary: "Enable skill",
        description: "Enable a discovered skill for the current instance.",
        operationId: "skill.enable",
        responses: {
          200: {
            description: "Skill enabled",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
        },
      }),
      validator("param", z.object({ name: z.string() })),
      async (c) =>
        jsonRequest("SkillRoutes.enable", c, function* () {
          const { name } = c.req.valid("param")
          const skill = yield* Skill.Service
          yield* skill.enable(name)
          return true
        }),
    )
    .post(
      "/:name/disable",
      describeRoute({
        summary: "Disable skill",
        description: "Disable a discovered skill for the current instance.",
        operationId: "skill.disable",
        responses: {
          200: {
            description: "Skill disabled",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
        },
      }),
      validator("param", z.object({ name: z.string() })),
      async (c) =>
        jsonRequest("SkillRoutes.disable", c, function* () {
          const { name } = c.req.valid("param")
          const skill = yield* Skill.Service
          yield* skill.disable(name)
          return true
        }),
    )
}
