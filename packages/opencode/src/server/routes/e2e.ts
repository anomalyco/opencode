import { Hono } from "hono"
import { validator } from "hono-openapi"
import z from "zod"
import { Flag } from "@/flag/flag"
import { Identifier } from "@/id/id"
import { PermissionNext } from "@/permission/next"
import { Question } from "@/question"
import { Todo } from "@/session/todo"
import { lazy } from "@/util/lazy"

const session = z.object({
  sessionID: Identifier.schema("session"),
})

const seed = new Map<string, { question: Set<string>; permission: Set<string> }>()

function tracker(sessionID: string) {
  const existing = seed.get(sessionID)
  if (existing) return existing
  const value = {
    question: new Set<string>(),
    permission: new Set<string>(),
  }
  seed.set(sessionID, value)
  return value
}

async function clear(sessionID: string) {
  const entry = seed.get(sessionID)
  if (entry) {
    await Promise.all(
      [...entry.question].map((requestID) =>
        Question.reject(requestID).catch(() => {
          return
        }),
      ),
    )

    await Promise.all(
      [...entry.permission].map((requestID) =>
        PermissionNext.reply({ requestID, reply: "reject" }).catch(() => {
          return
        }),
      ),
    )

    seed.delete(sessionID)
  }

  Todo.update({ sessionID, todos: [] })
}

export const E2ERoutes = lazy(() =>
  new Hono()
    .use("*", async (c, next) => {
      if (!Flag.OPENCODE_E2E) return c.notFound()
      return next()
    })
    .post(
      "/session/:sessionID/question",
      validator("param", session),
      validator(
        "json",
        z.object({
          id: Identifier.schema("question").optional(),
          questions: z.array(Question.Info).min(1),
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        const id = Identifier.ascending("question", body.id)
        tracker(params.sessionID).question.add(id)
        Question.ask({
          id,
          sessionID: params.sessionID,
          questions: body.questions,
        }).catch(() => {
          return
        })
        return c.json({ id })
      },
    )
    .post(
      "/session/:sessionID/permission",
      validator("param", session),
      validator(
        "json",
        z.object({
          id: Identifier.schema("permission").optional(),
          permission: z.string(),
          patterns: z.array(z.string()).default(["*"]),
          always: z.array(z.string()).optional(),
          metadata: z.record(z.string(), z.any()).optional(),
          description: z.string().optional(),
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        const id = Identifier.ascending("permission", body.id)
        const patterns = body.patterns.length > 0 ? body.patterns : ["*"]
        const metadata = {
          ...(body.metadata ?? {}),
          ...(body.description ? { description: body.description } : {}),
        }

        tracker(params.sessionID).permission.add(id)
        PermissionNext.ask({
          id,
          sessionID: params.sessionID,
          permission: body.permission,
          patterns,
          always: body.always ?? patterns,
          metadata,
          ruleset: [],
        }).catch(() => {
          return
        })
        return c.json({ id })
      },
    )
    .post(
      "/session/:sessionID/todo",
      validator("param", session),
      validator(
        "json",
        z.object({
          todos: z.array(Todo.Info),
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        Todo.update({
          sessionID: params.sessionID,
          todos: body.todos,
        })
        return c.json(true)
      },
    )
    .delete("/session/:sessionID", validator("param", session), async (c) => {
      const params = c.req.valid("param")
      await clear(params.sessionID)
      return c.json(true)
    }),
)
