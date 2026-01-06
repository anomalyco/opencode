import { Hono, type Context } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { z } from "zod"
import { AsyncQueue } from "../util/queue"
import { LSP } from "@/lsp"

const TuiRequest = z.object({
  path: z.string(),
  body: z.any(),
})

type TuiRequest = z.infer<typeof TuiRequest>

const request = new AsyncQueue<TuiRequest>()
const response = new AsyncQueue<any>()

export async function callTui(ctx: Context) {
  const body = await ctx.req.json()
  request.push({
    path: ctx.req.path,
    body,
  })
  return response.next()
}

export const TuiRoute = new Hono()
  .get(
    "/next",
    describeRoute({
      summary: "Get next TUI request",
      description: "Retrieve the next TUI (Terminal User Interface) request from the queue for processing.",
      operationId: "tui.control.next",
      responses: {
        200: {
          description: "Next TUI request",
          content: {
            "application/json": {
              schema: resolver(TuiRequest),
            },
          },
        },
      },
    }),
    async (c) => {
      const req = await request.next()
      return c.json(req)
    },
  )
  .post(
    "/response",
    describeRoute({
      summary: "Submit TUI response",
      description: "Submit a response to the TUI request queue to complete a pending request.",
      operationId: "tui.control.response",
      responses: {
        200: {
          description: "Response submitted successfully",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
      },
    }),
    validator("json", z.any()),
    async (c) => {
      const body = c.req.valid("json")
      response.push(body)
      return c.json(true)
    },
  )
  .get(
    "/lsp/diagnostics/status",
    describeRoute({
      summary: "Get LSP diagnostics toggle status",
      description: "Returns the current state of LSP diagnostics toggle",
      operationId: "lsp.diagnostics.status",
      responses: {
        200: {
          description: "LSP diagnostics toggle status",
          content: {
            "application/json": {
              schema: resolver(LSP.DiagnosticsStatus),
            },
          },
        },
      },
    }),
    async (c) => {
      return c.json(await LSP.diagnosticsStatus())
    },
  )
  .post(
    "/lsp/diagnostics/toggle",
    describeRoute({
      summary: "Toggle LSP diagnostics",
      description: "Toggle whether LSP diagnostics are sent to the model",
      operationId: "lsp.diagnostics.toggle",
      responses: {
        200: {
          description: "Updated diagnostics status",
          content: {
            "application/json": {
              schema: resolver(LSP.DiagnosticsStatus),
            },
          },
        },
      },
    }),
    async (c) => {
      const enabled = await LSP.toggleDiagnostics()
      return c.json({ enabled })
    },
  )
