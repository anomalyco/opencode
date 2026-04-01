import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { lazy } from "../../util/lazy"
import { Memory } from "../../memory/memory"
import { errors } from "../error"

export const MemoryRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List memories",
        description: "List all stored memories, optionally filtered by scope (user or project).",
        operationId: "memory.list",
        responses: {
          200: {
            description: "List of memories",
            content: { "application/json": { schema: resolver(Memory.Info.array()) } },
          },
        },
      }),
      validator("query", z.object({ scope: z.enum(["user", "project"]).optional() })),
      async (c) => {
        const { scope } = c.req.valid("query")
        return c.json(await Memory.list(scope))
      },
    )
    .get(
      "/:id",
      describeRoute({
        summary: "Get memory",
        description: "Get a single memory by ID.",
        operationId: "memory.get",
        responses: {
          200: {
            description: "Memory",
            content: { "application/json": { schema: resolver(Memory.Info) } },
          },
          ...errors(404),
        },
      }),
      async (c) => {
        const mem = await Memory.get(c.req.param("id"))
        if (!mem) return c.json({ error: "Not found" }, 404)
        return c.json(mem)
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Add memory",
        description: "Store a new memory with type, title, and content.",
        operationId: "memory.add",
        responses: {
          200: {
            description: "Created memory",
            content: { "application/json": { schema: resolver(Memory.Info) } },
          },
        },
      }),
      validator("json", Memory.AddInput),
      async (c) => {
        const input = c.req.valid("json")
        return c.json(await Memory.add(input))
      },
    )
    .delete(
      "/:id",
      describeRoute({
        summary: "Delete memory",
        description: "Delete a memory by ID.",
        operationId: "memory.delete",
        responses: {
          200: {
            description: "Deleted",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
        },
      }),
      async (c) => {
        await Memory.remove(c.req.param("id"))
        return c.json(true)
      },
    ),
)
