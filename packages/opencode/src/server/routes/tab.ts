import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Tab } from "../../tab"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const TabRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List tabs",
        description: "List all tabs with active tab ID and position.",
        operationId: "tab.list",
        responses: {
          200: {
            description: "Tab list",
            content: {
              "application/json": {
                schema: resolver(Tab.ListResponse),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(Tab.list())
      },
    )
    .get(
      "/:id",
      describeRoute({
        summary: "Get tab",
        description: "Get a single tab by ID.",
        operationId: "tab.get",
        responses: {
          200: {
            description: "Tab",
            content: {
              "application/json": {
                schema: resolver(Tab.Info),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        const id = c.req.valid("param").id
        return c.json(Tab.get(id))
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create tab",
        description: "Create a new tab and activate it.",
        operationId: "tab.add",
        responses: {
          200: {
            description: "Created tab",
            content: {
              "application/json": {
                schema: resolver(Tab.Info),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          sessionID: z.string().optional().meta({ description: "Session to associate with this tab" }),
          directory: z.string().optional().meta({ description: "Working directory for this tab" }),
          label: z.string().optional().meta({ description: "Tab label" }),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        const tab = await Tab.add(body)
        return c.json(tab)
      },
    )
    .delete(
      "/:id",
      describeRoute({
        summary: "Close tab",
        description: "Close a tab by ID. Cannot close the last remaining tab.",
        operationId: "tab.remove",
        responses: {
          200: {
            description: "Tab closed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        const id = c.req.valid("param").id
        await Tab.remove(id)
        return c.json(true)
      },
    )
    .post(
      "/:id/activate",
      describeRoute({
        summary: "Activate tab",
        description: "Set a tab as the active tab.",
        operationId: "tab.activate",
        responses: {
          200: {
            description: "Tab activated",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        const id = c.req.valid("param").id
        await Tab.activate(id)
        return c.json(true)
      },
    )
    .patch(
      "/:id",
      describeRoute({
        summary: "Update tab",
        description: "Update tab properties (label, sessionID, directory).",
        operationId: "tab.update",
        responses: {
          200: {
            description: "Updated tab",
            content: {
              "application/json": {
                schema: resolver(Tab.Info),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ id: z.string() })),
      validator(
        "json",
        z.object({
          label: z.string().optional().meta({ description: "New tab label" }),
          sessionID: z.string().optional().meta({ description: "New session ID" }),
          directory: z.string().optional().meta({ description: "New working directory" }),
        }),
      ),
      async (c) => {
        const id = c.req.valid("param").id
        const body = c.req.valid("json")
        const tab = await Tab.update(id, body)
        return c.json(tab)
      },
    )
    .post(
      "/last",
      describeRoute({
        summary: "Switch to previous tab",
        description: "Switch to the previously active tab.",
        operationId: "tab.last",
        responses: {
          200: {
            description: "Switched",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await Tab.last()
        return c.json(true)
      },
    )
    .post(
      "/position",
      describeRoute({
        summary: "Set tab bar position",
        description: "Set the tab bar position to top or bottom.",
        operationId: "tab.setPosition",
        responses: {
          200: {
            description: "Position set",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          position: z.enum(["top", "bottom"]).meta({ description: "Tab bar position" }),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        await Tab.setPosition(body.position)
        return c.json(true)
      },
    ),
)
