import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Skill } from "../../skill"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const SkillRoutes = lazy(() =>
  new Hono()
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
                schema: resolver(Skill.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const skills = await Skill.all()
        return c.json(skills)
      },
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
      async (c) => {
        return c.json(await Skill.status())
      },
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
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ name: z.string() })),
      async (c) => {
        const { name } = c.req.valid("param")
        try {
          await Skill.enable(name)
          return c.json(true)
        } catch (err) {
          return c.json({ error: err instanceof Error ? err.message : String(err) }, 404)
        }
      },
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
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ name: z.string() })),
      async (c) => {
        const { name } = c.req.valid("param")
        try {
          await Skill.disable(name)
          return c.json(true)
        } catch (err) {
          return c.json({ error: err instanceof Error ? err.message : String(err) }, 404)
        }
      },
    ),
)
