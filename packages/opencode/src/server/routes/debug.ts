import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Debug } from "@/debug"
import { Instance } from "@/project/instance"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const DebugRoutes = lazy(() =>
  new Hono().post(
    "/ingest/:sessionId",
    describeRoute({
      summary: "Ingest debug logs",
      description:
        "Ingest Cursor-style debug logs (NDJSON or JSON) and append them to .opencode/debug.log in the worktree root.",
      operationId: "debug.ingest",
      responses: {
        200: {
          description: "Logs ingested",
          content: {
            "application/json": {
              schema: resolver(z.object({ success: z.literal(true), count: z.number().int().nonnegative() })),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator("param", z.object({ sessionId: z.string() })),
    async (c) => {
      const { sessionId } = c.req.valid("param")
      const contentType = c.req.header("content-type") ?? ""

      const raw = contentType.includes("application/json") ? await c.req.json() : await c.req.text()
      const entries = Array.isArray(raw)
        ? raw
        : typeof raw === "string"
          ? raw
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean)
              .map((line) => JSON.parse(line))
          : [raw]

      const lines: string[] = []
      for (const entry of entries) {
        const parsed = Debug.IngestEntry.safeParse(entry)
        if (!parsed.success) {
          return c.json(
            {
              success: false as const,
              data: entry,
              errors: parsed.error.flatten().fieldErrors,
            },
            400,
          )
        }
        if (parsed.data.sessionId !== sessionId) {
          return c.json(
            {
              success: false as const,
              data: { sessionId: parsed.data.sessionId, pathSessionId: sessionId },
              errors: [{ sessionId: "Body sessionId must match /ingest/:sessionId" }],
            },
            400,
          )
        }
        lines.push(JSON.stringify(parsed.data))
      }

      await Debug.appendLogLines({ worktreeRoot: Instance.worktree, lines })
      return c.json({ success: true as const, count: lines.length })
    },
  ),
)
