import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { upgradeWebSocket } from "hono/bun"
import z from "zod"
import { Doc } from "./index"
import { ActorID, DocID, SubmitID } from "./schema"
import { SessionID } from "@/session/schema"
import { errors } from "../server/error"

export const SessionDocRoutes = () =>
  new Hono()
    .get(
      "/:sessionID/prompt-doc",
      describeRoute({
        summary: "Get session prompt doc",
        description: "Get or create the collaborative prompt doc for a session.",
        operationId: "session.promptDoc",
        responses: {
          200: {
            description: "Prompt doc",
            content: {
              "application/json": {
                schema: resolver(Doc.PromptDocInfo),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      async (c) => {
        return c.json(Doc.prompt(c.req.valid("param").sessionID))
      },
    )
    .post(
      "/:sessionID/prompt-doc/advance",
      describeRoute({
        summary: "Advance session prompt doc",
        description:
          "Create a new collaborative prompt doc for the session.",
        operationId: "session.promptDoc.advance",
        responses: {
          200: {
            description: "New prompt doc",
            content: {
              "application/json": {
                schema: resolver(Doc.PromptDocInfo),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      validator("json", z.object({ clientID: z.string().optional() }).optional()),
      async (c) => {
        const json = c.req.valid("json")
        return c.json(
          Doc.promptAdvance({
            sessionID: c.req.valid("param").sessionID,
            clientID: json?.clientID,
          }),
        )
      },
    )
    .post(
      "/:sessionID/prompt-doc/ready",
      describeRoute({
        summary: "Activate session prompt doc",
        description:
          "Mark a collaborative prompt doc as ready for the session and notify connected clients to switch.",
        operationId: "session.promptDoc.ready",
        responses: {
          200: {
            description: "Ready prompt doc",
            content: {
              "application/json": {
                schema: resolver(Doc.PromptDocInfo),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      validator("json", z.object({ docID: DocID.zod, clientID: z.string().optional(), init: z.boolean().optional() })),
      async (c) => {
        const json = c.req.valid("json")
        return c.json(
          Doc.promptReady({
            sessionID: c.req.valid("param").sessionID,
            docID: json.docID,
            clientID: json.clientID,
            init: json.init,
          }),
        )
      },
    )
    .post(
      "/:sessionID/prompt-doc/submit",
      describeRoute({
        summary: "Create prompt doc submit approval",
        description: "Create a collaborative prompt doc submit approval request.",
        operationId: "session.promptDoc.submit",
        responses: {
          200: {
            description: "Submit approval state",
            content: {
              "application/json": {
                schema: resolver(Doc.SubmitState),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      validator("json", Doc.SubmitCreateInput.omit({ sessionID: true })),
      async (c) => {
        return c.json(
          Doc.submitCreate({
            ...c.req.valid("json"),
            sessionID: c.req.valid("param").sessionID,
          }),
        )
      },
    )
    .post(
      "/:sessionID/prompt-doc/submit/:submitID/respond",
      describeRoute({
        summary: "Respond to prompt doc submit approval",
        description: "Approve or cancel a collaborative prompt doc submit approval request.",
        operationId: "session.promptDoc.submit.respond",
        responses: {
          200: {
            description: "Submit approval state",
            content: {
              "application/json": {
                schema: resolver(Doc.SubmitState),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod, submitID: SubmitID.zod })),
      validator("json", z.object({ actorID: ActorID.zod, action: z.enum(["approve", "cancel"]) })),
      async (c) => {
        const param = c.req.valid("param")
        return c.json(
          Doc.submitRespond({
            ...c.req.valid("json"),
            sessionID: param.sessionID,
            submitID: param.submitID,
          }),
        )
      },
    )
    .get(
      "/:sessionID/prompt-doc/submit/connect",
      describeRoute({
        summary: "Connect to prompt doc submit approvals",
        description: "WebSocket connection for prompt doc submit approval lifecycle events.",
        operationId: "session.promptDoc.submit.connect",
        responses: {
          200: {
            description: "Connected",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      validator("query", z.object({ docID: DocID.zod, actorID: ActorID.zod })),
      upgradeWebSocket(async (c) => {
        const param = z.object({ sessionID: SessionID.zod }).parse(c.req.param())
        const query = z.object({ docID: DocID.zod, actorID: ActorID.zod }).parse(c.req.query())

        type Socket = {
          readyState: number
          send: (data: string) => void
          close: (code?: number, reason?: string) => void
        }

        const isSocket = (value: unknown): value is Socket => {
          if (!value || typeof value !== "object") return false
          if (!("readyState" in value)) return false
          if (!("send" in value) || typeof (value as { send?: unknown }).send !== "function") return false
          return typeof (value as { readyState?: unknown }).readyState === "number"
        }

        let stop: (() => void) | undefined

        return {
          onOpen(_event, ws) {
            const socket = ws.raw
            if (!isSocket(socket)) {
              ws.close()
              return
            }
            stop = Doc.submitConnect({
              sessionID: param.sessionID,
              docID: query.docID,
              actorID: query.actorID,
              peer: {
                send: (data) => {
                  if (socket.readyState === 1) socket.send(data)
                },
              },
            })
          },
          onClose() {
            stop?.()
          },
        }
      }),
    )
    .post(
      "/:sessionID/actor",
      describeRoute({
        summary: "Register session actor",
        description: "Register or refresh a collaborative actor for a session.",
        operationId: "session.actor.upsert",
        responses: {
          200: {
            description: "Actor",
            content: {
              "application/json": {
                schema: resolver(Doc.ActorInfo),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      validator(
        "json",
        z.object({
          actorID: ActorID.zod.optional(),
          userID: z.string().optional(),
          name: z.string().optional(),
        }),
      ),
      async (c) => {
        const param = c.req.valid("param")
        const body = c.req.valid("json")
        return c.json(
          Doc.actorUpsert({
            sessionID: param.sessionID,
            actorID: body.actorID,
            userID: body.userID,
            name: body.name,
          }),
        )
      },
    )
    .get(
      "/:sessionID/actor",
      describeRoute({
        summary: "List session actors",
        description: "List collaborative actors registered for a session.",
        operationId: "session.actor.list",
        responses: {
          200: {
            description: "Actors",
            content: {
              "application/json": {
                schema: resolver(Doc.ActorInfo.array()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      async (c) => {
        return c.json(Doc.actorList(c.req.valid("param").sessionID))
      },
    )
